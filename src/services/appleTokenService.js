import crypto from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";

const failure = (code, message, status = 503) =>
  Object.assign(new Error(message), { code, status });
const clientId = () =>
  process.env.APPLE_CLIENT_ID ||
  process.env.APPLE_BUNDLE_ID ||
  "com.mindcrawller.humaeli";
const encryptionKey = () => {
  const key = process.env.APPLE_TOKEN_ENCRYPTION_KEY || "";
  if (!/^[a-fA-F0-9]{64}$/.test(key))
    throw failure(
      "APPLE_REVOCATION_SETUP_REQUIRED",
      "Apple account deletion needs server configuration. Please contact support@humaeli.com."
    );
  return Buffer.from(key, "hex");
};
export const appleTokenStorageConfigured = () =>
  Boolean(
    /^[a-fA-F0-9]{64}$/.test(process.env.APPLE_TOKEN_ENCRYPTION_KEY || "") &&
      (process.env.APPLE_CLIENT_SECRET ||
        (process.env.APPLE_TEAM_ID &&
          process.env.APPLE_KEY_ID &&
          process.env.APPLE_PRIVATE_KEY))
  );
export function encryptAppleToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}
export function decryptAppleToken(value) {
  const [version, iv, tag, encrypted] = String(value).split(".");
  if (version !== "v1" || !iv || !tag || !encrypted)
    throw failure(
      "APPLE_TOKEN_UNAVAILABLE",
      "Please sign in with Apple again before deleting your account.",
      409
    );
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
async function createClientSecret() {
  if (process.env.APPLE_CLIENT_SECRET) return process.env.APPLE_CLIENT_SECRET;
  if (
    !process.env.APPLE_TEAM_ID ||
    !process.env.APPLE_KEY_ID ||
    !process.env.APPLE_PRIVATE_KEY
  )
    throw failure(
      "APPLE_REVOCATION_SETUP_REQUIRED",
      "Apple account deletion needs server configuration. Please contact support@humaeli.com."
    );
  const key = await importPKCS8(
    process.env.APPLE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    "ES256"
  );
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: process.env.APPLE_KEY_ID })
    .setIssuer(process.env.APPLE_TEAM_ID)
    .setSubject(clientId())
    .setAudience("https://appleid.apple.com")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}
async function applePost(path, values) {
  const secret = await createClientSecret();
  let response;
  try {
    response = await fetch(`https://appleid.apple.com/auth/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId(),
        client_secret: secret,
        ...values,
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw failure(
      "APPLE_UNAVAILABLE",
      "Unable to contact Apple. Please retry."
    );
  }
  if (!response.ok)
    throw failure(
      "APPLE_TOKEN_REQUEST_FAILED",
      "Apple could not confirm this request. Please sign in with Apple again and retry."
    );
  return path === "token" ? response.json() : null;
}
export async function exchangeAppleCode(code, expectedSubject, verifyIdentity) {
  encryptionKey();
  const tokens = await applePost("token", {
    code,
    grant_type: "authorization_code",
  });
  if (!tokens.refresh_token || !tokens.id_token)
    throw failure(
      "APPLE_TOKEN_REQUEST_FAILED",
      "Apple did not return the required account tokens."
    );
  const identity = await verifyIdentity(tokens.id_token);
  if (String(identity.sub) !== String(expectedSubject))
    throw failure(
      "APPLE_ID_MISMATCH",
      "The Apple authorization does not match this account.",
      401
    );
  return encryptAppleToken(tokens.refresh_token);
}
export async function revokeAppleAuthorization(user) {
  if (!user.appleId) return;
  if (!appleTokenStorageConfigured())
    throw failure(
      "APPLE_REVOCATION_SETUP_REQUIRED",
      "Apple account deletion needs server configuration. Please contact support@humaeli.com."
    );
  if (!user.appleTokenCiphertext)
    throw failure(
      "APPLE_REAUTH_REQUIRED",
      "Please sign in with Apple again before deleting your account.",
      409
    );
  const token = decryptAppleToken(user.appleTokenCiphertext);
  await applePost("revoke", { token, token_type_hint: "refresh_token" });
}
