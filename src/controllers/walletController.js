import User from "../models/userModel.js";
import Transaction from "../models/transactionModel.js";
import CounselorEarning from "../models/CounselorEarning.js";

const disabled = (_req, res) =>
  res.status(403).json({
    success: false,
    code: "REAL_PAYMENTS_DISABLED",
    paymentMode: "demo",
    message:
      "Demonstration only. Real payments, withdrawals and payouts are disabled. No money is charged or transferred.",
  });
// Preserve legacy route contracts, but never initiate or verify provider work.
export const createOrder = disabled;
export const verifyPayment = disabled;
export const reconcileWalletPayment = disabled;
export const razorpayWebhook = disabled;
export const requestWithdrawal = disabled;
const clampInteger = (value, fallback, min, max) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const escapeRegex = (value) =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const simulatePayment = async (req, res) => {
  const amount = Number(req.body?.amount);
  const requestId = String(req.body?.requestId || "");
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    amount > 100000 ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001 ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)
  ) {
    return res
      .status(400)
      .json({
        success: false,
        message:
          "A valid demo amount (up to 100000) and requestId are required.",
      });
  }
  if (req.user?.demoPaymentsEnabled !== true) {
    return res.status(403).json({ success: false, code: "DEMO_SIMULATION_DISABLED", message: "Payment simulation is restricted to designated test accounts. Public booking and chat are free." });
  }
  try {
    const filter = { userId: req.user._id, demoRequestId: requestId };
    let transaction;
    try {
      transaction = await Transaction.findOneAndUpdate(
        filter,
        {
          $setOnInsert: {
            ...filter,
            amount,
            paymentMode: "demo",
            status: "demo_pending",
            type: "credit",
            description: "Demo wallet top-up — no monetary value",
            redeemable: false,
          },
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      transaction = await Transaction.findOne(filter);
    }
    if (Number(transaction.amount) !== amount) {
      return res
        .status(409)
        .json({
          success: false,
          message: "Use a new requestId for a different demo amount.",
        });
    }
    // Balance credit and retry marker are one atomic operation. Interrupted
    // requests can be retried with the same requestId without double credit.
    const result = await User.updateOne(
      { _id: req.user._id, demoWalletCreditIds: { $ne: requestId } },
      {
        $inc: { demoWalletBalance: amount },
        $addToSet: { demoWalletCreditIds: requestId },
      }
    );
    const user = await User.findById(req.user._id).select("demoWalletBalance");
    if (!user)
      return res.status(404).json({ message: "Wallet owner not found" });
    transaction.status = "demo_completed";
    await transaction.save();
    return res.json({
      success: true,
      paymentMode: "demo",
      status: "demo_completed",
      redeemable: false,
      message: "Demo Payment Successful",
      balance: user.demoWalletBalance || 0,
      alreadyCredited: result.modifiedCount === 0,
      transaction,
    });
  } catch (error) {
    console.error("Demo simulation failed:", error.message);
    return res
      .status(500)
      .json({
        success: false,
        message:
          "Demo simulation could not complete. Retry with the same requestId.",
      });
  }
};

// Get Wallet Balance and History
export const getWalletData = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "Account not found" });
    if (user.demoPaymentsEnabled !== true) return res.json({
      paymentMode: "free", paymentsEnabled: false, simulationEnabled: false,
      redeemable: false, withdrawalsEnabled: false, balance: 0, transactions: [],
      spendingSummary: { total: 0, breakdown: [] },
      message: "Bookings and chat are free. Payments, deposits and withdrawals are unavailable."
    });
    const transactionFilter = {
      userId,
      paymentMode: "demo",
      status: { $in: ["demo_completed", "demo_refunded"] },
    };
    const hasPaginationParams =
      req.query.page != null || req.query.limit != null;
    const defaultLimit = req.query.from || req.query.to ? 1000 : 50;
    const page = clampInteger(req.query.page, 1, 1, 100000);
    const limit = clampInteger(
      req.query.limit,
      defaultLimit,
      1,
      hasPaginationParams ? 100 : defaultLimit
    );
    const skip = (page - 1) * limit;
    const from = req.query.from
      ? new Date(`${req.query.from}T00:00:00.000+05:30`)
      : null;
    const to = req.query.to
      ? new Date(`${req.query.to}T23:59:59.999+05:30`)
      : null;
    const type = String(req.query.type || "")
      .trim()
      .toLowerCase();
    const status = String(req.query.status || "")
      .trim()
      .toLowerCase();
    const search = String(req.query.search || "").trim();

    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime()))
    ) {
      return res.status(400).json({ message: "Invalid date range" });
    }
    if (from && to && from > to) {
      return res
        .status(400)
        .json({ message: "From date cannot be after To date" });
    }
    if (from || to) {
      transactionFilter.createdAt = {};
      if (from) transactionFilter.createdAt.$gte = from;
      if (to) transactionFilter.createdAt.$lte = to;
    }
    if (["credit", "debit", "refund"].includes(type)) {
      transactionFilter.type = type;
    }
    if (["demo_completed", "demo_refunded"].includes(status)) {
      transactionFilter.status = status;
    }
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      const matchingCounselors = await User.find({ fullName: regex })
        .select("_id")
        .lean();
      const counselorIds = matchingCounselors.map((counselor) => counselor._id);
      transactionFilter.$or = [
        { description: regex },
        { razorpayPaymentId: regex },
        { razorpayOrderId: regex },
        ...(counselorIds.length
          ? [{ counselorId: { $in: counselorIds } }]
          : []),
      ];
    }

    // A selected statement range returns the complete range (up to a safe
    // export limit); the regular wallet view keeps a smaller recent list.
    const [transactions, totalTransactions] = await Promise.all([
      Transaction.find(transactionFilter)
        .populate("counselorId", "fullName profilePhoto specialization")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Transaction.countDocuments(transactionFilter),
    ]);

    // Calculate Monthly Spending
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const debitDateFilter =
      from || to ? transactionFilter.createdAt : { $gte: startOfMonth };
    const monthlyDebits = await Transaction.find({
      userId,
      type: "debit",
      paymentMode: "demo",
      status: "demo_completed",
      createdAt: debitDateFilter,
    });

    const totalSpent = monthlyDebits.reduce(
      (acc, curr) => acc + curr.amount,
      0
    );

    // Simple grouping for summary (example: based on description)
    const summary = {
      consultations: monthlyDebits
        .filter((d) => d.description.toLowerCase().includes("consult"))
        .reduce((acc, curr) => acc + curr.amount, 0),
      other: monthlyDebits
        .filter((d) => !d.description.toLowerCase().includes("consult"))
        .reduce((acc, curr) => acc + curr.amount, 0),
    };

    res.status(200).json({
      paymentMode: "demo",
      simulationEnabled: true,
      paymentsEnabled: false,
      redeemable: false,
      withdrawalsEnabled: false,
      balance: user.demoWalletBalance || 0,
      transactions,
      pagination: {
        page,
        limit,
        total: totalTransactions,
        totalPages: Math.max(1, Math.ceil(totalTransactions / limit)),
        hasNextPage: skip + transactions.length < totalTransactions,
        hasPreviousPage: page > 1,
      },
      spendingSummary: {
        total: totalSpent,
        period: {
          from: from?.toISOString() || startOfMonth.toISOString(),
          to: to?.toISOString() || new Date().toISOString(),
        },
        breakdown: [
          {
            label: "Consultations",
            amount: summary.consultations,
            percentage:
              totalSpent > 0 ? (summary.consultations / totalSpent) * 100 : 0,
          },
          {
            label: "Other",
            amount: summary.other,
            percentage: totalSpent > 0 ? (summary.other / totalSpent) * 100 : 0,
          },
        ],
      },
    });
  } catch (error) {
    console.error("Error fetching wallet data:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getCounselorWalletData = async (req, res) => {
  try {
    const counselorId = req.user._id;
    const { from, to } = req.query;
    const createdAt = {};
    for (const [key, value, suffix] of [
      ["$gte", from, "T00:00:00.000+05:30"],
      ["$lte", to, "T23:59:59.999+05:30"],
    ]) {
      if (!value) continue;
      const date = new Date(`${value}${suffix}`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()))
        return res.status(400).json({ message: "Invalid date range" });
      createdAt[key] = date;
    }
    if (createdAt.$gte && createdAt.$lte && createdAt.$gte > createdAt.$lte)
      return res.status(400).json({ message: "Invalid date range" });
    const account = await User.findById(counselorId).select("demoPaymentsEnabled");
    if (account?.demoPaymentsEnabled !== true) return res.json({
      paymentMode: "free", paymentsEnabled: false, simulationEnabled: false,
      redeemable: false, payoutsEnabled: false, withdrawalsEnabled: false,
      balance: 0, totalEarned: 0, pendingPayout: 0, grossRevenue: 0,
      platformCommission: 0, monthlyEarned: 0, earnings: [], withdrawals: [], payoutAccount: null,
      message: "Consultations are free in this release. No monetary earnings or payouts are created."
    });
    const earnings = await CounselorEarning.find({
      counselorId,
      paymentMode: "demo",
      earningStatus: "demo_completed",
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
    })
      .populate("userId", "anonymous")
      .sort({ createdAt: -1 })
      .lean();
    const counselor = await User.findById(counselorId).select(
      "demoWalletBalance"
    );
    const sum = (key) =>
      earnings.reduce((total, row) => total + Number(row[key] || 0), 0);
    const month = new Date();
    month.setDate(1);
    month.setHours(0, 0, 0, 0);
    return res.json({
      paymentMode: "demo",
      redeemable: false,
      simulationEnabled: true,
      payoutsEnabled: false,
      withdrawalsEnabled: false,
      balance: counselor?.demoWalletBalance || 0,
      totalEarned: sum("earningAmount"),
      pendingPayout: 0,
      grossRevenue: sum("totalAmount"),
      platformCommission: sum("commission"),
      monthlyEarned: earnings
        .filter((row) => new Date(row.createdAt) >= month)
        .reduce((n, row) => n + row.earningAmount, 0),
      split: { counselorPercentage: 80, platformPercentage: 20 },
      payoutOptions: {
        instant: { available: false },
        standard: { available: false },
      },
      earnings,
      withdrawals: [],
      payoutAccount: null,
      message:
        "Simulated earnings only. Demo balances cannot be withdrawn or redeemed.",
    });
  } catch (error) {
    console.error("Demo earnings failed:", error.message);
    return res.status(500).json({ message: "Could not load demo earnings" });
  }
};
