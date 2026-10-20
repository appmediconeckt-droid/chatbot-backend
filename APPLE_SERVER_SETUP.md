# Sign in with Apple account deletion setup

The backend now exchanges the native authorization code for an Apple refresh token, verifies that the returned identity belongs to the same Apple subject, stores the refresh token using AES-256-GCM, and revokes Apple authorization before deleting local account data. The existing iOS Apple button already sends `authorizationCode`.

Configure these **server-only** Railway variables for `com.mindcrawller.humaeli`:

| Variable | Value |
| --- | --- |
| `APPLE_CLIENT_ID` | Native bundle ID, unless the Apple flow intentionally uses a different registered client |
| `APPLE_TEAM_ID` | Apple Developer team ID |
| `APPLE_KEY_ID` | Sign in with Apple key ID |
| `APPLE_PRIVATE_KEY` | Corresponding PKCS#8 `.p8` private key; literal `\n` separators are supported |
| `APPLE_TOKEN_ENCRYPTION_KEY` | Stable random 32-byte key represented by 64 hexadecimal characters |

An existing valid `APPLE_CLIENT_SECRET` can replace the Team ID/Key ID/private-key signing inputs, but it expires and must be renewed. Never put these values in the mobile bundle, source control, or review notes. Preserve the encryption key while stored Apple tokens depend on it.

No production credential was created, rotated, or configured by this audit. Remote configuration has not been inspected. Existing Apple users without a stored revocation token must sign in with Apple again after setup; their next successful code exchange saves the encrypted token. An Apple-linked deletion that cannot revoke authorization leaves local account data in place and returns a retryable error instead of claiming complete deletion. Local email/password accounts do not require this Apple setup.

Before release, verify real Apple sign-in, private-relay email behavior, repeat sign-in, account deletion and subsequent re-registration with a disposable account. Mocked tests cover encryption, subject matching, revocation, token redaction and preserving local data on failure; they do not prove the production Apple configuration.

References: [Apple token validation](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens), [Apple token revocation](https://developer.apple.com/documentation/signinwithapplerestapi/revoke-tokens), [Apple account deletion guidance](https://developer.apple.com/support/offering-account-deletion-in-your-app/).
