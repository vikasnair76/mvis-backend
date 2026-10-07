# Group History production acceptance checklist

Status: **Unperformed — all device, staging, and production rows pending.**

Record a result only from the named device/build and environment. Never use
production member names, titles, IDs, or event content in defect notes.

| Test ID | Platform | Device/build | Precondition | Steps | Expected result | Actual result | Pass/fail | Defect | Retest | Tester/date |
|---|---|---|---|---|---|---|---|---|---|---|
| GH-01 | Android | Pending | Active viewer; synthetic sparse month | Open dashboard and History | Authorized route loads without dashboard History query | Pending | Pending | — | Pending | Pending |
| GH-02 | iOS | Pending | Active viewer; synthetic sparse month | Open dashboard and History | Authorized route and timeline load | Pending | Pending | — | Pending | Pending |
| GH-03 | Android/TalkBack | Pending | TalkBack enabled | Traverse title, month, summary, filters, rows, footer | Logical order; controls and row semantics are accurate | Pending | Pending | — | Pending | Pending |
| GH-04 | iOS/VoiceOver | Pending | VoiceOver enabled | Repeat GH-03 | Logical order; no duplicate/private row speech | Pending | Pending | — | Pending | Pending |
| GH-05 | Android/iOS | Pending | Maximum accessibility font size | Exercise month, filters, rows, summary, Retry | Text wraps; controls remain tappable; no overlap | Pending | Pending | — | Pending | Pending |
| GH-06 | Android/iOS | Pending | Each of six Dayta themes | Inspect all controls and states | Text, selection, borders, notices and disabled states remain legible | Pending | Pending | — | Pending | Pending |
| GH-07 | Android/iOS | Pending | Phone supports rotation | Rotate portrait/landscape while loaded | Month/filter state and layout remain usable | Pending | Pending | — | Pending | Pending |
| GH-08 | Tablet/large width | Pending | Tablet or legitimate large-width build | Open summary and dense timeline | Centered max width; wrapping and navigation remain usable | Pending | Pending | — | Pending | Pending |
| GH-09 | Android/iOS | Pending | Loaded authorized data | Disable network, refresh, paginate, reconnect | Existing authorized data is not mislabeled; retry/reconnect succeeds | Pending | Pending | — | Pending | Pending |
| GH-10 | Android/iOS | Pending | Loaded authorized data | Background during request; foreground later | No stale/mixed data or stuck loading state | Pending | Pending | — | Pending | Pending |
| GH-11 | Android/iOS | Pending | Manager can remove test viewer | Remove viewer while History is open | Events, summary, cursor, restoration disappear immediately | Pending | Pending | — | Pending | Pending |
| GH-12 | Android/iOS | Pending | Accounts A/B with distinct state | Switch A to B while request is delayed | A’s rows never appear; B uses only B/group restoration | Pending | Pending | — | Pending | Pending |
| GH-13 | Android/iOS | Pending | Shared-subtask History event | Open row and return | Correct goal/subtask opens; month/filter remain | Pending | Pending | — | Pending | Pending |
| GH-14 | Android/iOS | Pending | Routine occurrence History event | Open row and return | Correct group occurrence opens; month/filter remain | Pending | Pending | — | Pending | Pending |
| GH-15 | Android/iOS | Pending | Source deleted/unavailable | Open historical row | Calm unavailable state; History fact remains | Pending | Pending | — | Pending | Pending |
| GH-16 | Android/iOS | Pending | Synthetic 100+ month | Load and repeatedly paginate | Stable order; no duplicates; Retry preserves rows | Pending | Pending | — | Pending | Pending |
| GH-17 | Android/iOS | Pending | Sparse Tasks month | Select Tasks and refresh | Honest empty/partial copy; no loop | Pending | Pending | — | Pending | Pending |
| GH-18 | Android/iOS | Pending | Month has multiple categories | Change filters | Timeline changes; full-month summary does not | Pending | Pending | — | Pending | Pending |
| GH-19 | Staging | Pending | Active writers deployed | Complete shared subtask | One deterministic canonical event appears | Pending | Pending | — | Pending | Pending |
| GH-20 | Staging | Pending | Active writers deployed | Complete routine occurrence | One deterministic canonical event appears | Pending | Pending | — | Pending | Pending |
| GH-21 | Staging | Pending | Active viewer/member/removed fixtures | Query as each identity | Active viewer reads; removed/unrelated/blocked denied | Pending | Pending | — | Pending | Pending |
| GH-22 | Production | Pending | Authorized release and observation window | Execute approved smoke plan | Writers, query, summary, rules and diagnostics satisfy runbook | Pending | Pending | — | Pending | Pending |

## Evidence requirements

- Record app version, commit, EAS build identifier, OS, device, Firebase
  project alias, and test time.
- Attach screenshots or recordings only when they contain synthetic data.
- Record failures with a sanitized defect reference and repeat the exact case
  after remediation.
- Do not mark VoiceOver, TalkBack, device, staging, or production rows passed
  from repository or emulator evidence.
