import crypto from "node:crypto";
import LoginChallenge from "../models/loginChallengeModel.js";

const digest = (id, nonce, otp) => {
  if (!process.env.ACCESS_SECRET) throw new Error("Login challenge secret missing");
  return crypto.createHmac("sha256", process.env.ACCESS_SECRET)
    .update(`${id}:${nonce}:${otp}`).digest("hex");
};
export async function issueLoginChallenge(user, otp) {
  const nonce = crypto.randomBytes(24).toString("hex");
  // _id enforces one record per account even before secondary indexes exist.
  const update = { $set: {
    email: user.email, role: user.role, nonce,
    otpHash: digest(user._id, nonce, otp), attempts: 0, consumedAt: null,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  } };
  try {
    return await LoginChallenge.findOneAndUpdate({ _id: user._id }, update,
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    return LoginChallenge.findOneAndUpdate({ _id: user._id }, update,
      { returnDocument: "after" });
  }
}
export async function consumeLoginChallenge(user, otp) {
  const stored = await LoginChallenge.findById(user._id);
  if (!stored || stored.consumedAt || stored.expiresAt <= new Date() || stored.attempts >= 5 || stored.role !== user.role) return false;
  const query = { _id: user._id, nonce: stored.nonce, consumedAt: null,
    expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } };
  const hash = digest(user._id, stored.nonce, otp);
  if (!crypto.timingSafeEqual(Buffer.from(stored.otpHash, "hex"), Buffer.from(hash, "hex"))) {
    await LoginChallenge.updateOne(query, { $inc: { attempts: 1 } });
    return false;
  }
  return Boolean(await LoginChallenge.findOneAndUpdate({ ...query, otpHash: hash },
    { $set: { consumedAt: new Date() } }, { returnDocument: "after" }));
}
export async function discardLoginChallenge(record) {
  // A failed older delivery must never erase a newer resend.
  await LoginChallenge.deleteOne({ _id: record._id, nonce: record.nonce });
}
