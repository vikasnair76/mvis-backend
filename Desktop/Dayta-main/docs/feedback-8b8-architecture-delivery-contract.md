# 8B.8.1 Feedback Architecture & Delivery Contract

## 1. Scope

This decision record defines Dayta's authenticated, private feedback intake and
trusted email-delivery contract. It is repository groundwork, not a live
submission feature.

## 2. Non-goals

This phase does not add Settings UI, pickers, uploads, a deployed callable or
trigger, provider integration, secrets, rule changes, support tooling, or
production mutation. It does not send email from the app.

## 3. Product flow

The client creates a stable ID, uploads approved attachments, then calls
`submitFeedback`. The callable validates identity, content, attachment objects,
and quota before transactionally creating an immutable canonical record. A
Firestore-created trigger later claims and delivers email through a provider
adapter.

Acceptance means durable canonical storage, not successful email delivery.

## 4. Settings entry concept

A later dedicated Feedback & Support route will own local draft state. Signing
out or changing accounts must clear that state. No UI was added in 8B.8.1.

## 5. Feedback types

Canonical values are `bug`, `feature_request`, `general`, and `support`.
Display and email labels are presentation helpers; unknown values are rejected.

## 6. Reply-email requirement

The initial value comes from nullable Firebase Auth `currentUser.email`. The
field remains editable, and the edited address is never silently replaced.

## 7. Contact-consent behavior

Consent is explicit. A valid Auth email defaults `allowContact` to true; no
valid Auth email defaults it to false. When `allowContact = true`, one valid
reply email is required. When `allowContact = false`, canonical `replyEmail` is
always null even if local form state retains typed text.

## 8. Account-email source

The callable loads the submitting Firebase Auth user through Admin Auth and
normalizes that record's email. A profile document or client request is not a
trusted source.

## 9. Edited reply-email behavior

The selected reply email may differ from the account snapshot. Server
validation preserves local-part casing, lowercases the domain, and stores the
bounded edited value only with consent.

## 10. Canonical schema

`feedbackSubmissions/{feedbackId}` stores ID, schema version, canonical type,
subject, message, trusted UID, consent, reply and account snapshots, verified
attachment metadata/count/bytes, bounded app metadata, status, and trusted
creation timestamps. Delivery-private state is modeled separately as
`feedbackSubmissions/{feedbackId}/deliveries/email`.

## 11. Schema version

Version starts at `1`. Mappers must reject unsupported future versions.
Missing version is invalid rather than implicitly version 1.

## 12. Client-writable fields

The canonical collection has no direct client writes. The callable request may
contain only feedback ID, type, subject, message, consent, reply email,
attachment claims, and low-risk app metadata.

## 13. Server-writable fields

The callable derives UID, account email, canonical counts, timestamps, version,
and initial `submitted` status. Delivery code alone owns claims, attempts,
states, normalized errors, sent/failed times, and provider message ID.

## 14. Submission status

Statuses are `submitted`, `email_processing`, `email_sent`, and `email_failed`.
Only trusted code transitions them. A finalized submission is immutable to
clients.

## 15. Attachment schema

Each attachment has a safe ID, image/video kind, deterministic private path,
allowed MIME, verified byte size, dimensions, optional duration, and upload
time. Filenames, public URLs, signed URLs, and Base64 data are excluded.

## 16. Storage path

The only accepted object path is:

`feedback/{uid}/{feedbackId}/{attachmentId}`

All three segments use a strict alphanumeric, underscore, and hyphen grammar.

## 17. Attachment limits

The first release allows four total, up to four images and one video. JPEG,
PNG, WebP, and MP4 are accepted. Images are at most 10 MiB; video is at most
50 MiB and 30 seconds; combined bytes are at most 50 MiB. These conservative
limits align with the existing proven media layer. GIF is intentionally
excluded from feedback.

## 18. Upload lifecycle

Uploads finish before finalization. The callable uses Admin Storage metadata,
not request claims, to verify existence, owner path, content type, byte size,
and custom metadata when introduced. Finalization failure leaves a cleanup
candidate, not a partial Firestore submission.

## 19. Draft identity

The client generates one cryptographically strong safe ID per draft and keeps
it across upload/finalization retries. Attachment IDs are stable and unique
within that draft.

## 20. Callable submission contract

`submitFeedback` requires Firebase Auth. It normalizes content, fetches trusted
identity, verifies Storage, applies quota, compares same-ID retries, and writes
once in a Firestore transaction. It returns only ID, `accepted: true`, and
`alreadyExisted`.

## 21. Trusted account-email lookup

Admin Auth lookup by authenticated UID replaces any client-derived notion of
account email. The account snapshot remains stored for abuse/audit correlation.
It is omitted from outbound mail when contact is disabled.

## 22. Rate-limit design

Server-only UID-scoped hour and day windows enforce five accepted submissions
per hour and twenty per day. A same-ID identical retry does not consume quota;
a different ID does. Delivery retries never affect intake quota. Window
timestamps come from the server and expired windows are logically ignored.
Clients cannot read, create, reset, or delete counters.

## 23. Canonical Firestore write

The callable transaction checks an existing ID before quota mutation. An
equivalent normalized request returns idempotent success; different content
with the same ID returns `submission_conflict`. Attachment order is normalized
by ID for equality because order is non-semantic.

## 24. Email trigger

`processFeedbackEmailDelivery` is a trusted Firestore-created trigger. The
architecture module is a contract only in this phase and is not exported from
`functions/src/index.ts`.

## 25. Recipient contract

The recipient comes only from trusted `FEEDBACK_RECIPIENT_EMAIL`
configuration. Its expected production value is `reviewa782@gmail.com`. The
request, document, and client cannot select or override it.

## 26. Sender contract

The sender comes from trusted `FEEDBACK_EMAIL_SENDER` configuration and must be
a provider-verified Dayta identity. A user's reply or account email is never
the From address.

## 27. Reply-To contract

With consent, the validated submitted reply email is the sole Reply-To. Without
consent there is no user Reply-To and neither reply nor account email appears
in the outbound body.

## 28. Email subject

The deterministic subject is
`[Dayta Feedback] [<type email label>] <normalized subject or "No subject">`,
then bounded by server code. User input cannot introduce line breaks or
headers.

## 29. Email body

The structured plain-text body labels type, subject, message, contact choice,
approved contact fields, bounded app context, and attachment links. User text
is treated as plain text. If HTML is later supplied, every user field must be
escaped; plain text remains authoritative.

## 30. Attachment-link strategy

Delivery generates read-only, short-lived Storage signed links only after
verifying every canonical attachment. Links are placed in that delivery
message and are never stored in Firestore or logged.

## 31. Signed-link expiration

Links expire after seven days. Expiration does not make Storage public.
Regeneration through support tooling is a future capability; the initial
fallback is a new submission or authorized operational procedure.

## 32. Idempotency

Submission identity is the feedback ID plus canonical normalized payload.
Delivery identity is `{feedbackId}:email:v1`. A transactional delivery document
claims the operation; sent is terminal. Providers should receive this stable
idempotency key where supported.

There is an unavoidable provider-success/database-write-failure ambiguity.
At-least-once delivery can duplicate when a provider lacks idempotency support;
it must never silently mark success before provider acceptance.

## 33. Retry strategy

Delivery is bounded to five attempts with nominal 1, 5, 30, and 120 minute
backoff. Retryable provider/network failures release or schedule the claim;
configuration, invalid submission, and other non-retryable errors stop.
Stale claims require a transactionally checked lease timeout.

## 34. Error normalization

Clients receive only stable calm codes such as invalid input, attachment
failure, rate limit, conflict, or temporary unavailability. Delivery persists
only normalized categories, never raw provider or Firebase errors.

## 35. Rules contract

The future rule is deny direct canonical create/update/delete, optionally allow
authenticated owners to get their record, and deny list/cross-user access.
Group roles, moderators, and app admins receive no implied access. Admin SDK
processing bypasses client rules. No Firestore rule changed in this phase.

## 36. Storage rules contract

Future rules allow an authenticated owner to create only at their exact UID
path with approved type/size and immutable ownership metadata. Reads are denied
to clients by default; overwrite is denied; an explicit owner cleanup delete
may be narrowly allowed before finalization. No Storage rule changed now.

## 37. Privacy contract

Feedback is private support data, not group content. It is never exposed in
feeds, history, notifications, public URLs, or cross-user queries. Data
retention and deletion procedures must be defined before production launch.

## 38. Diagnostics

Logs may contain operation, type, size/count bucket, contact boolean, result
class, normalized code, attempt number, and duplicate result. They must never
contain ID, UID, email, subject, message, path, signed URL, filename, raw error,
provider content, group ID, or route.

## 39. Threat review

Callable Auth, Admin Auth lookup, server rate limits, immutable records,
transactional identity, header-safe email parsing, plain-text rendering,
strict IDs, Storage metadata verification, private rules, bounded signed links,
trusted recipient/sender configuration, normalized errors, and server-only
delivery state defend against spam, replay, duplicate execution, injection,
MIME spoofing, oversized/cross-user media, URL leakage, forged identity,
arbitrary routing, and client success forgery.

## 40. Orphan cleanup

The client should best-effort delete uploads when a draft is abandoned or
finalization definitively fails. A future scheduled Admin cleanup job should
delete unreferenced objects older than a conservative grace period. It must
compare against canonical records before deletion and log only aggregate
counts.

## 41. Deployment dependencies

Later deployment requires implemented/exported v2 callable and trigger,
Firestore and Storage rules, indexes if queried, a provider adapter, verified
sender, secrets/config, IAM for Auth/Storage/Firestore/Secret Manager, emulator
tests, and device acceptance. Nothing was deployed in 8B.8.1.

## 42. Required secrets

The server contract names `FEEDBACK_EMAIL_PROVIDER_API_KEY`,
`FEEDBACK_EMAIL_SENDER`, and `FEEDBACK_RECIPIENT_EMAIL`. Values must use the
repository-standard Secret Manager mechanism and must never be committed or
printed. Gmail SMTP remains possible but would require an app password,
documented limits/deliverability, and Secret Manager; no provider is selected.

## 43. QA plan

Focused pure QA covers types, content and email boundaries, consent, safe IDs,
attachment limits/ownership, request authority, server-neutral delivery, and
this decision record. Later phases add callable idempotency/rate-limit emulator
tests, Firestore rules QA, Storage rules QA, trigger/provider-fake QA, and
Android/iOS draft/account-switch/device acceptance.

## 44. Known limitations

This phase defines but does not execute trusted Storage metadata checks,
canonical request hashing, cleanup, delivery, signed links, retention, or
provider idempotency. Low-risk app metadata is client-asserted. Delivery is
bounded at-least-once, not exactly-once.

## 45. Future phases

8B.8.2 may add the Settings route and validated text/contact form only.
Subsequent separately approved phases implement uploads, callable intake,
rules, provider delivery, cleanup, and deployment acceptance. No later phase
was started here.

## Final decision record

- Canonical collection: `feedbackSubmissions`
- Submission entry point: trusted callable Function
- Email delivery: Firestore-triggered trusted Function
- Recipient: trusted configuration, expected `reviewa782@gmail.com`
- Reply email: Auth default, editable, server-validated, consent-gated,
  Reply-To only
- Account email: trusted server snapshot, distinct from edited Reply-To
- Attachments: private UID-scoped Storage with trusted verification and bounded
  server-generated links
- Client delivery authority: none
- Canonical record mutability: immutable to clients
