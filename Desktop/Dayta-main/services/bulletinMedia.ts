import {
  createVideoLinkAttachment,
  mapMediaAttachmentDocs,
  normalizeVideoLink,
  type MediaAttachmentDoc,
} from "./mediaAttachments";

export function mapLegacyBulletinAttachments(
  bulletinId: string,
  authorUid: string,
  createdAtMs: number,
  imageUrls: unknown,
  videoUrls: unknown
): MediaAttachmentDoc[] {
  const images = Array.isArray(imageUrls) ? imageUrls : [];
  const videos = Array.isArray(videoUrls) ? videoUrls : [];
  const mappedImages = images
    .filter((url): url is string => typeof url === "string" && /^https:\/\//.test(url))
    .map((url, index): MediaAttachmentDoc => ({
      id: `legacy_${bulletinId}_image_${index}`,
      type: "image", storagePath: null, downloadUrl: url, thumbnailUrl: null,
      externalUrl: null, mimeType: null, fileName: null, sizeBytes: null,
      width: null, height: null, durationMs: null, uploadedByUid: null,
      createdAtMs: null, provider: null, providerMediaId: null, title: null,
    }));
  const mappedVideos = videos.flatMap((url, index) => {
    if (typeof url !== "string" || !normalizeVideoLink(url)) return [];
    return [createVideoLinkAttachment({
      id: `legacy_${bulletinId}_video_${index}`,
      rawUrl: url,
      createdByUid: authorUid || "legacy",
      createdAtMs,
    })];
  });
  return [...mappedImages, ...mappedVideos].slice(0, 4);
}

export function mapBulletinAttachments(input: {
  groupId: string;
  bulletinId: string;
  authorUid: string;
  createdAtMs: number;
  attachments: unknown;
  imageUrls: unknown;
  videoUrls: unknown;
}): MediaAttachmentDoc[] {
  const canonical = mapMediaAttachmentDocs(input.attachments, {
    type: "bulletin",
    groupId: input.groupId,
    bulletinId: input.bulletinId,
  });
  return canonical.length > 0
    ? canonical
    : mapLegacyBulletinAttachments(
      input.bulletinId,
      input.authorUid,
      input.createdAtMs,
      input.imageUrls,
      input.videoUrls
    );
}

export function bulletinRemovedAttachments(
  previous: MediaAttachmentDoc[],
  next: MediaAttachmentDoc[]
): MediaAttachmentDoc[] {
  const nextIds = new Set(next.map((item) => item.id));
  return previous.filter((item) => !nextIds.has(item.id));
}
