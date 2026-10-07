# 8B.8.4 — Trusted Intake & Email Delivery

## Result

Feedback submission now uses an authenticated Firebase callable. The server
validates an exact request schema, resolves the signed-in account through Admin
Auth, verifies every claimed Storage object and its metadata, applies per-user
rate limits, and creates an immutable canonical Firestore record. Reusing a
feedback ID with the same payload is idempotent; reusing it with a different
payload is rejected.

The callable does not send email. A Firestore create trigger claims a dedicated
email-delivery record transactionally and sends a plain-text message through a
provider-neutral adapter. The current adapter uses Resend. Its stable provider
idempotency key is `<feedbackId>:email:v1`. Delivery is capped at five attempts,
with nominal retry delays of 1, 5, 30, and 120 minutes. A provider that honors
the idempotency key prevents duplicate sends if the provider succeeds but the
following Firestore acknowledgement fails; that provider guarantee is the
remaining external at-least-once boundary.

Attachment links are generated server-side with a seven-day expiry. Signed URLs
are used only to compose the outbound message and are never stored or logged.
Reply-To and account contact details are included only when the user explicitly
allows contact.

## Production configuration

Before deployment, configure:

- `FEEDBACK_RECIPIENT_EMAIL=reviewa782@gmail.com`
- `FEEDBACK_EMAIL_SENDER` as a bare, provider-verified sender address
- `FEEDBACK_EMAIL_PROVIDER_API_KEY` in Firebase Secret Manager

The sender and recipient are trusted server parameters. The provider credential
is a secret and is never present in the app bundle or callable response.

Deploy the Functions exports `submitFeedback` and
`processFeedbackEmailDelivery` only after reviewing the environment parameters.
Deploy the updated Firestore and Storage rules separately through the normal
release process. No deployment, production submission, or production email was
performed during this phase.

## Data and security notes

Canonical submissions live under `feedbackSubmissions/{feedbackId}`. Delivery
state lives under its server-only `deliveries/email` document. Rate counters
live under server-only `feedbackRateLimits` documents. Client Firestore access
to all three areas is denied. Storage objects remain owner-create/delete only,
cannot be updated in place, and are accepted by intake only when path, type,
size, dimensions, duration, owner, feedback ID, attachment ID, and upload time
match the submitted claim.

The client receives only `feedbackId`, `accepted`, and `alreadyExisted`, or a
normalized safe error. A successful UI acknowledgement means the canonical
record was securely accepted; it does not claim that email delivery completed.
