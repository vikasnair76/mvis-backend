# Feedback Release Acceptance Checklist

Status values: Passed, Failed, Blocked, Not run, Not applicable. Every manual
item requires an evidence link, timestamp, tester, environment, and device where
applicable. Nothing below is pre-checked.

## 1. Repository QA
- [ ] Status: ____ Evidence: ____ Tester/date: ____
## 2. Emulator end-to-end
- [ ] Status: ____ Evidence: ____ Tester/date: ____
## 3. Firestore rules
- [ ] Status: ____ Evidence: ____ Tester/date: ____
## 4. Storage rules
- [ ] Status: ____ Evidence: ____ Tester/date: ____
## 5. Development deployment
- [ ] Project ID and alias recorded: ____ Status: ____ Evidence: ____
## 6. Provider configuration
- [ ] Secret configured without exposing its value: ____ Evidence: ____
## 7. Real email
- [ ] Exactly one controlled message received: ____ Evidence: ____
## 8. Reply-To
- [ ] Consent-on correct and consent-off absent: ____ Evidence: ____
## 9. Signed links
- [ ] Image/video links work and expire as contracted: ____ Evidence: ____
## 10. iOS physical
- [ ] Device/OS: ____ Image: ____ Video: ____ Evidence: ____
## 11. Android physical
- [ ] Device/OS: ____ Image: ____ Video: ____ Evidence: ____
## 12. Upload interruption
- [ ] Cancel, retry, background, and process interruption: ____ Evidence: ____
## 13. Offline/reconnect
- [ ] No false success; reconnect retry idempotent: ____ Evidence: ____
## 14. Account switching
- [ ] No cross-account draft/media visibility: ____ Evidence: ____
## 15. VoiceOver
- [ ] Order, labels, hints, errors, progress, controls: ____ Evidence: ____
## 16. TalkBack
- [ ] Order, labels, hints, errors, progress, controls: ____ Evidence: ____
## 17. Dynamic Type
- [ ] Largest supported sizes remain usable: ____ Evidence: ____
## 18. Themes
- [ ] Every Dayta theme and system appearance: ____ Evidence: ____
## 19. Reduced motion
- [ ] No essential animation dependency: ____ Evidence: ____
## 20. Rate limits
- [ ] 5/6 hourly and 20/21 daily boundaries: ____ Evidence: ____
## 21. Replay/idempotency
- [ ] Equivalent replay, conflicts, and after-sent replay: ____ Evidence: ____
## 22. Orphan cleanup
- [ ] Dry-run/staging old, recent, malformed, finalized cases: ____ Evidence: ____
## 23. Delivery reconciliation
- [ ] Expired claim recovery and five-attempt cap: ____ Evidence: ____
## 24. Monitoring
- [ ] Privacy-safe logs, metrics, and alert routing: ____ Evidence: ____
## 25. Indexes
- [ ] Development index ready: ____ Evidence: ____
## 26. Schedules
- [ ] Daily cleanup and 15-minute reconciliation observed: ____ Evidence: ____
## 27. Rollback
- [ ] Drill restores prior revision without weakening privacy: ____ Evidence: ____
## 28. Open defects
- [ ] P0: ____ P1: ____ P2: ____ P3: ____ Evidence: ____
## 29. Release decision
- [ ] GO / CONDITIONAL GO / NO-GO / BLOCKED: ____ Rationale: ____
## 30. Approver and date
- [ ] Acceptance owner: ____ Approval: ____ Date/time: ____
