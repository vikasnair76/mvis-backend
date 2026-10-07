import * as ImagePicker from "expo-image-picker";

import {
  createMediaAttachmentId,
  getMediaAttachmentPolicy,
  normalizeLocalMediaCandidate,
  validateLocalMediaCandidate,
  type LocalMediaAttachmentCandidate,
  type MediaAttachmentContextType,
} from "../../services/mediaAttachments";

export type PendingCommentMedia = {
  id: string;
  candidate: LocalMediaAttachmentCandidate;
};

function inferMimeType(asset: ImagePicker.ImagePickerAsset): string {
  const source = (asset.fileName || asset.uri).split("?")[0].toLowerCase();
  return (
    asset.mimeType?.toLowerCase() ||
    (source.endsWith(".mp4")
      ? "video/mp4"
      : source.endsWith(".gif")
        ? "image/gif"
        : source.endsWith(".png")
          ? "image/png"
          : source.endsWith(".webp")
            ? "image/webp"
            : source.endsWith(".jpg") || source.endsWith(".jpeg")
              ? "image/jpeg"
              : "application/octet-stream")
  );
}

export async function pickComposerMediaCandidates(input: {
  contextType: Extract<
    MediaAttachmentContextType,
    | "bulletin_comment"
    | "shared_goal_comment"
    | "group_dm_message"
    | "group_conversation_message"
  >;
  remaining: number;
  existingVideoCount: number;
}): Promise<PendingCommentMedia[]> {
  if (input.remaining <= 0) {
    throw new Error("You have reached the attachment limit.");
  }
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Media library permission is required.");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    allowsMultipleSelection: true,
    selectionLimit: input.remaining,
  });
  if (result.canceled) return [];

  const policy = getMediaAttachmentPolicy(input.contextType);
  const selected: PendingCommentMedia[] = [];
  let videoCount = input.existingVideoCount;
  for (const asset of result.assets) {
    const mimeType = inferMimeType(asset);
    const candidate = normalizeLocalMediaCandidate({
      localUri: asset.uri,
      type:
        mimeType === "video/mp4"
          ? "video"
          : mimeType === "image/gif"
            ? "gif"
            : "image",
      mimeType,
      fileName: asset.fileName,
      sizeBytes: asset.fileSize,
      width: asset.width,
      height: asset.height,
      durationMs: asset.duration,
    });
    if (!candidate) throw new Error("This media type is not supported.");
    validateLocalMediaCandidate(candidate, policy);
    if (candidate.type === "video" && ++videoCount > policy.maxUploadedVideos) {
      throw new Error("Only one uploaded video can be attached.");
    }
    selected.push({ id: createMediaAttachmentId(), candidate });
  }
  return selected;
}

export const pickCommentMediaCandidates = pickComposerMediaCandidates;
