import type { MediaAttachmentDoc } from "../../services/mediaAttachments";

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function isViewableMediaAttachment(
  attachment: MediaAttachmentDoc
): boolean {
  if (
    attachment.type === "image" ||
    attachment.type === "gif" ||
    attachment.type === "video"
  ) {
    return isHttpsUrl(attachment.downloadUrl);
  }

  return (
    attachment.type === "video_link" &&
    attachment.provider === "youtube" &&
    isHttpsUrl(attachment.externalUrl)
  );
}

export function getViewableMediaAttachments(
  attachments: readonly MediaAttachmentDoc[]
): MediaAttachmentDoc[] {
  const seen = new Set<string>();
  return attachments.filter((attachment) => {
    if (
      typeof attachment.id !== "string" ||
      attachment.id.length === 0 ||
      seen.has(attachment.id) ||
      !isViewableMediaAttachment(attachment)
    ) {
      return false;
    }
    seen.add(attachment.id);
    return true;
  });
}

export function clampMediaViewerIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

export function mediaAttachmentAccessibilityType(
  attachment: MediaAttachmentDoc
): string {
  if (attachment.type === "gif") return "GIF";
  if (attachment.type === "video" || attachment.type === "video_link") {
    return "video";
  }
  return "image";
}
