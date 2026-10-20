# App Store Connect privacy checklist

Prepared from source audit on 20 October 2026. These are review inputs, not a completed or published App Store Connect questionnaire. Verify the release SDK settings and operational provider contracts before publishing.

| Apple data category | Source evidence / proposed treatment |
| --- | --- |
| Contact information | Account name, email, phone and optional address; linked to account; app functionality. |
| Health | Optional medical profile, wellness messages, prescriptions and consultation content; linked to account; app functionality. No HealthKit integration identified. |
| Sensitive information | User messages/profile can contain sensitive health, safety or sexual-health information; assess the actual content and release use against Apple’s category definition. Do not claim this data can never be collected. |
| User content: messages | AI and consultant messages/attachments; linked to account; app functionality. Include OpenAI processing and its retention. |
| Photos or videos | Profile/selfie/avatar uploads, consultation attachments and video-call functionality. Stored photos are linked; assess actual retention of call media separately. |
| Audio data | Voice messages and AI voice audio/transcripts; assess off-device retention, including OpenAI abuse monitoring. Do not assume all calls are recorded. |
| Other user content / customer support | Uploaded documents, consultant qualifications/certificates and submitted support information. |
| User ID | MongoDB account IDs, anonymous handles and authentication/session identifiers; linked; functionality/security. “Anonymous” presentation does not make stored data unlinked. |
| Device identifiers | Firebase/APNs notification tokens and device platform; linked when registered. Assess SDK-defined identifiers. No IDFA access identified. |
| Precise / coarse location | Optional GPS coordinates, address, city and location history in location service; linked; functionality/security. Do not report only coarse location when precise coordinates persist. |
| Purchase history / other financial information | Wallet/payment/appointment transactions, consultant earnings and payout data; linked; functionality. |
| Payment information | Consultant bank/UPI payout fields exist. Audit Razorpay payment UI separately; do not mark card numbers as collected by Humaeli solely because Razorpay processes payments. |
| Diagnostics / product interaction | Server/session activity exists. Review Firebase, Stream, hosting logs and release SDK settings to determine diagnostics/product-interaction collection. No Firebase Analytics/Crashlytics package was identified in package.json; Firebase Messaging alone is not proof of analytics. |
| Tracking | No advertising SDK or cross-app ad tracking identified. Confirm release SDK settings and partner use before answering “No”. No ATT prompt was added. |
| Contacts, fitness, browsing history, advertising data | No corresponding collection integration identified; do not automatically select these. |

Providers: OpenAI (AI text, speech, Realtime and avatars), MongoDB (database), Railway (API hosting), Cloudinary (uploads), Stream (calling), Firebase/APNs (push), Google/Apple (optional sign-in and device speech recognition), Razorpay (payments), configured SMTP/Brevo/Resend/Twilio delivery, Azure/Google/MyMemory translation fallbacks. Confirm which delivery/translation configurations are active and obtain their actual retention and protection arrangements. Do not invent DPAs, hosting regions or deletion guarantees.

## App Store Connect steps

1. Sign in with a role permitted to edit privacy information. Open My Apps → Humaeli → App Privacy.
2. Edit Privacy Policy URL. After backend deployment, verify unauthenticated HTTPS GET of `https://chatbot-backend-production-82fb.up.railway.app/privacy` returns the updated policy on iPhone and iPad. It currently returns 404 on the deployed server; do not enter it as a working published URL yet. A company-domain alias can be used only after it actually exists and is verified.
3. Select Edit / Get Started for Data Types. For each applicable category above, answer collection, purposes, whether linked to the user, and tracking based on the final release and provider practices.
4. Review the summary, save, and publish the privacy answers. Include partner practices, not just data stored directly by Humaeli.
5. In the new app version, update App Review Information with both role credentials, the actual tested OTP method, navigation and any special instructions. Upload signed authorization evidence in the review correspondence.
6. Remove unsupported “guided AI conversations” claims or explain the actual conversational AI onboarding. No separate structured guided-session feature was found. Check screenshots and all localizations manually; App Store Connect assets are not in these repositories.
7. Upload/select the newly signed iOS build, review export compliance and release settings, then submit after the verification gates in APPLE_REVIEW_FIX_REPORT.md are complete.

Sources: [Apple App Privacy details](https://developer.apple.com/app-store/app-privacy-details/), [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/#privacy), [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data), [OpenAI Realtime call hangup](https://developers.openai.com/api/reference/resources/realtime/subresources/calls/methods/hangup).
