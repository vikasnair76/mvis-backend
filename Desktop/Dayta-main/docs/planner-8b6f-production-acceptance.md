# 8B.6F Planner Production Acceptance

This checklist separates repository/emulator readiness from physical-device and
production acceptance. It does not authorize deployment, EAS builds, migrations,
or backfills.

## Static and emulator gate

- [x] One Planner notification batch per completed generation run.
- [x] Deterministic run and suggestion identity suppression.
- [x] Active, non-snoozed, unexpired lifecycle validation at enqueue and delivery.
- [x] Planner, personal/group, conflict, and opportunity preferences.
- [x] Normal inbox integration; no second Planner inbox.
- [x] Push and inbox navigation open `/planner` and never execute.
- [x] Backend-only notification requests and aggregate metrics.
- [x] Bounded queue scans, batch size, retries, and stale leases.
- [x] Structured event names without titles, evidence, action payloads, or private content.
- [x] Expo notification config plugin, physical-device guard, Android channel,
  permission request, and EAS project ID are present.
- [ ] Run physical-device matrix below.
- [ ] Deploy rules, indexes, and Functions only after approval.
- [ ] Observe the first production refresh, batch, delivery, open, and suppression.

## Android device matrix

- [ ] Grant and deny notification permission.
- [ ] Receive one suggestion and a multi-suggestion batch in foreground.
- [ ] Receive in background and from a terminated launch.
- [ ] Tap push and confirm Planner opens without applying anything.
- [ ] Open the matching normal inbox item and confirm read state.
- [ ] Double-tap notification; confirm one open metric and no execution.
- [ ] Apply an eligible suggestion manually; confirm one private calendar block.
- [ ] Disable Planner and confirm no new batch.
- [ ] Disable Planner notifications while leaving Planner enabled.
- [ ] Test offline Planner, refresh, execution, history, and reconnect recovery.

## iOS device matrix

- [ ] Grant and deny permission and verify Settings recovery copy.
- [ ] Foreground, background, and terminated delivery.
- [ ] Notification grouping and badge behavior (Dayta currently does not set a badge).
- [ ] Tap push and inbox item; both open Planner only.
- [ ] Confirm accepted, dismissed, expired, and snoozed suggestions do not push.
- [ ] Confirm manual Apply is still required and creates one private calendar block.
- [ ] Confirm dark appearance, VoiceOver order, and Dynamic Type.

## Tablet and accessibility matrix

- [ ] Portrait and landscape Planner layouts.
- [ ] Today preview and Planner cards at large text sizes.
- [ ] VoiceOver and TalkBack announce title, New state, expansion state, and actions.
- [ ] Focus order follows card content and confirmation controls.
- [ ] All interactive targets remain at least 44 points/pixels.
- [ ] No critical clipping at maximum supported font scale.
- [ ] Light/dark contrast and status text do not rely on color alone.
- [ ] Reduced motion introduces no required animation dependency.

## Production observation

Observe only privacy-safe structured fields:

- `planner_notification_batch`
- `planner_notification_sent`
- `planner_notification_suppressed`
- `planner_notification_opened`
- `planner_notification_duplicate`
- `planner_notification_preference_disabled`
- `planner_execution_notification_skipped`

Confirm aggregate generated/notified/opened/executed/dismissed and suppression
counts without productivity scoring or member comparison. Do not log suggestion
titles, evidence, proposed actions, messages, comments, notes, email addresses,
tokens, media URLs, or Storage paths.
