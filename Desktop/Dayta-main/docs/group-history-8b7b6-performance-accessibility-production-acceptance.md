# 8B.7B.6 — Group History Performance, Accessibility & Production Acceptance

## 1. Scope

Repository hardening, deterministic performance evidence, accessibility
implementation review, deployment readiness, manual acceptance planning, and
honest release classification.

## 2. Non-goals

No deployment, EAS build, device claim, production observation, backfill,
writer, event type, rule, index, analytics, source join, or UI redesign.

## 3. Acceptance-level definitions

- Level 1 repository: automated/static/emulator evidence and documentation.
- Level 2 deployment readiness: exact dependencies, sequence, smoke tests, and
  rollback are documented.
- Level 3 staging/device: pending actual Android/iOS and assistive-tech results.
- Level 4 production: pending authorized deployment and observation.

## 4. Repository inspection

The canonical mapper and recording transaction, both active lifecycle paths,
privacy-safe diagnostics, query caps/cursors, aggregation, route state machine,
polish helpers, Personal History acceptance patterns, Firebase configuration,
Functions exports, rules, indexes, Expo config, and EAS profiles were reviewed.

## 5. Performance methodology

The final QA performs six Node runs per dataset, discards the warm-up run, and
reports the median of five for merge, grouping, accessibility-label, and target
preparation. These are repository/runtime measurements, not device rendering.

## 6. Dataset sizes

0, 1, 25, 50, 100, 250, 500, 1,000, 2,000, and 5,000 presentation events;
5,000 and 5,001 summary boundaries; tied timestamps and duplicates.

## 7. Algorithmic review

Merge uses a `Map` and is O(n+m), grouping is O(n) plus deterministic sorting,
and target/label preparation is O(1) per row. There are no source reads per row,
unbounded retries, or unbounded scans.

## 8. React rendering review

Sections are memoized, callbacks governing network transitions are stable for
their request model, rows are memoized, IDs are stable keys, stale/unmounted
responses are guarded, and refresh/pagination have independent refs. Header and
footer legitimately reflect multiple state domains and remain lightweight.

## 9. SectionList review

The single scroll owner remains. Variable-height Dynamic Type rows make
`getItemLayout` unsafe; clipping is not enabled. Sticky day headers remain off
to avoid repeated accessibility context.

## 10. Restoration-map bound

The presentation-only map has a 32-entry LRU-style cap.

## 11. Request concurrency

Version invalidation, mounted checks, transition guards, refresh and pagination
refs, access-loss clearing, and account-key invalidation prevent stale writes.
Static and pure-state acceptance checks cover the guards; device latency stress
remains pending.

## 12. Dense-month results

Presentation preparation is exercised through 5,000 events. Timeline memory is
bounded by pages the user loads, while service scans remain capped.

## 13. Scan-cap behavior

Page scan cap remains 1,000 and summary scan cap 5,000. A known-exhausted
synthetic 5,000-event month is complete; 5,001 is explicitly partial.

## 14. Firestore read-cost review

Approximate document reads: unfiltered first page normally 51 or fewer source
documents to prove a 50-row page; sparse categories may scan up to 1,000;
Load More repeats from its canonical cursor; a full summary reads through month
exhaustion up to 5,000; malformed/unsupported documents consume scan budget;
refresh repeats page and summary reads. Exact billing depends on production
behavior and is not claimed. Sparse filters, dense summaries, repeated refresh,
rapid filter switching, and many readers are the principal cost risks.

## 15. Summary performance

Summary is a separate bounded service request, never derived from timeline
pages, protected by request identity, reloaded on refresh/month changes, and
not reloaded by filter-only changes.

## 16. Accessibility audit

Repository review covers reading order, headings, month context, selected
filters, summary meaning, row semantics, decorative elements, pagination,
errors, refresh, and access loss.

## 17. Accessibility labels

Labels contain factual type, stored title, attribution, optional summary, and
local time; omit IDs/email/routes; deduplicate matching attribution; and are
bounded to 700 characters. Navigation is expressed through a separate hint.

## 18. Dynamic Type review

Rows have no fixed height; text containers can shrink/wrap; filters scroll;
summary counters wrap; attribution uses lines; and controls retain 48-point
minimum targets. Physical maximum-font acceptance is pending.

## 19. Color/theme review

All six themes use existing background, surface, border, primary, text, muted,
badge, and primary-text tokens. No formal contrast ratio is claimed.

## 20. Reduced-motion review

No feature-essential animation exists. Pressed opacity and immediate,
non-animated scroll-to-top do not carry unique information.

## 21. Physical screen-reader status

VoiceOver and TalkBack: **Pending**.

## 22. Physical layout status

Android, iPhone, tablet, orientation, and maximum font scaling: **Pending**.

## 23. Navigation acceptance

Repository-proven target derivation and route authorization pass. Physical
navigation acceptance is pending.

## 24. Access-loss acceptance

Rules/emulator and route-state guards pass. Live device removal while viewing
is pending.

## 25. Offline/reconnect acceptance

The UI retains authorized rows on ordinary failures and offers refresh/retry;
no persistent History cache exists. Device network conditioning is pending.

## 26. Background/foreground acceptance

Mounted/version guards are implemented. Physical lifecycle testing is pending.

## 27. Deleted-source acceptance

The ledger snapshot persists and the destination owns unavailable behavior.
Physical route observation is pending.

## 28. Sparse-history acceptance

Category scan limits are explicit and Tasks has honest empty copy. Historical
data remains sparse because no backfill exists.

## 29. End-to-end writer acceptance

Both writers pass Functions/emulator recording QA. Deployed end-to-end
observation is pending.

## 30. Rules acceptance

Active roles/viewer reads and removed, blocked, unrelated, signed-out, and
client-write denials pass emulator QA.

## 31. Index acceptance

Emulator queries pass without a Group History composite index. Production
missing-index smoke validation remains pending.

## 32. Deployment readiness

Exact exports, rules dependency, no-index conclusion, commands, order, smoke
tests, observation, rollback, and preservation policy are documented.

## 33. Deployment status

Not performed or authorized.

## 34. Mobile build status

No EAS, Android, iOS, TestFlight, Play, or production build was run.

## 35. Production observation status

Pending. The runbook defines sanitized signals, window, blockers, and sign-off.

## 36. Privacy review

UI and accessibility output exclude raw identities. Restoration contains only
month/filter state. Diagnostics are normalized and content-free. QA uses
synthetic identities.

## 37. Release-blocking defects

No repository-level blocker remains after bounding restoration. Device,
staging, missing-index, and production findings may still block release.

## 38. Non-blocking limitations

No backfill; Group Task writer/navigation absent; partial dense/sparse results;
no scroll-offset restoration, search, member filters, charts, realtime
listener, persistent offline cache, or source-status preview.

## 39. Rollback plan

Stop rollout; restore reviewed Functions/rules/mobile artifacts as applicable;
never weaken membership isolation; preserve canonical events; and require a
separate reviewed plan for any data repair.

## 40. QA results

Final acceptance coordinates performance, caps, restoration, accessibility,
security/static, and release-document checks. Exact results are recorded by the
command output and implementation report.

## 41. Regression results

Group History, Personal History, Planner, Group Calendar, Group Routines,
TypeScript, Functions build, lint, and diff hygiene are required at the release
commit.

## 42. Defects fixed

The previously unbounded restoration map is now a 32-entry recency cache.
Accessibility labels are explicitly bounded, and SectionList batch/window
settings now document repository-level rendering bounds.

## 43. Open risks

Actual device rendering, screen readers, offline/reconnect, lifecycle,
navigation return, deleted sources, deployed writers/rules/index state, billing,
and production observation.

## 44. Acceptance classification

Target classification after passing automation:
**Repository complete; deployment ready; staging/device and production
acceptance pending.**

## 45. Recommended next phase

Do not invent 8B.7B.7. Request an explicitly authorized **Group History staged
deployment and device-acceptance window**.
