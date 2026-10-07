# Feedback Deployment Readiness

Do not execute this checklist until 8B.8.6 approves release.

- [ ] Freeze and identify the reviewed release commit.
- [ ] Verify the Firebase project, Functions region, and Storage bucket.
- [ ] Verify the Resend domain and bare sender address.
- [ ] Bind `FEEDBACK_EMAIL_PROVIDER_API_KEY` through Secret Manager.
- [ ] Set and verify `FEEDBACK_EMAIL_SENDER`.
- [ ] Set `FEEDBACK_RECIPIENT_EMAIL=reviewa782@gmail.com`.
- [ ] Confirm no test recipient or placeholder configuration remains.
- [ ] Verify Scheduler API availability and scheduler service permissions.
- [ ] Review the delivery collection-group index.
- [ ] Review and deploy Firestore and Storage rules as one coordinated change.
- [ ] Review both callable/trigger exports and both maintenance schedules.
- [ ] Confirm secret bindings and function resource settings.
- [ ] Run all feedback emulator, drift, privacy, media, and auth regressions.
- [ ] Validate configuration in a development/staging Firebase project.
- [ ] Run one explicitly authorized provider email smoke test.
- [ ] Verify Reply-To and seven-day attachment links.
- [ ] Run orphan cleanup in observed dry-run/staging conditions first.
- [ ] Verify finalized attachments are skipped and stale orphans are bounded.
- [ ] Verify expired delivery recovery without exceeding five attempts.
- [ ] Confirm Firestore TTL policy for `expiresAtMs`, or approve fallback cleanup.
- [ ] Create privacy-safe dashboards and alerts from documented metrics.
- [ ] Monitor intake, delivery, reconciliation, and cleanup after release.
- [ ] Keep rollback commands project-specific and peer-reviewed: redeploy the
      prior Functions revision and prior coordinated Firestore/Storage rules.
- [ ] After rollback, verify canonical denial and private Storage invariants;
      never loosen access or delete canonical evidence as a workaround.
