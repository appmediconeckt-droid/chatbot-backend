import mongoose from "mongoose";
import Rating from "../models/Rating.js";
import User from "../models/userModel.js";

// Recompute and persist a counselor's aggregate rating + count from the Rating
// collection. Kept in one place so submit/delete stay consistent.
const recomputeCounselorRating = async (counselorId) => {
  const result = await Rating.aggregate([
    { $match: { counselorId: new mongoose.Types.ObjectId(counselorId) } },
    {
      $group: {
        _id: "$counselorId",
        avg: { $avg: "$stars" },
        count: { $sum: 1 },
      },
    },
  ]);

  const avg = result[0]?.avg || 0;
  const count = result[0]?.count || 0;
  // Round the average to one decimal place for clean display (e.g. 4.6).
  const rating = Math.round(avg * 10) / 10;

  await User.findByIdAndUpdate(counselorId, { rating, ratingCount: count });
  return { rating, ratingCount: count };
};

/**
 * POST /api/counselors/:counselorId/ratings
 * Body: { stars: 1-5, comment?: string, chatId?: string }
 * Only users can rate. Re-rating the same chat session updates the existing one.
 */
export const submitRating = async (req, res) => {
  try {
    if (req.user.role !== "user") {
      return res.status(403).json({ error: "Only users can rate counselors" });
    }

    const { counselorId } = req.params;
    const { stars, comment = "", chatId = null } = req.body;

    if (!mongoose.Types.ObjectId.isValid(counselorId)) {
      return res.status(400).json({ error: "Invalid counselor id" });
    }

    const starsNum = Number(stars);
    if (!Number.isFinite(starsNum) || starsNum < 1 || starsNum > 5) {
      return res.status(400).json({ error: "stars must be between 1 and 5" });
    }

    const counselor = await User.findOne({
      _id: counselorId,
      role: "counsellor",
    });
    if (!counselor) {
      return res.status(404).json({ error: "Counselor not found" });
    }

    const cleanComment = String(comment || "").trim().slice(0, 500);

    if (chatId) {
      // Upsert so a session can be rated once and updated if re-submitted.
      await Rating.findOneAndUpdate(
        { userId: req.user._id, chatId },
        {
          $set: {
            counselorId,
            stars: starsNum,
            comment: cleanComment,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    } else {
      // No chatId — just record the rating.
      await Rating.create({
        counselorId,
        userId: req.user._id,
        stars: starsNum,
        comment: cleanComment,
      });
    }

    const aggregate = await recomputeCounselorRating(counselorId);
    return res.json(aggregate); // { rating, ratingCount }
  } catch (error) {
    // Duplicate-key (race on the unique index) → treat as already rated.
    if (error?.code === 11000) {
      try {
        const aggregate = await recomputeCounselorRating(req.params.counselorId);
        return res.json(aggregate);
      } catch (_) {
        /* fall through */
      }
    }
    console.error("Error submitting rating:", error);
    return res.status(500).json({ error: "Error submitting rating" });
  }
};

/**
 * GET /api/counselors/:counselorId/ratings
 * Public-ish list of recent reviews for a counselor (most recent first).
 */
export const getCounselorRatings = async (req, res) => {
  try {
    const { counselorId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(counselorId)) {
      return res.status(400).json({ error: "Invalid counselor id" });
    }

    const ratings = await Rating.find({ counselorId })
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("userId", "fullName profilePhoto")
      .lean();

    return res.json({ ratings });
  } catch (error) {
    console.error("Error fetching ratings:", error);
    return res.status(500).json({ error: "Error fetching ratings" });
  }
};
