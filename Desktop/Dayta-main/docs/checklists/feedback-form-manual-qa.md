# Feedback Form Manual QA

Repository implementation is complete. All physical-device items remain
pending until exercised on the named platform.

## Navigation

- [ ] Open Feedback & Support from Settings.
- [ ] Navigate back, reopen, and confirm same-account draft restoration.
- [ ] Open the route directly while signed in.
- [ ] Open directly while signed out and confirm the sign-in gate.
- [ ] Confirm Send remains disabled and explains why.
- [ ] Switch accounts and confirm prior content never appears.
- [ ] Sign out and confirm no private form content remains visible.

## Fields

- [ ] Select each of the four feedback types.
- [ ] Verify optional Subject counter and boundary.
- [ ] Enter/paste a multiline Message and verify line breaks.
- [ ] Toggle contact off and on without losing the local Reply Email.
- [ ] Edit Reply Email and verify validation.
- [ ] Test an account with null Auth email.

## Keyboard and layout

- [ ] iOS keyboard does not cover lower fields or actions.
- [ ] Android keyboard does not cover lower fields or actions.
- [ ] Verify a narrow phone layout.
- [ ] Verify large and accessibility text sizes.
- [ ] Move between Subject, Message, Switch, and Reply Email.

## Draft lifecycle

- [ ] Navigate away and return during the same session.
- [ ] Discard a text-bearing draft and confirm.
- [ ] Cancel discard and verify content remains.
- [ ] Reset a control-only draft.
- [ ] Switch accounts.
- [ ] Confirm process restart does not promise persistence.

## Themes

- [ ] daytaGold
- [ ] indigoFocus
- [ ] peachGrove
- [ ] graphiteDark
- [ ] paperWhite
- [ ] roseQuartz

Check background, fields, borders, placeholder/helper/error text, chips,
disabled controls, warning card, send action, discard action, and pressed state.

## Accessibility

- [ ] VoiceOver reading order and field/error announcements.
- [ ] TalkBack reading order and field/error announcements.
- [ ] Selected feedback type is announced.
- [ ] Contact state is announced.
- [ ] Disabled Reply Email is announced.
- [ ] Disabled Send reason is available.
- [ ] Discard confirmation is readable and operable.
