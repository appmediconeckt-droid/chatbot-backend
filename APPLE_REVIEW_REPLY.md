# Draft reply — complete evidence and live verification before sending

The fixes described below are implemented in source and tested locally. The new backend endpoints and policy are not deployed yet. Replace every bracketed field with verified details and remove this preparation note only after production/device tests and authentic evidence are complete.

Dear Apple App Review Team,

Thank you for your feedback regarding Humaeli.

Regarding Guidelines 5.1.1(i) and 5.1.2(i), we have implemented explicit AI privacy and data-sharing consent. Our AI provider is OpenAI. The disclosure identifies the message and conversation context, relevant profile and wellness/safety context, and optional audio/photo/avatar processing used by our existing AI features. It explains the processing purpose, retention, deletion requests and how to decline or withdraw consent.

The consent checkbox is initially unchecked. Agree & Continue is disabled until the user selects it. Acceptance must be successfully saved for the authenticated account and current disclosure version before AI processing proceeds. The backend checks consent both at protected route entry and before each OpenAI network transmission. Missing, revoked or outdated consent blocks processing. Initial welcome messages are local and do not trigger OpenAI requests.

Users can decline and continue using unrelated features. They can withdraw consent under Privacy → AI Privacy & Data Sharing → Withdraw AI Consent. Withdrawal disables future AI processing and ends registered active AI calls when confirmed. We explain that withdrawal does not automatically erase previously processed information and provide separate history/account deletion controls and a privacy contact.

Updated Privacy Policy: [INSERT VERIFIED PUBLIC HTTPS POLICY URL AFTER DEPLOYMENT AND DEVICE CHECK].
Updated build: [VERSION / BUILD NUMBER TESTED AND UPLOADED].
Production verification date and devices: [ACTUAL RESULTS].

To review the feature:

1. Choose User and sign in with the User account supplied in App Review Information.
2. On the dashboard, select the center AI Assistant button in the bottom navigation.
3. Review AI Assistant Privacy & Data Sharing. Test Not Now, or select the unchecked consent checkbox and Agree & Continue.
4. After consent saves successfully, send a wellness message. Optional voice controls remain in the AI chat interface.
5. Open the existing Privacy page and select AI Privacy & Data Sharing to review status, the policy or withdraw consent.
6. For consultant features, choose Consultant, sign in using the separate consultant credentials, and open the existing messages/appointments tabs. The floating AI Assistant launcher provides AI access for that role.

Regarding Guideline 2.3, our feature provides conversational AI wellness support, with contextual onboarding and language/voice controls. [CONFIRM THE EXACT METADATA CHANGES AND REMOVE ANY UNSUPPORTED CLAIM OF A SEPARATE STRUCTURED GUIDED-CONVERSATION WORKFLOW.] We have provided the navigation above to make the existing functionality discoverable.

Regarding Guideline 2.1(a), the designated accounts are:

- User email: appstore.user@humaeli.com; password: [ENTER TESTED PASSWORD IN APP REVIEW INFORMATION].
- Consultant email: appstore.counsellor@humaeli.com; password: [ENTER TESTED PASSWORD IN APP REVIEW INFORMATION].
- OTP method/code and review availability window: [ACTUAL DEPLOYED AND TESTED METHOD; DO NOT USE THE OLD SOURCE DEFAULT].
- API verification on 20 October 2026: both accounts returned HTTP 200 for login, authenticated identity, chat list, appointment list and test-session logout, with the correct respective roles. [ADD RELEASE-BUILD IPHONE/IPAD CHECK RESULTS AFTER DEPLOYMENT].

Both designated accounts have active completed profiles and sample records. We verified production API login and role-specific access as described above. Normal sign-in did not require OTP during this test; no active-session conflict was overridden. The conflict/OTP path and revised release build still require the checks indicated above.

Regarding Guideline 4.1(b), Humaeli / Humaeli Mental Wellness is [DESCRIBE THE VERIFIED RELATIONSHIP TO MINDCRAWLLER GLOBAL PRIVATE LIMITED AND THE EXACT APPLE DEVELOPER SELLER]. Please see the attached [SIGNED AUTHORIZATION DOCUMENT TITLE/DATE], [AUTHENTIC COMPANY/DOMAIN EVIDENCE], and [TRADEMARK OR LICENSE EVIDENCE ONLY IF APPLICABLE]. These documents establish [SPECIFIC RIGHTS AND AUTHORIZATION ACTUALLY SUPPORTED BY THE ATTACHMENTS].

We do not rely on code or a name change as proof of brand ownership. The attached evidence has been reviewed and signed by [AUTHORIZED REPRESENTATIVE — COMPLETE ONLY AFTER SIGNING].

Thank you for reviewing the updated submission.

Kind regards,
[AUTHORIZED NAME AND TITLE]
[EXACT VERIFIED LEGAL ENTITY]
support@humaeli.com
