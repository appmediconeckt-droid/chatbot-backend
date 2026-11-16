import { prescriptionAccountOwnershipFilter } from "./accountDeletionOwnership.js";
import AIConsent from "../models/AIConsent.js";
import UserBlock from "../models/UserBlock.js";
import AbuseReport from "../models/AbuseReport.js";
import { revokeConsent } from "./aiConsent.js";
import mongoose from "mongoose";
import Appointment from "../models/appointmentModel.js";
import Call from "../models/Call.js";
import Chat from "../models/Chat.js";
import ChatSession from "../models/ChatSession.js";
import Conversation from "../models/Conversation.js";
import ForgotPasswordToken from "../models/ForgotPasswordToken.js";
import Message from "../models/Message.js";
import Notification from "../models/Notification.js";
import OTP from "../models/otpModel.js";
import LoginOTP from "../models/loginOtpModel.js";
import Prescription from "../models/Prescription.js";
import Rating from "../models/Rating.js";
import RatingStatus from "../models/RatingStatus.js";
import RegistrationOTP from "../models/registrationOtpModel.js";
import RefreshToken from "../models/refreshTokenModel.js";
import Session from "../models/sessionModel.js";
import AIChat from "../models/chatModel.js";

import PrivateAsset from "../models/PrivateAsset.js";
import LoginChallenge from "../models/loginChallengeModel.js";
import Transaction from "../models/transactionModel.js";
import CounselorEarning from "../models/CounselorEarning.js";

const toObjectId = (value) => {
  if (!mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
};

export const cleanupAccountData = async ({ userId, email, cleanupContext, eraseFinancial = false, mongoSession = null } = {}) => {
  const objectId = toObjectId(userId);
  if (!objectId) {
    throw new Error("A valid userId is required for account cleanup");
  }

  if (!mongoSession) await revokeConsent(objectId);

  const idFilter = { $in: [objectId, String(objectId)] };
  const chats = cleanupContext?.chats || await Chat.find({
    $or: [{ userId: objectId }, { counselorId: objectId }],
  }).select("_id chatId paidSessionId").session(mongoSession);
  const chatObjectIds = chats.map((chat) => chat._id);
  const chatPublicIds = chats.map((chat) => chat.chatId).filter(Boolean);
  const paidSessionIds = chats.map((chat) => chat.paidSessionId).filter(Boolean);
  const messageChatIds = [...chatObjectIds, ...chatPublicIds];

  const erasures = [];
  const erase = (model, filter) => {
    erasures.push({ model, filter });
    return model.deleteMany(filter).session(mongoSession);
  };
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const cleanupTasks = [
    erase(UserBlock, { $or: [{ blockerId: objectId }, { blockedId: objectId }] }),
    erase(AbuseReport, { $or: [{ reporterId: objectId }, { reportedId: objectId }] }),
    erase(AIConsent, { userId: objectId }),
    erase(PrivateAsset, { $or: [{ ownerId: objectId }, { chatId: { $in: chatObjectIds } }] }),
    erase(LoginChallenge, { _id: objectId }),
    erase(Appointment, { $or: [{ patient: objectId }, { counselor: objectId }] }),
    erase(Call, {
      $or: [{ callerId: objectId }, { receiverId: objectId }, { endedBy: objectId }],
    }),
    erase(Notification, {
      $or: [{ recipientId: objectId }, { actorId: objectId }],
    }),
    erase(Session, { userId: objectId }),
    erase(RefreshToken, { userId: objectId }),
    erase(OTP, { userId: objectId }),
    erase(LoginOTP, { userId: objectId }),
    erase(AIChat, { userId: idFilter }),
    erase(Prescription, prescriptionAccountOwnershipFilter(objectId, chatObjectIds)),
    erase(Conversation, {
      $or: [
        { "participants.user": objectId },
        { "participants.counsellor": objectId },
      ],
    }),
    erase(Rating, { $or: [{ userId: objectId }, { counselorId: objectId }] }),
    erase(RatingStatus, { $or: [{ userId: objectId }, { counselorId: objectId }] }),
    erase(ChatSession, {
      $or: [
        { userId: objectId },
        { counselorId: objectId },
        ...(paidSessionIds.length ? [{ _id: { $in: paidSessionIds } }] : []),
      ],
    }),
  ];

  if (messageChatIds.length) {
    cleanupTasks.push(
      erase(Message, {
        $or: [
          { chatId: { $in: messageChatIds } },
          { senderId: objectId },
        ],
      }),
    );
  } else {
    cleanupTasks.push(erase(Message, { senderId: objectId }));
  }

  cleanupTasks.push(erase(Chat, { _id: { $in: chatObjectIds } }));

  if (normalizedEmail) {
    cleanupTasks.push(
      erase(RegistrationOTP, { email: normalizedEmail }),
      erase(ForgotPasswordToken, { email: normalizedEmail }),
    );
  }

  if (eraseFinancial) cleanupTasks.push(
    erase(Transaction, { $or: [{ userId: objectId }, { counselorId: objectId }] }),
    erase(CounselorEarning, { $or: [{ userId: objectId }, { counselorId: objectId }] }),
  );
  // MongoDB transactions require sequential operations on a shared session.
  const results = [];
  for (const task of cleanupTasks) results.push(await task);
  const summary = results.reduce((acc, result, index) => {
    acc.operations += 1;
    acc.deletedCount += Number(result?.deletedCount || 0);
    acc.modifiedCount += Number(result?.modifiedCount || 0);
    acc.acknowledged = acc.acknowledged && result?.acknowledged === true;
    acc[`op${index + 1}`] = Number(result?.deletedCount || result?.modifiedCount || 0);
    return acc;
  }, {
    operations: 0,
    deletedCount: 0,
    modifiedCount: 0,
    acknowledged: true,
  });

  // An acknowledged write alone does not prove the related data is gone.
  // Recheck the exact same ownership filters, including persisted chat inventory.
  const remaining = [];
  for (const { model, filter } of erasures) remaining.push(await model.countDocuments(filter).session(mongoSession));
  if (!summary.acknowledged || remaining.some(count => count !== 0)) throw new Error("Account cleanup verification failed");
  return {
    verified: true,
    ...summary,
    chatCount: chatObjectIds.length,
    paymentHistoryPreserved: !eraseFinancial,
  };
};

export default cleanupAccountData;
