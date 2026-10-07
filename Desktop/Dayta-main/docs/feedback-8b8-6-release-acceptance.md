# 8B.8.6 — Feedback QA & Release Acceptance

## 1–6. Scope, environments, accounts, and precautions

This phase validates the existing Feedback & Support feature; it adds no product
scope. Repository and Firebase Emulator Suite testing use local controlled data.
No development/staging alias exists in `.firebaserc`; its only alias resolves to
`dayta---goalsettingapp`, so no remote deployment is authorized or attempted.
No real test accounts, provider credentials, inboxes, or physical devices were
available. Test content must remain synthetic and secrets must never enter logs,
screenshots, reports, app configuration, or Git.

## 7. Gate A — Repository and Emulator Acceptance

Status: **Partially passed**. Focused suites,
TypeScript, Functions build, focused lint, Firestore attack tests, Storage rule
tests, and shared-media regression are recorded in the implementation report.
The final acceptance automation verifies exports, scripts, rules, schedules,
resource limits, documentation, privacy, and the disabled production gate.
The complete callable-to-trigger flow was exercised through focused handler
tests with a fake provider, but a single integrated Functions/Auth/Firestore/
Storage emulator flow was not added or executed and remains a Gate A blocker.

## 8. Gate B — Development/Staging Deployment Acceptance

Status: **Blocked**. There is no positively identified nonproduction Firebase
alias, authenticated target approval, or nonproduction configuration. No rules,
indexes, Functions, schedules, or secrets were deployed.

## 9. Gate C — Provider and Inbox Acceptance

Status: **Blocked**. A verified staging Resend sender, approved staging
recipient, and provider secret were not available. No email was sent.

## 10. Gate D — Physical Device and Accessibility Acceptance

Status: **Blocked**. Physical iOS and Android devices and interactive
VoiceOver/TalkBack evidence were unavailable. Static accessibility and picker
contracts passed, but they are not substitutes for device acceptance.

## 11. Gate E — Recovery and Rollback Acceptance

Status: **Partially passed / drill blocked**. Cleanup leases, expired delivery
claims, retry identity, bounds, and rules are automated. A deployed rollback
drill is blocked until a dedicated nonproduction project is approved.

## 12–13. Repository and emulator results

See the final report for exact suite totals. Firestore and Storage emulators
loaded the current rules. Cross-service finalized-delete protection passed with
both emulators active.

## 14–18. Deployment, provider, inbox, Reply-To, and signed links

All are blocked outside local fake-provider and signed-link contract tests.
Fake-provider tests verify one normalized request, stable idempotency,
consent-aware Reply-To, plain-text formatting, and seven-day expiry calculation.
They do not prove Resend acceptance or real link retrieval.

## 19–26. Devices, lifecycle, accessibility, and presentation

iOS, Android, offline/reconnect, process death, account switching, VoiceOver,
TalkBack, Dynamic Type, all-theme visual review, and reduced-motion acceptance
remain Not run or Blocked. The manual checklist defines evidence fields.

## 27–30. Rate limits, replay, cleanup, and reconciliation

Automated tests validate hourly enforcement, idempotent replay, conflicts,
trusted time derivation, cleanup classification and lease recovery, and delivery
claim collision/recovery. A deployed 20/21 daily boundary, live scheduled
cleanup, and live Eventarc recovery observation remain blocked.

## 31–35. Monitoring, configuration, indexes, schedules, and rollback

Privacy-safe signal and alert contracts are documented. Configuration is
server-only and validates malformed or placeholder values. The new delivery
index is repository-defined but not remotely built. Schedules are exported but
not deployed. Rollback sequence is prepared below; execution is blocked.

## 36–40. Defects and residual risk

P1 defect found and fixed: feedback sending had been hardcoded enabled despite
no accepted backend environment. It now requires the compile-time public flag
`EXPO_PUBLIC_FEEDBACK_SUBMISSION_ENABLED=true`; all EAS profiles explicitly
default it to false and the UI explains disabled status.

No open repository-tested P0/P1 defect is known. Release remains blocked because
required deployed/provider/device gates are unexecuted. Residual risks include
provider idempotency behavior, real signed links, platform picker behavior,
accessibility, scheduler permissions, index readiness, and real rollback.

## 41. Proposed deployment sequence

1. Create/approve a dedicated nonproduction Firebase project and alias.
2. Verify CLI target, bucket, Auth domain, billing, Scheduler, Eventarc, and region.
3. Configure a staging recipient, verified sender, and provider secret.
4. Deploy the delivery index and wait until ready.
5. Deploy Firestore rules.
6. Deploy callable and delivery trigger with submission UI still disabled.
7. Deploy Storage rules and both maintenance schedules.
8. Run Admin/client denial and finalization checks.
9. Enable the flag only in a dedicated development build.
10. Execute Gates B–E and obtain approval.
11. Repeat the reviewed backend-first sequence for production.
12. Activate production only through a release build whose flag is explicitly true.

Exact exports are `submitFeedback`, `processFeedbackEmailDelivery`,
`cleanupAbandonedFeedbackAttachmentsScheduled`, and
`reconcileStuckFeedbackDeliveriesScheduled`.

## 42. Rollback sequence

Record the accepted pre-release commit and deployed versions. Disable new client
activation first. Redeploy the prior Functions revision, then the prior
coordinated Firestore/Storage rules and indexes as reviewed. Restore the prior
provider secret version if required. Verify canonical denial, private Storage,
and one controlled recovery case. Never loosen feedback access or delete
canonical evidence as a rollback shortcut.

## 43. Release decision

**BLOCKED.** Repository acceptance is healthy, but development deployment, real
provider/inbox, physical-device/accessibility, and deployed rollback gates are
mandatory and unavailable.

## 44. Production prerequisites

Complete every unchecked item in the release checklist, explicitly identify the
production project, verify `reviewa782@gmail.com`, close all P0/P1 defects, and
obtain named release approval.

## 45. Post-deployment smoke test

Use General / “Dayta production feedback smoke test” / “Controlled production
readiness verification.” Enable contact with an approved monitored address and
attach one small non-sensitive image. Verify exactly one canonical record,
quota increment, delivery record, email, Reply-To, private valid link, and no
sensitive logs or duplicate.

## 46. Post-deployment monitoring

Observe 24–72 hours: accepted/rejected intake, verification failures, rate
limits, provider retry/failure, stuck processing, cleanup, configuration errors,
and duplicate tester reports. Never inspect user content through logs.

## 47. Final sign-off

Not granted. Approver, evidence, and timestamp remain blank in the checklist.

## 48. Next roadmap item

Execute the blocked nonproduction/provider/device acceptance handoff. Do not
begin production rollout until the decision changes to GO or explicitly
approved CONDITIONAL GO.
