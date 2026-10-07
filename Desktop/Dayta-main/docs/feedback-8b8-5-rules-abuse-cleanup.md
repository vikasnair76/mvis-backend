# 8B.8.5 — Rules, Abuse Protection & Cleanup

## 1–3. Scope, non-goals, and trusted architecture

This phase hardens the existing authenticated callable, immutable canonical
record, private attachments, and triggered provider delivery. It adds no
dashboard, ticketing, anonymous intake, arbitrary files, or public URLs.

## 4–6. Firestore contract and roles

`feedbackSubmissions`, nested `deliveries`, `feedbackRateLimits`,
`feedbackOperations`, and `feedbackCleanup` explicitly deny every client read
and write. Author, group, moderator, and administrator claims confer no access.
Only Admin SDK code can operate on these records.

## 7–8. Storage contract and finalized-path decision

The existing `feedback/{uid}/{feedbackId}/{attachmentId}` path is retained;
moving objects would add a failure-prone copy lifecycle. Uploads are
authenticated, UID-scoped, create-only, unreadable, unlistable, MIME/size
bounded, and require the exact metadata key set. The owner may delete an
unfinalized object, but a cross-service Firestore existence check denies client
deletion once its canonical feedback document exists. Canonical creation is the
final binding event.

## 9–12. Replay, fingerprint, rate limiting, and retention

The SHA-256 fingerprint hashes the normalized, deterministically ordered request
including schema, consent, reply address, content, app context, and attachment
claims. It excludes trusted timestamps, signed URLs, and delivery fields.
Same-ID/same-payload replay is accepted without quota or delivery reset;
conflicting replay is rejected. Hour and day keys are floor divisions of trusted
server epoch milliseconds, so boundaries are UTC. Only accepted transaction
creates increment counters. Hour counters expire logically after two hours and
day counters after two days through TTL-compatible `expiresAt` timestamps
(with `expiresAtMs` retained for diagnostics); production must configure
Firestore TTL or retain the documented scheduled-cleanup fallback before launch.

## 13–21. Upload abuse and orphan cleanup

An orphan is an exactly parsed feedback object older than the seven-day grace
period with no canonical `feedbackSubmissions/{feedbackId}` document. The daily
03:30 UTC job lists pages of 250, inspects at most 2,000 objects, and performs at
most five object operations concurrently. It uses trusted Storage `timeCreated`,
never client timestamps. A 30-minute server-only lease prevents overlap and
expires after crashes. Page tokens are used only within an invocation and are
not persisted. Malformed paths, missing/invalid ages, metadata failures,
canonical lookup failures, and canonical mismatches are conservatively skipped.
Existing canonical records are never deleted. Missing objects are harmless
through idempotent deletion.

## 22–23. Delivery reconciliation and retention

Every 15 minutes, a bounded query inspects at most 100 email delivery records
whose processing claim is older than 15 minutes. A separate expiring lease
prevents overlapping reconcilers. Recovery reuses the original
`feedbackId:email:v1` provider identity and the standard transactional claim and
delivery implementation. Sent and maximum-attempt records are untouched.
Delivery records and terminal normalized outcomes remain with canonical
feedback; transient signed URLs and raw provider failures are never stored.

## 24–27. Signed URLs, canonical retention, accounts, and headers

Seven-day signed URLs are generated only for canonical verified paths during an
email attempt. Link failure fails the whole attempt. Canonical feedback and its
attachments are retained until an approved product/legal retention policy
exists; this phase performs no canonical deletion. Existing account deletion
does not explicitly redact or delete feedback, and that policy remains a
release-review decision. Abandoned uploads remain cleanup eligible. Reply-To,
sender, and recipient reject CR/LF, whitespace lists, angle brackets, protocol
prefixes, and placeholders. Clients cannot supply headers.

## 28–30. Configuration and dry-run decision

The API key must be nonblank and non-placeholder; sender and recipient must be
single safe bare addresses. Tests may inject nonproduction destinations.
Production acceptance must explicitly verify `reviewa782@gmail.com`. A dry-run
delivery mode was not added: emulator provider fakes already exercise canonical
and delivery behavior without introducing a production-mode ambiguity.

## 31–33. Logging, metrics, and alerts

Logs use low-cardinality operation, normalized result/error, attempt, and
aggregate counts. They exclude IDs, addresses, content, paths, attachment names,
signed URLs, and provider payloads. Recommended metrics are intake accepted,
rate-limited, and validation failures; delivery sent, retry, terminal failure,
and stuck recovery; and cleanup inspected, deleted, and error counts. Alert on
provider/configuration failures, terminal-failure or stuck-record growth,
repeated cleanup failures, verification spikes, and anomalous rate limiting.

## 34–38. Errors, time, resources, retries, indexes, and drift

Maintenance uses normalized classes such as lease unavailable, list/metadata/
lookup/delete failure, delivery query/reconcile failure, configuration invalid,
and unknown. All age/window/lease comparisons use trusted UTC epoch
milliseconds. Cleanup uses 512 MiB, 540 seconds, one instance, and no platform
retry; reconciliation uses 512 MiB, 300 seconds, one instance, and no scheduler
retry. Provider delivery retains its five-attempt application bound. One
collection-group index supports `deliveries(state, claimedAtMs)`. Static drift
QA checks schema, limits, delivery identity, retry/link bounds, denial paths,
cleanup bounds, documentation, and server-only recipient behavior.

## 39–41. Security, privacy, and QA

Canonical data and operational state are server-only; Storage permissions
cannot be elevated by custom roles. Cleanup is bounded, leased, conservative,
and idempotent. Emulator attack tests cover Firestore denials and Storage
finalization. Focused cleanup, drift, intake, delivery, replay, validation,
privacy, TypeScript, build, lint, and diff checks form the repository gate.

## 42–44. Deployment prerequisites, limitations, and next phase

Follow the feedback deployment-readiness checklist. Cross-service Storage rules
require both Firestore and Storage rules to be deployed consistently. Firestore
TTL is only prepared, not enabled. Canonical retention/redaction remains a
product/legal decision. Provider idempotency remains an external guarantee.
Physical-device and live-provider acceptance belong to 8B.8.6.

8B.8.5 performs repository hardening only. No Firebase rules, Functions,
schedules, TTL policies, secrets, or provider configuration were deployed.
