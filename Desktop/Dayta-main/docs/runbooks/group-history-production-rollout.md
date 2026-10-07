# Group History production rollout runbook

## 1. Scope

Controlled staging, device acceptance, production rollout, observation, and
rollback for Group History. This document does not authorize execution.

## 2. Preconditions

Use a reviewed release commit with clean required artifacts, passing acceptance
suites, an approved change window, named operator/reviewer, synthetic fixtures,
and explicit Firebase/mobile deployment authorization.

## 3. Environment verification

Confirm `firebase --version`, Node 24 for Functions, Java for emulators, Expo
configuration, EAS CLI policy, authenticated Firebase identity, and selected
project. Do not print secrets or private environment values.

## 4. Required repository commit

Record immutable commit SHA: `________________`. Never deploy an unrecorded
working-tree state.

## 5. Required Firebase project

The repository default alias currently resolves to
`dayta---goalsettingapp`. The operator must independently verify the intended
staging/production target with `firebase use` before any mutation.

## 6. Functions exports

- `recordSharedSubtaskGroupHistory`
- `processGroupRoutineOccurrenceTransition` (the routine History writer is
  integrated into this broader trusted transition function)

Review all side effects of the second export before selective deployment.

## 7. Rules dependency

`groups/{groupId}/historyEvents/{historyEventId}` reads require current active
group membership and reject client writes. Deploy reviewed rules before
exercising the mobile UI against a target lacking those rules.

## 8. Index conclusion

No Group History composite index is declared or required by emulator evidence.
The nested collection query uses `occurredAtMs` plus document ID ordering.
Production missing-index behavior remains a smoke-test release blocker.

## 9. Build commands

```text
npx tsc --noEmit
npm --prefix functions run build
npm run test:group-history-final-acceptance
npm run test:group-history-ui
npm run test:group-history-polish
```

## 10. Emulator commands

Run the Group History architecture, query, query-emulator, recording, rules,
UI, polish, and final-acceptance scripts listed in `package.json`. Then run
Personal History acceptance, Planner execution, Group Calendar, and
`test:group-routines:all`.

## 11. Deployment commands

Prepare, review, and run only with explicit authorization:

```text
firebase use <verified-project-alias-or-id>
firebase deploy --only firestore:rules
firebase deploy --only functions:recordSharedSubtaskGroupHistory,functions:processGroupRoutineOccurrenceTransition
```

No Group History index deployment is expected. If the broader release includes
reviewed index changes, deploy them as a separate inspected target.

## 12. Mobile build commands

Prepare only; do not execute without authorization:

```text
eas build --profile preview --platform android
eas build --profile preview --platform ios
```

Production profiles require a separate release approval.

## 13. Deployment order

1. Freeze and identify the release commit.
2. Re-run repository and emulator acceptance.
3. Verify project, rules diff, Functions export diff, runtime, and environment.
4. Deploy rules.
5. Deploy the two reviewed function exports.
6. Run staging writer/query/authorization smoke tests.
7. Produce authorized preview builds.
8. Complete the device checklist.
9. Obtain production approval.
10. Deploy/distribute production artifacts.
11. Observe the agreed window and sign off or roll back.

## 14. Staging verification

Use synthetic groups and accounts. Verify both writers, idempotency, filters,
summary independence, pagination, viewer reads, removed/blocked denial,
navigation, account switching, offline/reconnect, and sanitized logs.

## 15. Production verification

Use approved synthetic production fixtures. Avoid inspecting user content.
Confirm one new event per active writer, canonical query order, summary update,
active-viewer access, removed-member denial, and absence of index errors.

## 16. Writer smoke tests

Complete one shared subtask and one routine occurrence. Confirm deterministic
create or already-exists result, correct event type, and no conflict/failure.

## 17. Query smoke tests

Open current month, change categories, paginate if seeded, refresh, and confirm
the summary remains full-month. Treat missing-index errors as blockers.

## 18. Viewer smoke test

An active viewer must read Group History and proven source routes without
obtaining write capabilities.

## 19. Access-loss smoke test

Remove/block the viewing test account while History is visible. Confirm
immediate data and restoration clearing and rule denial on subsequent reads.

## 20. Sparse-history expectation

Only newly recorded trusted completions appear. Older data is not inferred or
backfilled. Tasks stays empty until its writer is separately approved.

## 21. Privacy-safe observation

Observe normalized writer status/event type, query result class, partial reason,
counts, completeness, retryability, permission-denial class, and index errors.
Never record group/event/source IDs, names, titles, summaries, emails, paths,
routes, raw errors, actor IDs, or credited IDs. Suggested observation window:
24 hours staging and the separately approved production window. Alert on
conflicts, sustained writer failures, missing-index failures, unauthorized
reads, runaway retry behavior, or private diagnostic content.

## 22. Rollback triggers

Critical authorization leak, stale account data, writer corruption/conflict,
runaway loops/cost, unavailable core route, missing-index failure, or severe
accessibility/device defect blocks rollout.

## 23. Functions rollback

Stop rollout, identify the prior known-good commit, rebuild it, and redeploy only
the affected reviewed exports. Preserve canonical History documents.

## 24. Rules rollback

Restore the prior reviewed ruleset only if it preserves active-member isolation
and client-write denial. Never loosen rules as an emergency workaround.

## 25. Mobile rollback

Stop distribution, use the approved store/channel rollback procedure, and
restore the prior known-good mobile artifact.

## 26. Data-preservation policy

Do not delete, rewrite, backfill, or compensate canonical History events during
rollback. Any data repair needs a separate reviewed migration plan.

## 27. Incident notes template

Record sanitized timestamp/window, environment, commit/build, symptom,
normalized error class, affected event type, scope estimate, decision owner,
rollback action, verification, and follow-up defect. Include no content or IDs.

## 28. Completion sign-off

Repository SHA: `_____`; project: `_____`; rules: `_____`; Functions: `_____`;
mobile builds: `_____`; checklist: `_____`; observation window: `_____`;
operator: `_____`; reviewer: `_____`; final decision/date: `_____`.
