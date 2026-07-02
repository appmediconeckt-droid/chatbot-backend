import Chat from "../models/Chat.js";
import ChatSession from "../models/ChatSession.js";
import CounselorEarning from "../models/CounselorEarning.js";
import Transaction from "../models/transactionModel.js";
import User from "../models/userModel.js";

const truthy = new Set(["1", "true", "yes", "on", "enabled"]);

export const isPaidSessionsEnabled = () =>
  truthy.has(String(process.env.PAID_COUNSELOR_SESSIONS_ENABLED || "").toLowerCase());

export const getPaidSessionConfig = () => ({
  enabled: isPaidSessionsEnabled(),
  fees: {
    chat: Number(process.env.COUNSELOR_CHAT_FEE || 100),
    voice: Number(process.env.COUNSELOR_VOICE_FEE || 200),
    video: Number(process.env.COUNSELOR_VIDEO_FEE || 300),
  },
  durationMinutes: Number(process.env.COUNSELOR_SESSION_DURATION_MINUTES || 30),
  requestExpiryHours: Number(process.env.COUNSELOR_REQUEST_EXPIRY_HOURS || 24),
  commissionRate: Number(process.env.PLATFORM_COMMISSION_PERCENT || 20),
});

export const getSessionAmount = (sessionType = "chat") => {
  const { fees } = getPaidSessionConfig();
  return fees[sessionType] ?? fees.chat;
};

export const getRequestExpiryDate = () => {
  const { requestExpiryHours } = getPaidSessionConfig();
  return new Date(Date.now() + requestExpiryHours * 60 * 60 * 1000);
};

export const createPaidSessionHold = async ({
  userId,
  counselorId,
  chat,
  sessionType = "chat",
}) => {
  if (!isPaidSessionsEnabled()) {
    return null;
  }

  const amount = getSessionAmount(sessionType);
  const user = await User.findById(userId);

  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  if ((user.walletBalance || 0) < amount) {
    const error = new Error("Insufficient wallet balance");
    error.statusCode = 402;
    error.requiredAmount = amount;
    error.walletBalance = user.walletBalance || 0;
    throw error;
  }

  user.walletBalance = (user.walletBalance || 0) - amount;
  await user.save();

  const transaction = await Transaction.create({
    userId,
    counselorId,
    chatId: chat._id,
    amount,
    status: "hold",
    type: "debit",
    description: `${sessionType} session payment hold`,
    metadata: {
      sessionType,
      paidFeatureFlag: "PAID_COUNSELOR_SESSIONS_ENABLED",
    },
  });

  const session = await ChatSession.create({
    userId,
    counselorId,
    chatId: chat._id,
    sessionType,
    amount,
    commissionRate: getPaidSessionConfig().commissionRate,
    paymentStatus: "hold",
    sessionStatus: "pending",
    paymentTransactionId: transaction._id,
    expiresAt: chat.expiresAt || getRequestExpiryDate(),
  });

  transaction.sessionId = session._id;
  await transaction.save();

  chat.amount = amount;
  chat.sessionType = sessionType;
  chat.paymentStatus = "hold";
  chat.paymentTransactionId = transaction._id;
  chat.paidSessionId = session._id;
  await chat.save();

  return { session, transaction, amount, walletBalance: user.walletBalance };
};

export const activatePaidSession = async (chat) => {
  if (!isPaidSessionsEnabled() || !chat?.paidSessionId) {
    return null;
  }

  const session = await ChatSession.findById(chat.paidSessionId);
  if (!session || session.sessionStatus !== "pending") {
    return session;
  }

  session.sessionStatus = "active";
  session.paymentStatus = "paid";
  session.acceptedAt = new Date();
  await session.save();

  chat.paymentStatus = "paid";
  await chat.save();

  return session;
};

export const refundPaidSession = async (chat, reason = "request_not_accepted") => {
  if (!isPaidSessionsEnabled() || !chat?.paidSessionId) {
    return null;
  }

  const session = await ChatSession.findById(chat.paidSessionId);
  if (!session || session.paymentStatus === "refunded") {
    return session;
  }

  if (!["pending", "active"].includes(session.sessionStatus)) {
    return session;
  }

  const user = await User.findById(session.userId);
  if (user) {
    user.walletBalance = (user.walletBalance || 0) + session.amount;
    await user.save();
  }

  const holdTransaction = session.paymentTransactionId
    ? await Transaction.findById(session.paymentTransactionId)
    : null;

  if (holdTransaction) {
    holdTransaction.status = "refunded";
    await holdTransaction.save();
  }

  await Transaction.create({
    userId: session.userId,
    counselorId: session.counselorId,
    chatId: session.chatId,
    sessionId: session._id,
    relatedTransactionId: holdTransaction?._id,
    amount: session.amount,
    status: "completed",
    type: "refund",
    description: `Refund for ${session.sessionType} session`,
    metadata: { reason },
  });

  session.paymentStatus = "refunded";
  session.sessionStatus = "refunded";
  session.refundReason = reason;
  session.endedAt = new Date();
  await session.save();

  chat.paymentStatus = "refunded";
  chat.cancelledAt = chat.cancelledAt || new Date();
  await chat.save();

  return session;
};

export const completePaidSession = async (chat) => {
  if (!isPaidSessionsEnabled() || !chat?.paidSessionId) {
    return null;
  }

  const session = await ChatSession.findById(chat.paidSessionId);
  if (!session || session.sessionStatus === "completed") {
    return session;
  }

  if (session.paymentStatus === "refunded") {
    return session;
  }

  const commissionAmount = Number(
    ((session.amount * session.commissionRate) / 100).toFixed(2),
  );
  const counselorEarning = Number((session.amount - commissionAmount).toFixed(2));

  let earning = await CounselorEarning.findOne({ sessionId: session._id });
  if (!earning) {
    earning = await CounselorEarning.create({
      counselorId: session.counselorId,
      userId: session.userId,
      sessionId: session._id,
      chatId: session.chatId,
      sessionType: session.sessionType,
      totalAmount: session.amount,
      commission: commissionAmount,
      earningAmount: counselorEarning,
      payoutStatus: "pending",
    });

    await User.findByIdAndUpdate(session.counselorId, {
      $inc: { walletBalance: counselorEarning, totalSessions: 1 },
    });
  }

  session.sessionStatus = "completed";
  session.paymentStatus = "released";
  session.commissionAmount = commissionAmount;
  session.counselorEarning = counselorEarning;
  session.earningId = earning._id;
  session.endedAt = new Date();
  await session.save();

  chat.paymentStatus = "released";
  chat.status = chat.status === "closed" ? chat.status : "closed";
  chat.closedAt = chat.closedAt || new Date();
  chat.isActive = false;
  await chat.save();

  return session;
};

export const expirePendingPaidChatRequests = async () => {
  if (!isPaidSessionsEnabled()) {
    return 0;
  }

  const now = new Date();
  const expiredChats = await Chat.find({
    status: "pending",
    paymentStatus: "hold",
    expiresAt: { $lte: now },
    isActive: true,
  }).limit(100);

  for (const chat of expiredChats) {
    chat.status = "cancelled";
    chat.isActive = false;
    chat.cancelledAt = now;
    await refundPaidSession(chat, "request_expired_24h");
    await chat.save();
  }

  return expiredChats.length;
};
