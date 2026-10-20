import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import AIConsent from "../models/AIConsent.js";
export const CONSENT_VERSION = "openai-ai-v1";
export const aiContext = new AsyncLocalStorage();
export const consentError = () =>
  Object.assign(
    new Error("Please accept AI privacy consent before using this feature."),
    { status: 403, code: "AI_CONSENT_REQUIRED" }
  );
export const isCurrentConsent = (state) =>
  state?.consentGranted === true &&
  state?.consentVersion === CONSENT_VERSION &&
  state?.provider === "OpenAI" &&
  state?.consentedAt instanceof Date &&
  Number.isFinite(state.consentedAt.getTime()) &&
  state.consentedAt.getTime() <= Date.now() &&
  state.revokedAt == null;
export const consentState = (state) => ({
  success: true,
  consented: isCurrentConsent(state),
  provider: "OpenAI",
  consentVersion: CONSENT_VERSION,
  consentedAt: state?.consentedAt || null,
  revokedAt: state?.revokedAt || null,
});
export const readConsent = (userId) =>
  AIConsent.findOne({ userId, provider: "OpenAI" });
export async function assertConsent(userId) {
  if (!userId)
    throw Object.assign(new Error("Authentication required"), { status: 401 });
  if (!isCurrentConsent(await readConsent(userId))) throw consentError();
}
// A database lease serializes provider transmission/session creation and revocation
// across server processes. Provider timeout stays below the lease duration.
export async function withConsentLock(userId, operation) {
  await AIConsent.updateOne(
    { userId, provider: "OpenAI" },
    { $setOnInsert: { consentGranted: false, lockUntil: new Date(0) } },
    { upsert: true }
  ).catch((error) => {
    if (error.code !== 11000) throw error;
  });
  const token = randomUUID();
  const deadline = Date.now() + 65000;
  let state;
  do {
    state = await AIConsent.findOneAndUpdate(
      { userId, provider: "OpenAI", lockUntil: { $lte: new Date() } },
      { $set: { lockToken: token, lockUntil: new Date(Date.now() + 120000) } },
      { new: true }
    );
    if (!state) await new Promise((resolve) => setTimeout(resolve, 50));
  } while (!state && Date.now() < deadline);
  if (!state)
    throw Object.assign(new Error("AI request busy. Please retry."), {
      status: 503,
    });
  try {
    return await operation(state);
  } finally {
    await AIConsent.updateOne(
      { _id: state._id, lockToken: token },
      { $set: { lockUntil: new Date(0) }, $unset: { lockToken: 1 } }
    );
  }
}
const nativeFetch = (...args) => globalThis.fetch(...args);
export async function hangupCall(callId) {
  const response = await nativeFetch(
    `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(
      callId
    )}/hangup`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(10000),
    }
  );
  if (!response.ok && response.status !== 404 && response.status !== 410)
    throw new Error("Unable to terminate AI call. Please retry withdrawal.");
}
// All OpenAI clients and raw realtime requests use this transport. No request
// context (including accidental background work) means no provider access.
export async function consentFetch(url, options = {}) {
  const userId = aiContext.getStore()?.userId;
  if (!userId) throw consentError();
  return withConsentLock(userId, async (state) => {
    if (!isCurrentConsent(state)) throw consentError();
    const now = Date.now();
    const windowStart = state.rateWindowAt?.getTime() || 0;
    const count = now - windowStart < 60000 ? state.rateCount || 0 : 0;
    if (count >= 30)
      throw Object.assign(
        new Error("AI rate limit reached. Please retry shortly."),
        { status: 429 }
      );
    await AIConsent.updateOne(
      { _id: state._id },
      {
        $set: {
          rateWindowAt: new Date(count ? windowStart : now),
          rateCount: count + 1,
        },
      }
    );
    const signal = options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(60000)])
      : AbortSignal.timeout(60000);
    if (
      String(url).endsWith("/realtime/calls") &&
      state.activeCalls?.length >= 5
    ) {
      await Promise.all(state.activeCalls.map(hangupCall));
      await AIConsent.updateOne(
        { _id: state._id },
        { $set: { activeCalls: [] } }
      );
    }
    const response = await nativeFetch(url, { ...options, signal });
    if (String(url).endsWith("/realtime/calls") && response.ok) {
      const callId = response.headers.get("location")?.split("/").pop();
      if (!callId || !/^rtc_[a-zA-Z0-9_-]+$/.test(callId))
        throw new Error("AI voice session could not be safely registered");
      try {
        await AIConsent.updateOne(
          { _id: state._id },
          { $addToSet: { activeCalls: callId } }
        );
      } catch (error) {
        await hangupCall(callId);
        throw error;
      }
    }
    return response;
  });
}
export async function requireAIConsent(req, res, next) {
  try {
    await assertConsent(req.user?._id);
    return aiContext.run({ userId: req.user._id }, next);
  } catch (error) {
    return res
      .status(error.status || 503)
      .json({
        success: false,
        code: error.code || "AI_UNAVAILABLE",
        message:
          error.status === 403
            ? error.message
            : "AI service unavailable. Please retry.",
      });
  }
}

export async function revokeConsent(userId) {
  return withConsentLock(userId, async (current) => {
    const now = new Date();
    const saved = await AIConsent.findByIdAndUpdate(
      current._id,
      {
        $set: { consentGranted: false, revokedAt: now },
        $push: {
          events: {
            $each: [
              {
                version: current.consentVersion || CONSENT_VERSION,
                granted: false,
                at: now,
              },
            ],
            $slice: -100,
          },
        },
      },
      { new: true }
    );
    await Promise.all((saved.activeCalls || []).map(hangupCall));
    await AIConsent.updateOne(
      { _id: saved._id },
      { $set: { activeCalls: [] } }
    );
    return saved;
  });
}

// SDKs wrap transport exceptions; preserve consent/rate-limit errors through causes.
export function sendAIError(
  res,
  error,
  message = "AI service unavailable. Please retry."
) {
  let cause = error;
  for (let depth = 0; cause && depth < 8; depth++, cause = cause.cause) {
    if (cause.code === "AI_CONSENT_REQUIRED")
      return res
        .status(403)
        .json({
          success: false,
          code: "AI_CONSENT_REQUIRED",
          message: consentError().message,
        });
    if (cause.status === 429)
      return res
        .status(429)
        .json({
          success: false,
          code: "AI_RATE_LIMITED",
          message: "AI rate limit reached. Please retry shortly.",
        });
  }
  return res
    .status(502)
    .json({ success: false, code: "AI_PROVIDER_UNAVAILABLE", message });
}
