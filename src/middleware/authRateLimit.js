import { BlockList, isIP } from "node:net";
import crypto from "node:crypto";
import mongoose from "mongoose";

const schema = new mongoose.Schema({
  _id: String, count: { type: Number, default: 0 }, expiresAt: Date,
});
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AuthRateBucket = mongoose.models.AuthRateBucket || mongoose.model("AuthRateBucket", schema);

// Never rate-limit an entire Railway proxy/NAT as though it were one client.
// Ignore forwarding headers unless the app explicitly configures a trusted proxy.
const privatePeers = new BlockList();
for (const [network, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],
  ["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.168.0.0",16]]) {
  privatePeers.addSubnet(network, prefix, "ipv4");
}
privatePeers.addSubnet("::1",128,"ipv6");
privatePeers.addSubnet("fc00::",7,"ipv6");
privatePeers.addSubnet("fe80::",10,"ipv6");
export const publicAuthPeer = value => {
  const ip = String(value || "").replace(/^::ffff:/i, "");
  const version = isIP(ip);
  return version && !privatePeers.check(ip, version === 4 ? "ipv4" : "ipv6") ? ip : null;
};

// Shared database counters survive process restarts and apply across replicas.
export async function authRateLimit(req, res, next) {
  const windowMs = 15 * 60 * 1000;
  const window = Math.floor(Date.now() / windowMs);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const peer = publicAuthPeer(req.ip || req.socket?.remoteAddress);
  const dimensions = peer ? [[`ip:${peer}`, 300]] : [];
  if (email) dimensions.push([`email:${email}`, 60]);
  try {
    for (const [identity, limit] of dimensions) {
      const key = crypto.createHash("sha256").update(`${window}:${identity}`).digest("hex");
      let bucket;
      try {
        bucket = await AuthRateBucket.findOneAndUpdate({ _id: key }, {
          $inc: { count: 1 }, $setOnInsert: { expiresAt: new Date((window + 2) * windowMs) },
        }, { upsert: true, returnDocument: "after" });
      } catch (error) {
        if (error.code !== 11000) throw error;
        bucket = await AuthRateBucket.findOneAndUpdate({ _id: key }, { $inc: { count: 1 } }, { returnDocument: "after" });
      }
      if (bucket.count > limit) {
        res.setHeader("Retry-After", String(Math.ceil(((window + 1) * windowMs - Date.now()) / 1000)));
        return res.status(429).json({ success: false, message: "Too many authentication attempts. Please try again later." });
      }
    }
    return next();
  } catch {
    // Database errors must fail closed without logging request credentials.
    return res.status(503).json({ success: false, message: "Authentication temporarily unavailable" });
  }
}
