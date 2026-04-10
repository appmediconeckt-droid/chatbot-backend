import Chat from "../models/Chat.js";
import Message from "../models/Message.js";
import User from "../models/userModel.js";
import Call from "../models/Call.js";

class SocketHandler {
  constructor(io) {
    this.io = io;
  }

  emitToUserRooms(userId, eventName, payload) {
    if (!userId) return;

    const targetRooms = new Set([
      `user_${userId}`,
      `counsellor_${userId}`,
      `counselor_${userId}`,
    ]);

    targetRooms.forEach((room) => {
      this.io.to(room).emit(eventName, payload);
    });
  }

  initialize() {
    this.io.on("connection", async (socket) => {
      console.log(`📱 User connected: ${socket.userId} (${socket.userRole})`);

      // Get user details
      const user = await User.findById(socket.userId);
      if (!user) {
        console.log(`User not found: ${socket.userId}`);
        socket.disconnect();
        return;
      }

      // Join the role-specific room and a stable fallback room so
      // call notifications can be delivered regardless of role spelling.
      const userRoom = `${socket.userRole}_${socket.userId}`;
      socket.join(userRoom);
      socket.join(`user_${socket.userId}`);
      if (socket.userRole === "counsellor") {
        socket.join(`counselor_${socket.userId}`);
      }
      if (socket.userRole === "counselor") {
        socket.join(`counsellor_${socket.userId}`);
      }

      // Join all active chats for this user
      await this.joinExistingChats(socket);

      // Handle joining a specific chat
      socket.on("join-chat", (data) => this.handleJoinChat(socket, data));

      // Handle sending message
      socket.on("send-message", (data) =>
        this.handleSendMessage(socket, data),
      );

      // Handle typing indicator
      socket.on("typing", (data) => this.handleTyping(socket, data));

      // Handle mark as read
      socket.on("mark-read", (data) => this.handleMarkRead(socket, data));

      // ========== CALL SIGNALING HANDLERS ==========

      // Handle joining a call room
      socket.on("join-call", async ({ callId }) => {
        try {
          if (!callId) {
            socket.emit("error", { message: "Call ID is required" });
            return;
          }

          const callRoom = `call_${callId}`;
          const call = await Call.findOne({ callId: callId });

          // DB-backed calls require authorization checks.
          // For in-memory video calls (managed by videoCallController),
          // Call.findOne can be empty and we still allow room join.
          if (call) {
            const isAuthorized =
              call.callerId.toString() === socket.userId ||
              call.receiverId.toString() === socket.userId;

            if (!isAuthorized) {
              socket.emit("error", {
                message: "Unauthorized to join this call",
              });
              return;
            }
          }

          socket.join(callRoom);

          // Notify existing participant(s) that the peer has joined.
          socket.to(callRoom).emit("user-joined", {
            userId: socket.userId,
            userRole: socket.userRole,
            callId,
          });

          // Setup call signaling once per socket/call pair.
          if (!socket.data.callSignalingCalls) {
            socket.data.callSignalingCalls = new Set();
          }

          if (!socket.data.callSignalingCalls.has(callId)) {
            this.setupCallSignaling(socket, callId);
            socket.data.callSignalingCalls.add(callId);
          }

          socket.emit("call-joined", {
            callId,
            callRoom,
            callType: call?.callType || "video",
            message: "Successfully joined call",
          });

          console.log(`User ${socket.userId} joined call room: ${callRoom}`);
        } catch (error) {
          console.error("Error joining call:", error);
          socket.emit("error", { message: "Error joining call" });
        }
      });

      // Handle leaving a call — also tear down signaling listeners
      socket.on("leave-call", ({ callId }) => {
        const callRoom = `call_${callId}`;
        socket.leave(callRoom);
        console.log(`User ${socket.userId} left call room: ${callRoom}`);

        // Clean up signaling listeners for this call
        this.teardownCallSignaling(socket, callId);

        // Notify others in the call
        socket.to(callRoom).emit("user-left-call", {
          userId: socket.userId,
          userRole: socket.userRole,
          callId: callId,
        });
      });

      // Handle disconnection — clean up all call signaling
      socket.on("disconnect", () => {
        console.log(`📱 User disconnected: ${socket.userId}`);

        // Tear down all call signaling listeners
        if (socket.data.callSignalingCalls) {
          for (const callId of socket.data.callSignalingCalls) {
            this.teardownCallSignaling(socket, callId);
          }
        }
      });
    });
  }

  async joinExistingChats(socket) {
    try {
      let chats;
      if (socket.userRole === "user") {
        chats = await Chat.find({ userId: socket.userId, isActive: true });
      } else if (socket.userRole === "counsellor") {
        chats = await Chat.find({
          counselorId: socket.userId,
          isActive: true,
        });
      }

      if (chats && chats.length > 0) {
        chats.forEach((chat) => {
          const chatRoom = `chat_${chat.chatId}`;
          socket.join(chatRoom);
          console.log(`Joined existing chat room: ${chatRoom}`);
        });
      }
    } catch (error) {
      console.error("Error joining existing chats:", error);
    }
  }

  async handleJoinChat(socket, { chatId }) {
    try {
      const chat = await Chat.findById(chatId);

      if (!chat) {
        socket.emit("error", { message: "Chat not found" });
        return;
      }

      // Verify authorization
      const isAuthorized =
        (socket.userRole === "user" &&
          chat.userId.toString() === socket.userId) ||
        (socket.userRole === "counsellor" &&
          chat.counselorId.toString() === socket.userId);

      if (!isAuthorized) {
        socket.emit("error", { message: "Unauthorized" });
        return;
      }

      const chatRoom = `chat_${chat.chatId}`;
      socket.join(chatRoom);

      // Mark messages as read
      const updateResult = await Message.updateMany(
        {
          chatId: chat._id,
          senderRole: socket.userRole === "user" ? "counsellor" : "user",
          isRead: false,
        },
        {
          isRead: true,
          readAt: new Date(),
        },
      );

      if (updateResult.modifiedCount > 0) {
        socket.to(chatRoom).emit("messages-read", { chatId: chat._id });
      }

      socket.emit("chat-joined", {
        chatId: chat._id,
        chatRoom,
        message: "Successfully joined chat",
      });
    } catch (error) {
      console.error("Error joining chat:", error);
      socket.emit("error", { message: "Error joining chat" });
    }
  }

  async handleSendMessage(socket, { chatId, content, contentType = "TEXT" }) {
    try {
      const chat = await Chat.findById(chatId)
        .populate("userId", "fullName email profilePhoto")
        .populate(
          "counselorId",
          "fullName specialization profilePhoto rating",
        );

      if (!chat) {
        socket.emit("error", { message: "Chat not found" });
        return;
      }

      // Verify authorization
      const isAuthorized =
        (socket.userRole === "user" &&
          chat.userId._id.toString() === socket.userId) ||
        (socket.userRole === "counsellor" &&
          chat.counselorId._id.toString() === socket.userId);

      if (!isAuthorized) {
        socket.emit("error", { message: "Unauthorized" });
        return;
      }

      // Create message
      const message = await Message.create({
        chatId: chat._id,
        senderId: socket.userId,
        senderRole: socket.userRole,
        content: content,
        contentType: contentType,
      });

      // Update chat
      await Chat.findByIdAndUpdate(chat._id, {
        lastMessage: content,
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      });

      const messageData = {
        id: message._id,
        messageId: message.messageId,
        chatId: message.chatId,
        content: message.content,
        senderRole: message.senderRole,
        contentType: message.contentType,
        createdAt: message.createdAt,
        isRead: message.isRead,
      };

      // Emit to chat room
      const chatRoom = `chat_${chat.chatId}`;
      this.io.to(chatRoom).emit("new-message", messageData);

      // Notify other user
      const otherUserRoom =
        socket.userRole === "user"
          ? `counsellor_${chat.counselorId._id}`
          : `user_${chat.userId._id}`;

      const senderInfo =
        socket.userRole === "user" ? chat.userId : chat.counselorId;

      this.io.to(otherUserRoom).emit("message-notification", {
        chatId: chat._id,
        message: messageData,
        sender: {
          id: senderInfo._id,
          name: senderInfo.fullName,
          role: socket.userRole,
        },
      });

      console.log(
        `Message sent in chat ${chat._id} by ${socket.userRole}_${socket.userId}`,
      );
    } catch (error) {
      console.error("Error sending message:", error);
      socket.emit("error", { message: "Error sending message" });
    }
  }

  handleTyping(socket, { chatId, isTyping }) {
    const chatRoom = `chat_${chatId}`;
    socket.to(chatRoom).emit("user-typing", {
      userId: socket.userId,
      userRole: socket.userRole,
      isTyping,
    });
  }

  async handleMarkRead(socket, { chatId }) {
    try {
      const updateResult = await Message.updateMany(
        {
          chatId: chatId,
          senderRole: socket.userRole === "user" ? "counsellor" : "user",
          isRead: false,
        },
        {
          isRead: true,
          readAt: new Date(),
        },
      );

      if (updateResult.modifiedCount > 0) {
        const chat = await Chat.findById(chatId);
        if (chat) {
          const chatRoom = `chat_${chat.chatId}`;
          this.io.to(chatRoom).emit("messages-read", { chatId: chatId });
        }
      }
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  }

  // ========== CALL SIGNALING METHODS ==========

  /**
   * Attach call-signaling listeners to a socket for a specific callId.
   *
   * Each handler is stored on `socket.data._callHandlers[callId]` so it
   * can be cleanly removed later by `teardownCallSignaling`, preventing
   * the listener-leak that caused duplicate/fighting connections.
   */
  setupCallSignaling(socket, callId) {
    const callRoom = `call_${callId}`;

    // Store named handlers so we can remove them later
    const handlers = {};

    // WebRTC Offer (prefixed)
    handlers["call-offer"] = ({ callId: callIdParam, offer, to }) => {
      if (callIdParam !== callId) return;
      console.log(`📞 Call offer from ${socket.userId} to ${to}`);
      socket.to(callRoom).emit("call-offer", {
        callId: callIdParam,
        offer,
        from: socket.userId,
        fromRole: socket.userRole,
        to,
      });
    };

    // WebRTC Offer (bare — backward compatibility)
    handlers["offer"] = ({
      callId: callIdParam,
      offer,
      userId: senderUserId,
    }) => {
      if (callIdParam !== callId) return;
      console.log(`📞 Bare offer from ${socket.userId}`);
      socket.to(callRoom).emit("offer", {
        callId: callIdParam,
        offer,
        userId: senderUserId || socket.userId,
        from: socket.userId,
      });
    };

    // WebRTC Answer (prefixed)
    handlers["call-answer"] = ({ callId: callIdParam, answer, to }) => {
      if (callIdParam !== callId) return;
      console.log(`📞 Call answer from ${socket.userId} to ${to}`);
      socket.to(callRoom).emit("call-answer", {
        callId: callIdParam,
        answer,
        from: socket.userId,
        to,
      });
    };

    // WebRTC Answer (bare — backward compatibility)
    handlers["answer"] = ({
      callId: callIdParam,
      answer,
      userId: senderUserId,
    }) => {
      if (callIdParam !== callId) return;
      console.log(`📞 Bare answer from ${socket.userId}`);
      socket.to(callRoom).emit("answer", {
        callId: callIdParam,
        answer,
        userId: senderUserId || socket.userId,
        from: socket.userId,
      });
    };

    // WebRTC ICE Candidate
    handlers["ice-candidate"] = ({ callId: callIdParam, candidate, to }) => {
      if (callIdParam !== callId) return;
      socket.to(callRoom).emit("ice-candidate", {
        callId: callIdParam,
        candidate,
        from: socket.userId,
        to,
      });
    };

    // Call status updates
    handlers["call-status-update"] = ({
      callId: callIdParam,
      status,
      to,
    }) => {
      if (callIdParam !== callId) return;
      socket.to(callRoom).emit("call-status-update", {
        callId: callIdParam,
        status,
        from: socket.userId,
        to,
        timestamp: new Date(),
      });
    };

    // Mute/Unmute
    handlers["call-mute-toggle"] = ({
      callId: callIdParam,
      isMuted,
      to,
    }) => {
      if (callIdParam !== callId) return;
      socket.to(callRoom).emit("call-mute-toggle", {
        callId: callIdParam,
        isMuted,
        from: socket.userId,
        to,
      });
    };

    // Speaker toggle
    handlers["call-speaker-toggle"] = ({
      callId: callIdParam,
      isSpeakerOn,
      to,
    }) => {
      if (callIdParam !== callId) return;
      socket.to(callRoom).emit("call-speaker-toggle", {
        callId: callIdParam,
        isSpeakerOn,
        from: socket.userId,
        to,
      });
    };

    // Hold/Resume
    handlers["call-hold-toggle"] = ({
      callId: callIdParam,
      isOnHold,
      to,
    }) => {
      if (callIdParam !== callId) return;
      socket.to(callRoom).emit("call-hold-toggle", {
        callId: callIdParam,
        isOnHold,
        from: socket.userId,
        to,
      });
    };

    // Call quality update
    handlers["call-quality-update"] = ({
      callId: callIdParam,
      quality,
      to,
    }) => {
      if (callIdParam !== callId) return;
      socket.to(callRoom).emit("call-quality-update", {
        callId: callIdParam,
        quality,
        from: socket.userId,
        to,
      });
    };

    // Register all handlers
    for (const [event, handler] of Object.entries(handlers)) {
      socket.on(event, handler);
    }

    // Store on socket so teardown can remove them
    if (!socket.data._callHandlers) {
      socket.data._callHandlers = {};
    }
    socket.data._callHandlers[callId] = handlers;
  }

  /**
   * Remove call-signaling listeners for a specific callId.
   * Prevents listener accumulation across multiple calls.
   */
  teardownCallSignaling(socket, callId) {
    const handlers = socket.data._callHandlers?.[callId];
    if (!handlers) return;

    for (const [event, handler] of Object.entries(handlers)) {
      socket.off(event, handler);
    }

    delete socket.data._callHandlers[callId];
    socket.data.callSignalingCalls?.delete(callId);
    socket.data.callSignalingRooms?.delete(callId);

    console.log(
      `🧹 Cleaned up call signaling for ${socket.userId} / call ${callId}`,
    );
  }
}

export default SocketHandler;
