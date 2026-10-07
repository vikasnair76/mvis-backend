# 8B.8.2 Feedback Settings Entry & Submission Form

## 1. Scope

Adds authenticated Settings navigation, a themed feedback form, canonical
validation, and account-isolated session drafts.

## 2. Non-goals

No attachments, uploads, callable invocation, Firestore writes, email delivery,
rules, secrets, deployment, or production mutation.

## 3. Repository patterns reused

Expo Router `/settings/*` routes, Firebase Auth observers, theme hooks/tokens,
wrapping selection chips, Switch controls, Alerts, and screen-local styles.

## 4. Route

`app/settings/feedback.tsx`, titled `Feedback & Support`.

## 5. Settings placement

A Support card follows Automation Preferences. Its chat-bubble row says
“Feedback & Support” and “Share feedback, request a feature, or report a
problem.”

## 6. Readiness gating

The entry is visible in development and production. Signed-out direct access
shows a sign-in gate. `FEEDBACK_SUBMISSION_READY` is false, and the disabled
send button has no handler.

## 7. Form fields

Type, optional subject, required multiline message, contact consent, and
editable Reply Email.

## 8. Feedback types

All four canonical service values render as wrapping accessible radio chips.

## 9. Subject behavior

Single-line, optional, no destructive typing normalization, maximum 120,
counter shown, canonical validation on blur.

## 10. Message behavior

Required plain text, multiline, line breaks preserved, maximum 5,000, counter
shown, canonical validation on blur.

## 11. Contact consent

Explicit Switch. Turning it off disables and de-emphasizes Reply Email,
suppresses its errors, and canonical validation produces null without deleting
the locally typed value.

## 12. Reply Email default

A new draft uses normalized nullable Firebase Auth `currentUser.email`.

## 13. Reply Email editing

Edits set `replyEmailTouched` and survive same-UID Auth refresh and route
remount. The account default is not reapplied to a restored draft.

## 14. Null-account-email behavior

Contact defaults off and Reply Email starts empty. Users can enable contact and
enter a valid address.

## 15. Account switching

Drafts are keyed by UID. A UID transition clears visible state before loading
only the new UID's draft; signed-out state renders no draft.

## 16. Validation

The form delegates type, subject, message, contact, and email normalization to
`services/feedback.ts`. Errors use calm field-specific copy.

## 17. Draft restoration

A module-level least-recently-used Map stores at most six meaningful drafts for
the current app process. Same-account route return restores the draft.

## 18. Draft privacy

Only type, subject, message, consent, Reply Email, and touched state are cached.
No UID exists inside payloads, no AsyncStorage is used, and content is not
logged, analyzed, serialized into routes, or sent.

## 19. Discard behavior

Discard appears only for meaningful changes. Subject/message content requires
an accessible destructive confirmation; otherwise reset is immediate.

## 20. Submit behavior in this phase

Send is always disabled with an accessible reason and a visible readiness card.
No feedback is transmitted during 8B.8.2.

## 21. Keyboard behavior

A platform-aware `KeyboardAvoidingView`, scrolling form,
`keyboardShouldPersistTaps="handled"`, Android top-aligned multiline input, and
Subject-to-Message return flow keep controls reachable.

## 22. Accessibility

The screen has a heading, radio roles and selected states, labeled fields,
required/optional language, live error regions, announced Switch/disabled
states, accessible send reason, and labeled discard confirmation.

## 23. Dynamic Type

Chips wrap; rows use minimum rather than fixed heights; labels, helper text, and
errors wrap; the entire form remains scrollable.

## 24. Theme behavior

All surfaces, text, borders, selected/error/warning/disabled/destructive
states, and pressed feedback use the existing tokens shared by all six themes.

## 25. QA

Focused QA covers initial values, validation boundaries, consent, injection,
dirty/reset behavior, Auth isolation, bounded restoration, sanitized cached
payloads, route structure, accessibility markers, and the transmission ban.

## 26. Known limitations

Drafts intentionally disappear on process termination. Physical-device
keyboard, Dynamic Type, contrast, VoiceOver, and TalkBack acceptance remains
manual. The disabled action cannot perform submit-attempt validation.

## 27. Next phase

8B.8.3 may add the separately approved attachment pipeline. Trusted intake and
email delivery remain reserved for 8B.8.4.
