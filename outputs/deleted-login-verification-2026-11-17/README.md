# Deleted User login and re-registration verification

Account examined: pateladarsh07261@gmail.com. Database checked on 17 November 2026 at 11:00:41 IST (05:30:41 UTC).

## Conclusion

The reported login rejection is expected: this is a deletion-pending, inactive account. It is not a completed deletion. The live job still records the earlier 90-day operational policy, whereas the current working tree implements the owner's subsequent immediate-deletion instruction. The live record has not been processed under that new policy. No deployment was performed in this investigation; a job document alone does not identify the exact running server commit.

Several genuine authentication bugs were separately confirmed and fixed locally: account-state disclosures in password/OTP failures, Google identity/profile writes before checking deletion status, and a missing explicit Google login-versus-signup request intent. A password attempt on a passwordless Google account could also reach bcrypt with an undefined hash and return a server error; it now receives the same generic credential denial.

## Exact live MongoDB findings

- Account ID / deletion request ID: `6afbdff2d57ef7ecb15b0be3`.
- Account role `user`; `authProvider=local`; password configured; Google identity is not linked. A Gmail email address does not itself mean Google Sign-In was the registration method.
- Account `isActive=false`. User created 17 November 2026 at 10:32:42.652 IST.
- Deletion request recorded 17 November 2026 at 10:36:39.015 IST.
- Access revoked 17 November 2026 at 10:36:41.495 IST.
- Job `status=waiting_retention`; blocker `RETENTION_PERIOD_ACTIVE`.
- Recorded policy `owner-90-days-2026-11-14`.
- `retentionUntil` and `nextAttemptAt`: 15 February 2027 at 10:36:39.015 IST. This is a scheduled retention boundary, not a completion guarantee.
- No `localCleanupVerifiedAt`, `completedAt` or completion notification receipt is present.
- Retained local records: 1 user, 3 sessions, 1 chat, 2 sent messages. All 3 sessions are inactive; active-session count is 0.
- Related refresh-token, login-challenge, appointment, private-asset, prescription, call, transaction and counselor-earning counts are 0 for the matched account ID.
- Apple authorization is not applicable. AI consent is revoked. Legal holds are unreviewed; backups and Stream cleanup are unverified; Cloudinary/retained-record tracking remains blocked-policy. There is no evidence here of a completed provider/backup cleanup or an active legal hold determination.

See `mongo-read-only.json` for the projected database results. The inspection used the MongoDB driver directly, never imported application models, workers or migrations, and issued only `find` and `aggregate` commands. No passwords/hashes, tokens, message bodies or clinical contents were fetched. No production POST/login/registration test was performed because those paths can create sessions, challenges or other records.

## Authentication and fresh registration

Before this fix, password login distinguished missing accounts, wrong passwords, deactivated accounts and even role mismatches before proving the password. The User React Native screen already masked HTTP 401 errors, but that did not fix the raw API contract.

Now password failures for missing, inactive, deletion-pending and wrong-password accounts share HTTP 401, `AUTHENTICATION_FAILED` and `Unable to sign in with these credentials.` Missing/passwordless accounts perform dummy bcrypt work. Role guidance is returned only after a correct password for an active account. This does not claim formally constant-time network responses.

Google authentication still verifies the Google ID token and verified email before account lookup. Deletion checks now precede identity linking, email/photo synchronization or user saves. A durable deletion job blocks login even if a crash left `isActive=true`. Google login mode cannot create an absent account, even if signup fields were accidentally supplied. The actual React Native button sends explicit login/signup intent and does not save a session or invoke success on a denial.

The current live retained account still occupies its unique email. Email registration therefore conflicts; Google signup must also deny the existing pending account. That is expected and does not reactivate it. This production outcome is established from the read-only record and the controller paths, not by sending a production registration request.

After verified live-data erasure under the current immediate-deletion implementation, explicit fresh email or Google registration is permitted. It requires current age/Terms evidence plus email ownership proof (email verification token or verified Google identity), creates a new account ID and acceptance record, and restores no old chats or sessions. It does not modify or reactivate the old account. The former deletion job is keyed by the old ID; a persistence test verifies that finishing its provider/backup receipts does not erase the freshly registered account. Registration while the old account is retained remains blocked. No permanent email-ban policy was introduced.

## Files changed in this investigation

Backend:
- `src/controllers/authController.js`: generic credential failures, credential-protected role hints, passwordless safety, Google deletion guards before mutation, explicit login intent, and less revealing duplicate-email OTP registration response.
- `scripts/audit/inspect-deleted-account.mjs`: reusable read-only, stdin-selected account inspection without app startup side effects.
- `test/deletedLoginLifecycle.test.js`: 14 MongoDB scenarios covering active/missing/inactive/deleted/pending states, Google intent and immutability, fresh registration, old-job isolation, revoked refresh/OTP paths and cleanup receipts.
- `test/registrationLifecycle.test.js`: update stale 90-day assertions to the previously approved immediate live-data erasure policy; completion checks still require external verification.
- `scripts/audit/run-persistence-tests.mjs`: allow the new disposable persistence suite.
- `scripts/audit/run-isolated-tests.mjs`: exclude that DB-dependent suite from the stub-only runner.

MyApp:
- `src/screens/GoogleAuthButton.jsx`: send explicit login/signup request mode after registration fields so stale registration data cannot overwrite it.
- `src/__tests__/googleDeletedLogin.test.tsx`: exercise the real Google button for denied login/signup, explicit mode and absent session persistence.
- `src/__tests__/authWithoutLocation.test.tsx`: exercise actual User/Consultant screens on iOS/Android and verify denied login never stores credentials or navigates to a dashboard.

Existing changes from the preceding immediate-deletion task and unrelated user edits were preserved; they are not newly attributed to this investigation.

## Tests

All tests below passed, using disposable databases and mocked provider verification/delivery. Production data and job statuses were not changed.

| Check | Passed |
| --- | ---: |
| Deleted login / fresh registration persistence | 14 |
| Enrollment / deletion lifecycle persistence | 22 |
| Existing Google identity / chat flow regression | 7 |
| Existing login OTP persistence regression | 12 |
| Security / session / deletion persistence regression | 26 |
| Isolated backend unit regressions | 277 |
| React Native login, Google, registration and deletion panels | 63 |
| Total | 421 |

Commands:

```text
node scripts/audit/run-persistence-tests.mjs deletedLoginLifecycle registrationLifecycle
node scripts/audit/run-persistence-tests.mjs googleAuthChatFlow loginChallengeIntegration securityPersistence
node scripts/audit/run-isolated-tests.mjs
npm test -- --runInBand src/__tests__/googleDeletedLogin.test.tsx src/__tests__/authWithoutLocation.test.tsx src/__tests__/registrationTerms.test.tsx src/__tests__/accountDeletionPanels.test.tsx src/__tests__/accountDeletionOutcome.test.ts
```

Whitespace checks passed. No signed iOS build, app release, backend deployment, production registration attempt, account reactivation, record purge or manual deletion-status edit was performed.
