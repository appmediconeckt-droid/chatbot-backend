import { terms, contentHash } from "../legal/terms.js";

// Approved in the 16 November 2026 implementation session: new accounts only;
// existing-account login/linking is deliberately outside this enrollment rule.
export function registrationEligibility(body, res, channel, now = new Date()) {
  const fail = (code, message) => { res.status(400).json({ success: false, code, message }); return null; };
  let age;
  if (body.dateOfBirth !== undefined && body.dateOfBirth !== "") {
    const raw = typeof body.dateOfBirth === "string" ? body.dateOfBirth : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return fail("AGE_ELIGIBILITY_REQUIRED", "Enter a valid date of birth (YYYY-MM-DD).");
    const date = new Date(`${raw}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== raw || date > now) return fail("AGE_ELIGIBILITY_REQUIRED", "Enter a valid date of birth.");
    age = now.getUTCFullYear() - date.getUTCFullYear();
    if (now.toISOString().slice(5, 10) < raw.slice(5)) age -= 1;
  } else {
    const raw = ["string", "number"].includes(typeof body.age) ? String(body.age) : "";
    age = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  }
  if (!Number.isInteger(age) || age < 18 || age > 150) return fail("AGE_ELIGIBILITY_REQUIRED", "New accounts require age 18 or older. Complete the signup form before signing in.");
  if (![true, "true"].includes(body.termsAccepted) || body.termsVersion !== terms.version || body.termsContentSha256 !== contentHash(terms)) {
    return fail("TERMS_CONSENT_REQUIRED", "Update to the latest app or use the current signup form to read and accept the Terms & Conditions.");
  }
  return { age, consent: { version: terms.version, contentSha256: contentHash(terms), acceptedAt: now, channel, eligibilityPolicy: "new-accounts-18-plus-2026-11-16", declaredAge: age } };
}
