# App Review email login

The fixed login code `123456` applies to exactly:

- demo.user1@humaeli.com — User
- appstore.user@humaeli.com — User
- demo.counsellor1@humaeli.com — Consultant (`counsellor`)
- appstore.counsellor@humaeli.com — Consultant (`counsellor`)

Both requesting and verifying review email login require that account's valid password. The code never authorizes a password reset, SMS verification, registration or a different account. Normal accounts retain delivered random OTPs. Use the matching updated frontend; older review clients that omit passwords receive 401.

## Deployment

Deploy the application normally with its existing MongoDB, ACCESS_SECRET and REFRESH_SECRET. No new production secret, manual data migration or password reset is required. The four demo accounts must already exist and be active with the correct roles/passwords. Legacy DemoOtpConfig expiry and environment review allowlists do not control fixed-code login.

Login challenges and abuse counters use MongoDB, including atomic single-use consumption and a five-attempt budget. In-flight login OTPs from an old deployment require a new request after rollout. All running replicas must use the same revision, database and signing secrets. The deployment health endpoint reports its git revision.

## Non-destructive live smoke test

Run `scripts/check-review-screen-live.js` with DEMO_ACCOUNT_PASSWORD supplied securely in the environment and REVIEW_TEST_BASE_URL set explicitly to the production HTTPS URL or localhost:5005. It refuses other hosts, skips accounts with a pre-existing session, and logs out only sessions it created. It checks the four accounts, resend, wrong/missing password, wrong OTP, concurrent consumption, refresh, replay and rejection of the published code for password reset. It prints status codes only; never put the password in source or logs.

The credentials validator `scripts/configure-demo-accounts.js` is read-only. The old fixed OTP configuration rows are not used or modified.

## Reviewer instructions for the matching frontend

Choose User or Consultant and sign in with the supplied reviewer email/password. A fresh password login may open directly. If another-device verification is shown, request the email login code and enter 123456. Use the supplied password again after logout or session expiry. The updated Forgot Password screens redirect these four accounts into password-validated review email login; they do not change the shared review passwords.

OTP/API verification does not establish TestFlight UI behavior, full synthetic-data isolation, or overall App Store readiness. Verify those separately in the submitted build and intended review environment.
