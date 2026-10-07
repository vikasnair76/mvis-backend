# 8B.8.3 Feedback Attachment Pipeline

## 1. Scope
Private client media selection, validation, previews, upload orchestration,
cleanup, and future callable claims.
## 2. Non-goals
No canonical submission, callable, email, provider, signed link, or deployment.
## 3. Existing media infrastructure reused
Resumable Firebase tasks, Blob verification, progress clamping, attempt
identity, cancellation, and best-effort deletion patterns.
## 4. Picker dependency
Existing `expo-image-picker` 17 is reused.
## 5. Native-build implications
No dependency or app-config change; no fresh development build is required.
## 6. Feedback ID lifecycle
A Crypto UUID without hyphens is created on first accepted attachment, restored
for the session, retained across retries, and removed when the draft empties.
## 7. Attachment ID lifecycle
Generated once on acceptance and retained across progress, cancellation, retry,
and ordering changes.
## 8. Local attachment model
Contains local/preview URI, metadata, progress, status, attempt ID, and
normalized error. It is never a callable claim.
## 9. Canonical claim model
Only uploaded items with exact expected paths convert to bounded
`FeedbackAttachmentDoc` values.
## 10. Limits
Four total/four images/one video; 10 MiB image, 50 MiB video, 30 seconds, and
50 MiB combined. Boundaries are inclusive.
## 11. MIME allowlist
JPEG, PNG, WebP, and MP4. `image/jpg`, `image/x-png`, and `video/mpeg4` aliases
normalize to canonical values.
## 12. Image validation
Requires URI, allowed MIME, positive finite size and dimensions, and limits.
## 13. Video validation
Additionally requires positive finite duration at most 30 seconds.
## 14. Picker flow
Add Attachment opens Image/Video/Cancel. Selection is library-only and normal
cancellation is silent.
## 15. Permission behavior
Media-library permission is requested only after the action. Camera and
microphone permissions are never requested.
## 16. Preview behavior
Images use `expo-image`; videos use a safe themed fallback to avoid starting
playback or requesting audio behavior.
## 17. Upload-start strategy
Valid accepted items upload automatically.
## 18. Upload concurrency
At most two tasks run concurrently; ready items remain queued.
## 19. Progress
Per-item progress is clamped, displayed, and exposed as an accessibility
progressbar.
## 20. Cancellation
Cancel invalidates the attempt, cancels the task, and exposes Retry.
## 21. Retry
Best-effort deletes a possibly completed object, retains both IDs, creates a
new attempt, and re-enters the queue.
## 22. Stale-attempt protection
Every callback must match the item's current attempt; removed IDs also cause
late success cleanup rather than resurrection.
## 23. Account switching
All active tasks are canceled and only the new UID cache becomes visible.
## 24. Sign-out
Tasks stop and no previews remain visible.
## 25. Draft restoration
Completed/local items restore in-memory. Uploading/canceling items normalize to
an interrupted failure and never falsely resume.
## 26. Remove behavior
Removal invalidates callbacks and best-effort deletes an uploaded object.
## 27. Discard behavior
All tasks cancel, uploaded objects are scheduled for cleanup, both draft caches
clear, and IDs reset.
## 28. Storage path
Exactly `feedback/{uid}/{feedbackId}/{attachmentId}`.
## 29. Storage metadata
Only owner UID, feedback ID, attachment ID, kind, and upload time; never email,
subject, message, filename, or URI.
## 30. Storage rules
Owner-only create/delete, create-only upload, strict IDs/type/size/metadata,
and all reads denied. Group roles confer no access.
## 31. Cleanup
Deletion derives the exact canonical path and returns only normalized outcomes.
## 32. Orphan limitation
Power loss, process death, cancellation races, and delete failure can orphan
objects. A future server reconciliation job remains required.
## 33. Privacy
No public/download URLs, Base64, route payloads, or persistent local storage.
## 34. Diagnostics
No URI, path, IDs, filename, content, email, or raw error is logged.
## 35. Security review
Strict paths, UID rules, MIME/size checks, count/total enforcement, exact claims,
attempt invalidation, bounded concurrency, private reads, and cleanup address
the documented client threats.
## 36. QA
Pure state/limit/claim/privacy QA, Storage emulator QA, prior form/architecture
QA, and existing media regression.
## 37. Known limitations
No persistent queue, background service, video thumbnail/playback, compression,
server orphan reconciler, or physical-device acceptance.
## 38. Next phase
8B.8.4 may implement trusted intake and email delivery.

Attachments may be privately uploaded during 8B.8.3, but no feedback
submission is created or transmitted.
