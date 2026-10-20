# Humaeli Apple Review Fix Report

Audit and implementation date: 20 October 2026. Scope: existing React Native frontend at `Humaeli-IOS/MyApp` and Node/Express backend at `chatbot-backend`. Existing user edits were preserved. No app redesign or replacement backend was introduced.

**Status:** source fixes implemented; consent database indexes applied; deployment, release-build/device UI verification and authentic brand evidence remain release gates. The existing production API still returns 404 for the new consent and privacy routes. Do not submit the Apple reply as a completed-production claim yet.

## A–B. Guidelines 5.1.1(i) and 5.1.2(i)

Root causes found:

- AI text and speech routes used optional authentication. Realtime session creation also allowed guests. Photo-avatar processing required a different, weaker authentication path and lacked AI sharing consent.
- No versioned account-specific consent record, disclosure UI or revocation API existed.
- Client launch/init paths could request AI greetings automatically.
- OpenAI was used for more than text: speech synthesis, live microphone audio/transcription and photo/avatar image editing. Voice prompts automatically included medical allergies, conditions and medication details.
- AI service configuration could route to Gemini/Groq and fall back to OpenAI; a legacy `/api/ai/message` path sent messages through translation and a private Python service with unverified downstream providers.
- Chat debugging logged message/history content, and provider error bodies could reach logs or clients.
- The source has **MongoDB/Mongoose, not MySQL**. User and counselor accounts share the `User` collection and ObjectId namespace. There is no MySQL client/schema or Railway MySQL integration in these repositories. Creating a second SQL database would disconnect consent from the real authentication system.

Implemented:

- Account/provider unique consent state in `AIConsent`, default disabled, current version `openai-ai-v1`, server timestamps, revocation time and the last 100 content-free consent events.
- Authenticated GET/POST/DELETE `/api/ai/consent`. Identity comes exclusively from the existing JWT plus active-session middleware. POST requires literal `accepted:true` and the active server version. Responses are not cached.
- Missing/stale/revoked consent returns 403 `AI_CONSENT_REQUIRED`; absent/invalid authentication returns 401. Database failures fail closed.
- Guards at both route entry and every actual OpenAI network transmission. The SDK transport uses authenticated AsyncLocalStorage context and re-reads consent from the database. Unscoped background/provider calls fail closed.
- A per-account MongoDB lease serializes transmissions and consent mutations across backend processes. Revocation records disabled state before ending registered Realtime calls, then confirms success. Failed remote termination returns a retryable failure and does not re-enable consent. Waiting work rechecks state before sending. Already-transmitted content cannot be recalled.
- Realtime call IDs are registered server-side; hangup uses OpenAI’s call endpoint. At most five call IDs are kept, stopping earlier sessions before creating more. SDK timeouts are 60 seconds, no automatic SDK retry; provider operations are limited to 30/minute/account. Lock waiting is bounded. Termination and lease behavior still need a live provider/device test.
- The backend AI implementation now uses only the disclosed OpenAI provider. The legacy `/api/ai/message` alias uses the same existing chat handler. No message is sent to an unverified Python AI service or undisclosed Gemini/Groq fallback by these routes.
- Text context limited to 20 prior messages; supported chat completions use `store:false`. Automatic medical-record fields removed from voice context; account age/gender/city and situation/safety context remain disclosed.
- No OpenAI API key found in React Native source; server keys remain environment configured. Provider errors are sanitized, including SDK-wrapped consent errors. Plaintext AI-message/history debug logs removed.
- Responsive, accessible consent modal: initially unchecked checkbox, disabled Agree button, backend-save confirmation, Not Now, policy link, scrollable content. Chat entry, sends, retries, dictation, realtime calls and AI photo requests check consent. Declines preserve drafts; provider rejections restore the draft. Initial greetings are local only.
- Consent is never authorized by AsyncStorage. Every operation reads backend state; account identity is checked while async work runs. Logout/new login cancels a pending consent dialog. No account’s consent is reused for another.
- Privacy → AI Privacy & Data Sharing shows provider/status, refresh, policy, confirmed withdrawal and a separate deletion-request link. Account cleanup revokes/terminates AI before deleting consent records.

## Migration and APIs

`chatbot-backend/scripts/migrate-ai-consent.js`, command `npm run migrate:ai-consent`, is an idempotent Mongoose index migration. **Successfully executed against the configured existing database.** It created the account/provider unique index; no accounts were opted in and no existing account records were overwritten. No SQL migration was created because the actual app does not use MySQL.

| Route | Result |
| --- | --- |
| GET/POST/DELETE `/api/ai/consent` | Existing JWT/session required; read/accept/revoke current consent. |
| POST `/api/ai-chat/send-message` | Existing AI controller, authentication and consent required. |
| POST/GET `/api/ai-chat/tts` | Speech generation guarded, safe errors. |
| POST `/api/ai/realtime/session` | Auth/consent before session creation; persistent call registration for withdrawal. Duplicate router logic consolidated. |
| POST `/api/ai/message` | Protected compatibility alias to existing OpenAI chat controller; no separate undisclosed AI service. |
| POST `/api/avatar/analyze-and-generate`, `/api/avatar/customize` | Existing JWT/session plus consent, guarded vision/image calls. |
| POST `/api/ai-chat/start-session` | Authenticated local session ID; no provider call. Added because clients already expected it. |
| GET `/api/ai-chat/history/:userId` | Authenticated compatibility route; ID must match caller. Own history does not transmit data to OpenAI. |
| DELETE `/api/ai-chat/my-history`, `/message/:chatId` | Existing authenticated deletion; no AI consent required to delete. |
| GET `/privacy` | Public responsive policy, no login. Implemented locally; not deployed yet. |

No separate OpenAI embeddings, stored conversations, document processing, background jobs or OpenAI WebSocket integration was found. Realtime uses WebRTC: backend establishes the session, then audio travels directly between device and OpenAI. Ordinary calls continue to use the existing Stream integration. Device dictation uses native speech recognition. Existing language selection remains.

## C. Guideline 4.1(b): authentic evidence required

The source displays Humaeli; iOS display name is Humaeli and the configured bundle is `com.mindcrawller.humaeli`. The AI header and current Realtime instructions were made consistent with Humaeli. The supplied operator name is MindCrawller Global Private Limited. Source code and a reachable website **do not prove brand/domain/trademark ownership or the seller relationship**.

Use `HUMAELI_BRAND_AUTHORIZATION_TEMPLATE.md`. An authorized representative must establish the exact rights-holder/seller relationship, sign the letter, and attach authentic company/domain/trademark-or-license evidence as applicable. Team ID in the current project is `32DZFM8MZP`; verify against the intended Apple Developer membership. Do not fabricate a trademark certificate or use the unsigned template as evidence.

Metadata audit limits: App Store descriptions, screenshots/localizations, seller name, copyright and the website’s legal ownership records were not available as authenticated editable assets. Check them manually for Humaeli/MindCrawller consistency. Historical `com.arun.myapp` URL-scheme metadata was not changed because sign-in/deep-link compatibility needs verification. Backend email configuration still contains legacy sender/domain defaults; verify the actual authenticated sender independently. No third-party brand should be represented as owned without evidence.

## D. Guideline 2.3: feature accuracy

The existing feature is conversational wellness AI with onboarding prompts, language selection, safety/context handling, optional quick replies and voice controls. No separate structured “guided AI conversations” course/workflow was found. Use accurate wording such as “AI-powered wellness conversations”; remove unsupported structured guided-session claims from App Store descriptions and screenshots unless a human verifies an existing flow that supports them.

Reviewer navigation (source verified; still requires device confirmation): choose User role → sign in → dashboard → center bottom AI Assistant button → AI Assistant Privacy & Data Sharing → checkbox → Agree & Continue → type a message. Consultant access uses the floating AI Assistant launcher after consultant sign-in. Use the chat header voice-call control for live AI audio; the microphone dictation control is a separate feature. Chats/messages and appointments remain in their existing tabs.

## E. Guideline 2.1(a): reviewer access

Read-only checks against the configured database confirmed:

| Designated account | Role / status | Sample records |
| --- | --- | --- |
| `appstore.user@humaeli.com` | `user`, active, completed profile, verified email | 1 AI-chat record, 4 consultant chats, 4 appointments. |
| `appstore.counsellor@humaeli.com` | `counsellor`, active, completed profile, verified email | 0 AI-chat records, 3 consultant chats, 1 appointment. |

Counts prove that records exist, not that every screen, call, payment or appointment transition succeeds. Their content was not copied into documentation. No sample profile/chat/appointment content was changed or reseeded. Authorized API login tests created and then logged out only their own test sessions. Existing frontend demo display data contains synthetic IDs and must not be treated as evidence that real booking/payment operations work.

After explicit user approval, both designated accounts were successfully tested against the existing production API using the credential recorded in the original seed script. For **each role**, POST `/api/auth/login`, GET `/api/auth/me`, GET `/api/chat/chats`, GET `/api/appointments` and POST `/api/auth/logout` returned **HTTP 200**. Returned roles were `user` and `counsellor` respectively. No active-session conflict occurred, no session was overridden, and no password/token or private response content was printed. The normal tested login did not require OTP. The one-device conflict/OTP flow was not exercised. This is API verification of the current deployment, not a device test of the revised release build.

No new expiring review-OTP/password configuration was present in the local environment. Before submission, set a strong dedicated review password through the authorized account-management process and retest it; do not rely indefinitely on a credential that existed in repository history.

Removed the permanent source-code `123456` review OTP default. Review mode now requires all of: `APP_REVIEW_ENABLED=true`, explicit `APP_REVIEW_TEST_EMAILS`, deployment-secret `APP_REVIEW_OTP` (six digits), and a future `APP_REVIEW_EXPIRES_AT`. Disabled/expired/unlisted accounts use ordinary random OTP delivery. The dedicated configured review code does not depend on email delivery. Password and persisted issued-OTP verification remain in the existing login flow.

The seed script now requires a supplied strong password and uses insert-only updates; it does not reset existing users or wallet balances. Invented certification-document URLs were removed from future seed data. It was **not run**. Existing review accounts must be inspected for synthetic certification fields before exposing them as real professional evidence.

Before review, configure a sufficiently long review window if using review OTP, retest both accounts in the new release build after backend deployment, resolve one-device session conflicts, verify sample data and active consultant availability, and put the tested credentials and actual OTP instructions only into App Store Connect Review Information. Never paste deployment secrets into this report or the app bundle. Renew or disable review mode after review.

## F–G. Consent navigation and policy

User: dashboard center AI Assistant button. Consultant: floating AI Assistant button. Withdrawal: existing Privacy / Privacy Policy page → AI Privacy & Data Sharing → Withdraw AI Consent → confirm. User privacy page is reachable through the existing More/Privacy navigation; consultant privacy through Settings → Privacy Policy. Separate deletion-request link uses `support@humaeli.com`. Existing account deletion remains available in Account Settings.

Policy source: `chatbot-backend/src/privacy/policy.md`; public HTML: `src/privacy/policy.html`; served at `/privacy`. The in-app existing policy sections were retained and augmented with AI disclosure/settings.

Intended API-host policy URL: `https://chatbot-backend-production-82fb.up.railway.app/privacy`. **Production GET currently returns 404 because these changes have not been deployed. This is not yet a verified published policy URL.** Deploy, test without login on iPhone/iPad, and then use the verified URL in App Store Connect. `https://humaeli.com` responds, but no existing policy route or website ownership was established by this audit. No company-domain policy URL was invented.

Policy additions cover account/contact/professional data; wellness/messages/media; consultation/prescription/appointment/payment records; device/push/location identifiers; processing purposes; OpenAI text/voice/image flows; other providers; consent and withdrawal; separate Humaeli/provider retention; chat/account deletion; actual security controls; operator/contact and effective date. Full exact policy text is in the Markdown file. Operator must approve legal entity wording, active SDK/provider list, contracts, retention schedule and backup/media cleanup practices before public deployment. No E2E encryption or zero-retention guarantee is made.

## H–I. AI data categories and actual retention

Text: current message, at most 20 previous messages, language, derived mood/safety context, anonymous handle, age, gender, city/location, surroundings/company and selected professional counselor directory data. Backend AI chat history stores user messages and AI responses; no automatic expiry exists. Fresh Chat, message deletion and account cleanup remove corresponding AI history from the primary database.

Voice: microphone audio and transcription at OpenAI; spoken response generation; disclosed profile/situation/safety and counselor-directory context in the initial session. No Humaeli-side persistent Realtime audio recording was identified. Native device dictation can use Apple/Google services. TTS sends the chosen text. Photos: selected selfie/avatar, appearance analysis when enabled and customization choices. Ordinary uploaded images/documents also use the existing upload/counselor workflows and are disclosed separately.

OpenAI chat uses `store:false` where supported; no intentional stored conversation/file-library creation was found. OpenAI API training is off by default unless the customer opts in. Provider abuse-monitoring retention can be up to 30 days, with legal/safety exceptions and flagged-image handling. No account-level Zero Data Retention setting or opt-in/out configuration was verified. See the official sources linked in `APP_PRIVACY_DISCLOSURE_CHECKLIST.md`.

Consent audit events are bounded to 100 and contain no content or access/API keys; they and active-call identifiers are removed with account cleanup. Financial history is preserved by existing cleanup. Profile/certification Cloudinary deletion is attempted; attachment/backups/provider retention and actual deletion SLAs require operator verification. Withdrawal blocks future work and ends registered calls when confirmed; it does not delete already processed provider content.

## Permissions audit

- Removed unused Always Location purpose text; actual location is foreground/optional. LocationGate waits for Allow location rather than prompting automatically at login. Purpose text describes sign-in location, profile city and account protection.
- Microphone purpose now explicitly includes AI voice conversations alongside voice messages/calls/video calls. Camera/photo-library/speech-recognition/Face ID descriptions retained because matching features exist.
- Plain-text AI chat does not request camera/microphone access. Dictation and Realtime require AI consent first, then microphone/speech permission at use time.
- Notifications moved away from unconditional app startup; request after authenticated dashboard navigation. Token synchronization only checks existing permission and does not prompt on its own. Removed plaintext FCM-token logging.
- No ATT permission added; no source evidence of advertising tracking. Confirm final SDK practices before answering App Privacy.

## J. Verification and remaining issues

- Frontend Jest: **182 tests passed in 20 suites**, including eight consent UI/account/logout tests.
- New backend consent tests: **24 passed**, including every live AI route denied without consent with zero provider calls, strict acceptance/version checks, auth failures, user isolation, revocation, fail-closed DB outage, direct/unscoped SDK denial, transmission-time recheck, queued withdrawal race, SDK-wrapped consent errors, active call termination/retry, sanitized provider errors and unauthenticated policy delivery.
- Review OTP tests: **3 passed**. Combined consent/OTP run: **27 passed**.
- Broader selected backend run: **64 passed / 6 failed** in the final selected regression run. All six failures reproduced in a temporary pre-task-source copy preserving the pre-existing anonymous-user edit: one anonymous profile-photo expectation, four chat-expiry fixture/expectation failures, one OTP delivery expectation. These are not hidden as passing. Database-mutating Google-auth and billing integration suites were not run against production.
- TypeScript `tsc --noEmit`: passed. Focused lint: no errors, five existing/style warnings.
- Production iOS JavaScript bundle generation: passed. Unsigned Debug build for generic iOS Simulator: **BUILD SUCCEEDED**. This does not constitute a signed release archive, device UI validation, Android native build or App Store upload.
- Public policy is HTTP 200 in local route tests, and contains responsive viewport/contact/AI disclosure. Production `/privacy` and `/api/ai/consent` are 404 pending deployment.
- No real OpenAI content was sent during mocked security tests. Live OpenAI billing, quota, photo results, audio compatibility and remote Realtime termination must still be exercised after explicit demo-account consent.
- Physical/simulator iPhone and iPad interaction, Dynamic Type/VoiceOver, Android interaction, and complete booking/wallet/payment/call/notification regression checks remain manual. Do not claim all app features were manually tested.

## K. Build and resubmission requirements

1. Review changes alongside existing uncommitted work. Keep deployment secrets server-only.
2. Deploy the backend; migration is already applied to the configured database, but run `npm run migrate:ai-consent` for any different target environment before serving traffic. Deploy backend first; older clients will correctly receive consent-required errors.
3. Verify HTTPS consent/auth/policy routes on the release server. Confirm provider credentials/model access and contracts. Test revoke/hangup and a material consent-version change; terminate pre-existing sessions before switching disclosure versions.
4. Configure/test secure reviewer credentials and OTP window; confirm both roles and usable sample content on the live app. Do not rely on synthetic frontend IDs for real transactions.
5. Obtain signed authentic brand authorization and verify seller/domain/legal-entity consistency.
6. Complete App Store Connect privacy questionnaire and policy URL, correct unsupported metadata/screenshots, update Review Information and attach evidence. Details in `APP_PRIVACY_DISCLOSURE_CHECKLIST.md`.
7. **A new iOS build is required.** Current project build number is 15/version 1.0; increment to the next unused App Store build number. Create a signed Release archive for `com.mindcrawller.humaeli`, verify on iPhone/iPad, upload/select it, and submit the completed reply only after live checks.

## Files changed by this task

Frontend: `App.tsx`, `src/axiosInstance.js`, `src/utils/aiConsent.ts` (new), `src/utils/authSessionEvents.ts` (new), `src/utils/authSession.ts`, `src/components/common/AIPrivacyConsent.tsx` (new), `src/components/common/AIAssistantLauncher.tsx`, `src/components/common/SupportPrivacyPages.tsx`, `src/components/common/LocationGate.tsx`, `src/components/UserTab/Dashboard/UserDashboard.tsx`, `src/components/UserTab/Dashboard/AIRealtimeCallModal.tsx`, `src/services/notificationService.js`, `ios/MyApp/Info.plist`, `src/__tests__/aiConsent.test.tsx` (new), and these review documents.

Backend: `package.json`, `scripts/migrate-ai-consent.js` (new), `scripts/seed-play-review-accounts.js`, `src/models/AIConsent.js` (new), `src/services/aiConsent.js` (new), `src/routes/aiConsentRoutes.js` (new), `src/routes/privacyRoutes.js` (new), `src/privacy/policy.md` and `policy.html` (new), `src/app.js`, `src/routes/chatRoutes.js`, `src/routes/aiRoutes.js`, `src/routes/aiRealtimeRoute.js`, `src/routes/avatarRoutes.js`, `src/services/aiService.js`, `src/services/aiRealtimeContext.js`, `src/controllers/chatController.js`, `src/services/accountCleanupService.js`, `src/services/otpService.js`, `test/aiConsent.test.js` (new), `test/playReviewOtp.test.js`. Other modified files predated this task.

## Exact consent text in the app

Title: **AI Assistant Privacy & Data Sharing**

Humaeli uses OpenAI API to provide AI-powered conversations and wellness assistance. Before using the AI Assistant, please review how your information will be processed.

### Information Shared with OpenAI

Your AI messages, up to 20 prior conversation messages, language, mood and safety context, anonymous handle, age, gender, city/location, surroundings and company may be sent through Humaeli’s backend to OpenAI. Counselor directory details may be included to suggest support. Messages may contain personal or mental-wellness information you choose to share.

### Voice and photo features

AI voice calls send microphone audio directly to OpenAI after Humaeli creates the connection. OpenAI transcribes the audio and generates spoken replies. Voice sessions also include your account role and the profile and counselor context described above. Device speech recognition may process dictated text using Apple or Google services. AI photo avatars send your selected photo or avatar, appearance analysis (when enabled) and customization choices to OpenAI. Text selected for AI speech is sent to OpenAI.

### Third-Party Provider

Provider: OpenAI. Purpose: AI response generation and processing of the text, audio and images you submit for AI features.

### Data Privacy

Humaeli stores AI chat history in its backend database until you delete it; no automatic expiry is configured. Use AI Chat’s Fresh Chat control to clear saved AI history, or contact support@humaeli.com for deletion requests. Consent records contain timestamps and policy versions, not chat text. OpenAI API data is not used for training by default unless the API customer opts in. OpenAI may retain abuse-monitoring data for up to 30 days, with legal/safety exceptions and endpoint-specific handling. Uploaded images may be retained for safety review when flagged. This is not zero retention.

### Your choice

Declining does not prevent use of unrelated Humaeli features. Withdraw consent in Privacy → AI Privacy & Data Sharing to stop future AI processing and end active AI calls. Withdrawal does not automatically erase data already processed. Read the Privacy Policy for collection, sharing, retention and deletion details.

User Consent (unchecked):

> I understand that my AI chat messages and the other information described above will be shared with OpenAI for AI response generation, and I explicitly agree to this processing.

Buttons: **Agree & Continue** (disabled until checked); **Not Now**. Link: **View Privacy Policy**.

## Final verification notes

- Final frontend result: **182 tests passed / 20 suites**, TypeScript passed, focused ESLint passed with five warnings and no errors.
- Final selected backend regression result: **64 passed / 6 pre-existing failures**. Focused consent/review OTP result: **27 passed**.
- The development API tunnel change encountered during work is preserved only for `__DEV__`; release bundles use the stable production Railway API.
- Automatic approval review initially required explicit permission for historical seed-credential use on production. The user explicitly approved both designated-account checks. The subsequent authorized test completed successfully for both accounts: login, identity, chat access, appointment access and test-session logout all returned HTTP 200. Passwords and tokens were not printed.
