import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  DocumentReference,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";

import { auth, db } from "./firebase";
import { mapBulletinAttachments } from "./bulletinMedia";
import {
  mapMediaAttachmentDocs,
  type MediaAttachmentDoc,
} from "./mediaAttachments";

export type GroupRole =
  | "owner"
  | "admin"
  | "moderator"
  | "member"
  | "viewer";

export const GROUP_ROLE_RANK: Record<GroupRole, number> = {
  viewer: 0,
  member: 1,
  moderator: 2,
  admin: 3,
  owner: 4,
};

export const GROUP_ASSIGNABLE_ROLES = [
  "admin",
  "moderator",
  "member",
  "viewer",
] as const;

export type AssignableGroupRole = (typeof GROUP_ASSIGNABLE_ROLES)[number];

export const isAssignableGroupRole = (
  value: unknown
): value is AssignableGroupRole => {
  return (
    typeof value === "string" &&
    GROUP_ASSIGNABLE_ROLES.includes(value as AssignableGroupRole)
  );
};

export const getGroupRoleRank = (
  role: GroupRole | null | undefined
): number => {
  if (!role) return -1;
  return GROUP_ROLE_RANK[role] ?? -1;
};

export const canManageGroupMembers = (
  actorRole: GroupRole | null | undefined
): boolean => {
  return actorRole === "owner" || actorRole === "admin";
};

export const canManageGroupInvites = (
  actorRole: GroupRole | null | undefined
): boolean => {
  return actorRole === "owner" || actorRole === "admin";
};

export const canModerateGroupContent = (
  actorRole: GroupRole | null | undefined
): boolean => {
  return (
    actorRole === "owner" ||
    actorRole === "admin" ||
    actorRole === "moderator"
  );
};

export const canUseGroupHereMention = (
  actorRole: GroupRole | null | undefined
): boolean => {
  return (
    actorRole === "owner" ||
    actorRole === "admin" ||
    actorRole === "moderator"
  );
};

export const canPostGroupBulletins = (
  actorRole: GroupRole | null | undefined
): boolean => {
  return (
    actorRole === "owner" ||
    actorRole === "admin" ||
    actorRole === "moderator"
  );
};

export const canRemoveGroupMember = (params: {
  actorRole: GroupRole | null | undefined;
  targetRole: GroupRole | null | undefined;
}): boolean => {
  const actorRank = getGroupRoleRank(params.actorRole);
  const targetRank = getGroupRoleRank(params.targetRole);

  if (params.targetRole === "owner") return false;
  if (actorRank < getGroupRoleRank("admin")) return false;

  return actorRank > targetRank;
};

export const canChangeGroupMemberRole = (params: {
  actorRole: GroupRole | null | undefined;
  targetRole: GroupRole | null | undefined;
  nextRole: AssignableGroupRole;
}): boolean => {
  const actorRank = getGroupRoleRank(params.actorRole);
  const targetRank = getGroupRoleRank(params.targetRole);
  const nextRank = getGroupRoleRank(params.nextRole);

  if (params.targetRole === "owner") return false;
  if (actorRank < getGroupRoleRank("admin")) return false;

  return actorRank > targetRank && actorRank > nextRank;
};

export type GroupVisibility = "private" | "invite_only" | "searchable";

export type GroupJoinPolicy = "invite_only" | "request" | "open";

export type GroupDiscoveryCategory =
  | "general"
  | "fitness"
  | "productivity"
  | "learning"
  | "wellness"
  | "work"
  | "other";

export type GroupMemberStatus = "active" | "removed";

export type GroupBlockedUserDoc = {
  uid: string;
  blockedByUid: string;

  blockedUserEmail?: string | null;
  blockedUserDisplayName?: string | null;

  blockedByEmail?: string | null;
  blockedByDisplayName?: string | null;

  reason?: string | null;
  adminNote?: string | null;

  createdAtMs: number;
  updatedAtMs: number;
};

export type GroupDoc = {
  id: string;
  name: string;
  description?: string | null;
  ownerUserId: string;
  visibility: GroupVisibility;

  discoverable?: boolean;
  joinPolicy?: GroupJoinPolicy;
  category?: GroupDiscoveryCategory | null;
  tags?: string[];
  summary?: string | null;
  isHiddenFromDiscovery?: boolean;
  lastActivityAtMs?: number | null;

  memberCount: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type GroupDiscoverySummary = {
  id: string;
  name: string;
  description?: string | null;
  summary?: string | null;
  visibility: GroupVisibility;
  discoverable: boolean;
  joinPolicy: GroupJoinPolicy;
  category: GroupDiscoveryCategory;
  tags: string[];
  memberCount: number;
  lastActivityAtMs?: number | null;
  ownerUserId?: string | null;
    createdAtMs?: number | null;
};

export const normalizeGroupJoinPolicy = (
  value: unknown
): GroupJoinPolicy => {
  if (value === "open" || value === "request" || value === "invite_only") {
    return value;
  }

  return "invite_only";
};

export const normalizeGroupDiscoveryCategory = (
  value: unknown
): GroupDiscoveryCategory => {
  if (
    value === "general" ||
    value === "fitness" ||
    value === "productivity" ||
    value === "learning" ||
    value === "wellness" ||
    value === "work" ||
    value === "other"
  ) {
    return value;
  }

  return "general";
};

export const normalizeGroupDiscoveryTags = (tags: unknown): string[] => {
  if (!Array.isArray(tags)) return [];

  return Array.from(
    new Set(
      tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8)
    )
  );
};

export const normalizeGroupDiscoverySearchText = (value: unknown): string => {
  if (typeof value !== "string") return "";

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s#_-]/g, " ")
    .replace(/\s+/g, " ");
};

export const mapGroupBlockedUserDoc = (
  uid: string,
  data: Record<string, any>
): GroupBlockedUserDoc => {
  return {
    uid,

    blockedByUid: data.blockedByUid ?? "",

    blockedUserEmail: data.blockedUserEmail ?? null,
    blockedUserDisplayName: data.blockedUserDisplayName ?? null,

    blockedByEmail: data.blockedByEmail ?? null,
    blockedByDisplayName: data.blockedByDisplayName ?? null,

    reason: data.reason ?? null,
    adminNote: data.adminNote ?? null,

    createdAtMs:
      typeof data.createdAtMs === "number"
        ? data.createdAtMs
        : Date.now(),

    updatedAtMs:
      typeof data.updatedAtMs === "number"
        ? data.updatedAtMs
        : Date.now(),
  };
};

export const shouldGroupAppearInDiscovery = (
  group: Pick<
    GroupDoc,
    "visibility" | "discoverable" | "isHiddenFromDiscovery"
  >
): boolean => {
  return (
    group.visibility === "searchable" &&
    group.discoverable === true &&
    group.isHiddenFromDiscovery !== true
  );
};

export const toGroupDiscoverySummary = (
  groupId: string,
  group: GroupDoc
): GroupDiscoverySummary | null => {
  if (!shouldGroupAppearInDiscovery(group)) {
    return null;
  }

  return {
    id: groupId,
    name: group.name?.trim() || "Untitled group",
    description: group.description ?? null,
    summary: group.summary ?? group.description ?? null,
    visibility: group.visibility,
    discoverable: group.discoverable === true,
    joinPolicy: normalizeGroupJoinPolicy(group.joinPolicy),
    category: normalizeGroupDiscoveryCategory(group.category),
    tags: normalizeGroupDiscoveryTags(group.tags),
        memberCount:
      typeof group.memberCount === "number" && Number.isFinite(group.memberCount)
        ? group.memberCount
        : 0,
    createdAtMs:
      typeof group.createdAtMs === "number" ? group.createdAtMs : null,
    lastActivityAtMs:
      typeof group.lastActivityAtMs === "number"
        ? group.lastActivityAtMs
        : null,
    ownerUserId: group.ownerUserId ?? null,
  };
};

export const getGroupDiscoveryStatusLabel = (
  group: Pick<
    GroupDoc,
    "visibility" | "discoverable" | "joinPolicy" | "isHiddenFromDiscovery"
  >
): string => {
  if (group.isHiddenFromDiscovery === true) {
    return "Hidden from discovery";
  }

  if (group.visibility !== "searchable" || group.discoverable !== true) {
    return "Private";
  }

  const joinPolicy = normalizeGroupJoinPolicy(group.joinPolicy);

  if (joinPolicy === "open") {
    return "Public · Open join";
  }

  if (joinPolicy === "request") {
    return "Public · Request to join";
  }

  return "Public · Invite only";
};

export const scoreGroupDiscoverySearchMatch = (
  group: GroupDiscoverySummary,
  rawQuery: string
): number => {
  const queryText = normalizeGroupDiscoverySearchText(rawQuery);

  if (!queryText) return 1;

  const name = normalizeGroupDiscoverySearchText(group.name);
  const summary = normalizeGroupDiscoverySearchText(group.summary);
  const description = normalizeGroupDiscoverySearchText(group.description);
  const category = normalizeGroupDiscoverySearchText(group.category);
  const tags = group.tags.map(normalizeGroupDiscoverySearchText);

  let score = 0;

  if (name === queryText) score += 100;
  if (name.startsWith(queryText)) score += 70;
  if (name.includes(queryText)) score += 45;

  if (tags.some((tag) => tag === queryText)) score += 60;
  if (tags.some((tag) => tag.includes(queryText))) score += 35;

  if (category === queryText) score += 30;

  if (summary.includes(queryText)) score += 20;
  if (description.includes(queryText)) score += 15;

  return score;
};

export const filterAndRankDiscoverableGroups = (
  groups: GroupDiscoverySummary[],
  searchText: string
): GroupDiscoverySummary[] => {
  const normalizedSearch = normalizeGroupDiscoverySearchText(searchText);

  const scored = groups
    .map((group) => {
      const searchableText = normalizeGroupDiscoverySearchText(
        [
          group.name,
          group.summary,
          group.description,
          group.category,
          ...(group.tags ?? []),
        ]
          .filter(Boolean)
          .join(" ")
      );

      const tagText = normalizeGroupDiscoverySearchText(
        (group.tags ?? []).join(" ")
      );

      const matchesSearch =
        !normalizedSearch || searchableText.includes(normalizedSearch);

      if (!matchesSearch) return null;

      let score = 0;

      if (normalizedSearch) {
        if (
          normalizeGroupDiscoverySearchText(group.name).includes(
            normalizedSearch
          )
        ) {
          score += 30;
        }

        if (tagText.includes(normalizedSearch)) {
          score += 24;
        }

        if (
          normalizeGroupDiscoverySearchText(group.summary).includes(
            normalizedSearch
          )
        ) {
          score += 18;
        }

        if (
          normalizeGroupDiscoverySearchText(group.description).includes(
            normalizedSearch
          )
        ) {
          score += 10;
        }

        if (
          normalizeGroupDiscoverySearchText(group.category).includes(
            normalizedSearch
          )
        ) {
          score += 8;
        }
      }

      score += Math.min(group.memberCount ?? 0, 50) * 0.4;

      if (group.lastActivityAtMs) {
        const ageDays = Math.max(
          0,
          (Date.now() - group.lastActivityAtMs) / (24 * 60 * 60 * 1000)
        );

        score += Math.max(0, 20 - ageDays);
      }

      if (group.createdAtMs) {
        const ageDays = Math.max(
          0,
          (Date.now() - group.createdAtMs) / (24 * 60 * 60 * 1000)
        );

        score += Math.max(0, 8 - ageDays * 0.5);
      }

      return {
        group,
        score,
      };
    })
    .filter(
      (
        item
      ): item is {
        group: GroupDiscoverySummary;
        score: number;
      } => item != null
    );

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;

      return (b.group.lastActivityAtMs ?? 0) - (a.group.lastActivityAtMs ?? 0);
    })
    .map((item) => item.group);
};

export type GroupDiscoveryBuckets = {
  recommended: GroupDiscoverySummary[];
  trending: GroupDiscoverySummary[];
  newest: GroupDiscoverySummary[];
};

export const buildGroupDiscoveryBuckets = (
  groups: GroupDiscoverySummary[]
): {
  recommended: GroupDiscoverySummary[];
  trending: GroupDiscoverySummary[];
  newest: GroupDiscoverySummary[];
} => {
  const uniqueById = new Map<string, GroupDiscoverySummary>();

  groups.forEach((group) => {
    uniqueById.set(group.id, group);
  });

  const uniqueGroups = Array.from(uniqueById.values());

  const recommended = [...uniqueGroups].slice(0, 8);

  const trending = [...uniqueGroups]
    .sort((a, b) => {
      const aScore =
        Math.min(a.memberCount ?? 0, 100) * 2 + (a.lastActivityAtMs ?? 0) / 1_000_000_000;

      const bScore =
        Math.min(b.memberCount ?? 0, 100) * 2 + (b.lastActivityAtMs ?? 0) / 1_000_000_000;

      return bScore - aScore;
    })
    .slice(0, 8);

  const newest = [...uniqueGroups]
    .sort((a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0))
    .slice(0, 8);

  return {
    recommended,
    trending,
    newest,
  };
};

export const getGroupDmId = ({
  groupId,
  uidA,
  uidB,
}: {
  groupId: string;
  uidA: string;
  uidB: string;
}) => {
  const [firstUid, secondUid] = [uidA, uidB].sort();

  return `${groupId}_${firstUid}_${secondUid}`;
};

export const isUserBlockedFromGroup = async ({
  groupId,
  uid,
}: {
  groupId: string;
  uid: string;
}): Promise<boolean> => {
  if (!groupId || !uid) {
    return false;
  }

  const blockedRef = doc(
    db,
    "groups",
    groupId,
    "blockedUsers",
    uid
  );

  const snap = await getDoc(blockedRef);

  return snap.exists();
};

export const mapGroupConversationDoc = (
  id: string,
  data: Record<string, any>
): GroupConversationDoc => {
  return {
    id,
    groupId: data.groupId ?? "",

    title:
      typeof data.title === "string" && data.title.trim()
        ? data.title.trim()
        : "Group conversation",

    subject: data.subject ?? null,

    memberUids: Array.isArray(data.memberUids)
      ? data.memberUids.filter((uid): uid is string => typeof uid === "string")
      : [],

    memberMap:
      data.memberMap && typeof data.memberMap === "object"
        ? data.memberMap
        : {},

    createdByUid: data.createdByUid ?? "",

    createdAtMs:
      typeof data.createdAtMs === "number" ? data.createdAtMs : 0,

    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,

    lastMessagePreview: data.lastMessagePreview ?? null,
    lastMessageAtMs:
      typeof data.lastMessageAtMs === "number" ? data.lastMessageAtMs : null,
    lastMessageSenderUid: data.lastMessageSenderUid ?? null,
      lastReadByUid:
      data.lastReadByUid && typeof data.lastReadByUid === "object"
        ? data.lastReadByUid
        : {},

    archived: data.archived === true,

archivedByUid:
  data.archivedByUid && typeof data.archivedByUid === "object"
    ? data.archivedByUid
    : {},

archivedAtMsByUid:
  data.archivedAtMsByUid && typeof data.archivedAtMsByUid === "object"
    ? data.archivedAtMsByUid
    : {},
  };
};

export const mapGroupConversationMessageDoc = (
  id: string,
  data: Record<string, any>
): GroupConversationMessageDoc => {
  const conversationId = data.conversationId ?? "";
  const groupId = data.groupId ?? "";
  const attachments = mapMediaAttachmentDocs(data.attachments, {
    type: "group_conversation_message",
    groupId,
    conversationId,
    messageId: id,
  });
  return {
    id,
    conversationId,
    groupId,

    body: data.body ?? "",
    senderUid: data.senderUid ?? "",
    senderName: data.senderName ?? null,
    senderEmail: data.senderEmail ?? null,

        replyTo:
      data.replyTo && typeof data.replyTo === "object"
        ? {
            messageId: data.replyTo.messageId ?? "",
            senderUid: data.replyTo.senderUid ?? null,
            senderName: data.replyTo.senderName ?? null,
            bodyPreview: data.replyTo.bodyPreview ?? "",
          }
        : null,

    createdAtMs:
      typeof data.createdAtMs === "number" ? data.createdAtMs : 0,

    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,

          deletedByAuthor: data.deletedByAuthor === true,
    deletedAtMs: typeof data.deletedAtMs === "number" ? data.deletedAtMs : null,

    editedAtMs: typeof data.editedAtMs === "number" ? data.editedAtMs : null,
editedByUid: data.editedByUid ?? null,

    hiddenByModeration: data.hiddenByModeration === true,
    attachments,
    attachmentCount: attachments.length,
  };
};

export const mapGroupDmDoc = (
  id: string,
  data: Record<string, any>
): GroupDmDoc => {
  return {
    id,
    groupId: data.groupId ?? "",

    participantUids: Array.isArray(data.participantUids)
      ? data.participantUids.filter((uid): uid is string => typeof uid === "string")
      : [],

    participantMap:
      data.participantMap && typeof data.participantMap === "object"
        ? data.participantMap
        : {},

            lastReadByUid:
      data.lastReadByUid && typeof data.lastReadByUid === "object"
        ? data.lastReadByUid
        : {},

    participantNames:
      data.participantNames && typeof data.participantNames === "object"
        ? data.participantNames
        : {},

    participantEmails:
      data.participantEmails && typeof data.participantEmails === "object"
        ? data.participantEmails
        : {},

    createdByUid: data.createdByUid ?? "",

    createdAtMs:
      typeof data.createdAtMs === "number" ? data.createdAtMs : 0,

    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,

    lastMessagePreview: data.lastMessagePreview ?? null,
    lastMessageAtMs:
      typeof data.lastMessageAtMs === "number" ? data.lastMessageAtMs : null,
    lastMessageSenderUid: data.lastMessageSenderUid ?? null,
    groupName: data.groupName ?? null,
subject: data.subject ?? null,
  };
};

export const mapGroupDmMessageDoc = (
  id: string,
  data: Record<string, any>
  
): GroupDmMessageDoc => {
  const dmId = data.dmId ?? "";
  const groupId = data.groupId ?? "";
  const attachments = mapMediaAttachmentDocs(data.attachments, {
    type: "group_dm_message",
    groupId,
    dmId,
    messageId: id,
  });
  return {
    id,
    dmId,
    groupId,

    body: data.body ?? "",
    senderUid: data.senderUid ?? "",
    senderName: data.senderName ?? null,
    senderEmail: data.senderEmail ?? null,
    

        replyTo:
      data.replyTo && typeof data.replyTo === "object"
        ? {
            messageId: data.replyTo.messageId ?? "",
            senderUid: data.replyTo.senderUid ?? null,
            senderName: data.replyTo.senderName ?? null,
            bodyPreview: data.replyTo.bodyPreview ?? "",
          }
        : null,

    createdAtMs:
      typeof data.createdAtMs === "number" ? data.createdAtMs : 0,

    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,

          deletedByAuthor: data.deletedByAuthor === true,
    deletedAtMs: typeof data.deletedAtMs === "number" ? data.deletedAtMs : null,

    editedAtMs: typeof data.editedAtMs === "number" ? data.editedAtMs : null,
editedByUid: data.editedByUid ?? null,

    hiddenByModeration: data.hiddenByModeration === true,
    attachments,
    attachmentCount: attachments.length,
  };
};

export type GroupDmTypingDoc = {
  uid: string;
  dmId: string;
  groupId: string;
  displayName?: string | null;
  email?: string | null;
  updatedAtMs: number;
};

export const createGroupConversation = async ({
  groupId,
  title,
  subject = null,
  creatorUid,
  creatorName = null,
  creatorEmail = null,
  memberUids,
}: {
  groupId: string;
  title: string;
  subject?: string | null;
  creatorUid: string;
  creatorName?: string | null;
  creatorEmail?: string | null;
  memberUids: string[];
}): Promise<string> => {
  if (!groupId) throw new Error("Missing group id.");
  if (!creatorUid) throw new Error("Missing creator id.");

  const trimmedTitle = title.trim();
  if (!trimmedTitle) throw new Error("Conversation title is required.");

const uniqueMemberUids = Array.from(
  new Set([creatorUid, ...memberUids].filter(Boolean))
);

const firstTargetUid = uniqueMemberUids.find((uid) => uid !== creatorUid) ?? null;

if (uniqueMemberUids.length < 2 || !firstTargetUid) {
  throw new Error("Choose at least one other member.");
}

  const nowMs = Date.now();
  const conversationRef = doc(collection(db, "groupConversations"));

  const memberMap = uniqueMemberUids.reduce<Record<string, true>>(
    (acc, uid) => {
      acc[uid] = true;
      return acc;
    },
    {}
  );

  await runTransaction(db, async (tx) => {
    const memberSnaps = await Promise.all(
      uniqueMemberUids.map((uid) =>
        tx.get(doc(db, "groups", groupId, "members", uid))
      )
    );

    const blockedSnaps = await Promise.all(
      uniqueMemberUids.map((uid) =>
        tx.get(doc(db, "groups", groupId, "blockedUsers", uid))
      )
    );

    memberSnaps.forEach((memberSnap) => {
      if (!memberSnap.exists()) {
        throw new Error("One or more members are not in this group.");
      }

      if (memberSnap.data().status !== "active") {
        throw new Error("One or more members are no longer active.");
      }
    });

    if (blockedSnaps.some((blockedSnap) => blockedSnap.exists())) {
      throw new Error("Conversation is not available for one or more members.");
    }

    tx.set(conversationRef, {
      groupId,

      title: trimmedTitle,
      subject: subject?.trim() || null,

memberUids: uniqueMemberUids,
memberMap,
lastAddedMemberUid: firstTargetUid,
lastReadByUid: uniqueMemberUids.reduce<Record<string, number>>(
        (acc, uid) => {
          acc[uid] = uid === creatorUid ? nowMs : 0;
          return acc;
        },
        {}
      ),

      createdByUid: creatorUid,
      createdByName: creatorName,
      createdByEmail: creatorEmail,

      createdAtMs: nowMs,
      updatedAtMs: nowMs,

      lastMessagePreview: null,
      lastMessageAtMs: null,
      lastMessageSenderUid: null,

      archived: false,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  return conversationRef.id;
};

export const createOrOpenGroupDm = async ({
  groupId,
  actorUid,
  actorName = null,
  actorEmail = null,
  targetUid,
  groupName = null,
subject = null,
  targetName = null,
  targetEmail = null,
}: {
  groupId: string;
  actorUid: string;
  actorName?: string | null;
  actorEmail?: string | null;
  targetUid: string;
  groupName?: string | null;
subject?: string | null;
  targetName?: string | null;
  targetEmail?: string | null;
}): Promise<string> => {
  if (!groupId) throw new Error("Missing group id.");
  if (!actorUid) throw new Error("Missing sender id.");
  if (!targetUid) throw new Error("Missing recipient id.");

  if (actorUid === targetUid) {
    throw new Error("You cannot message yourself.");
  }

  const dmId = getGroupDmId({
    groupId,
    uidA: actorUid,
    uidB: targetUid,
  });

  const dmRef = doc(db, "groupDms", dmId);

  const actorMemberRef = doc(db, "groups", groupId, "members", actorUid);
  const targetMemberRef = doc(db, "groups", groupId, "members", targetUid);

  //const actorBlockedRef = doc(db, "groups", groupId, "blockedUsers", actorUid);
  //const targetBlockedRef = doc(db, "groups", groupId, "blockedUsers", targetUid);

  const nowMs = Date.now();

  await runTransaction(db, async (tx) => {
   /**  const [
      dmSnap,
      actorMemberSnap,
      targetMemberSnap,
      actorBlockedSnap,
      targetBlockedSnap,
    ] = await Promise.all([
      tx.get(dmRef),
      tx.get(actorMemberRef),
      tx.get(targetMemberRef),
      tx.get(actorBlockedRef),
      tx.get(targetBlockedRef),
    ]); **/

    const [dmSnap, actorMemberSnap, targetMemberSnap] = await Promise.all([
  tx.get(dmRef),
  tx.get(actorMemberRef),
  tx.get(targetMemberRef),
]);

    if (!actorMemberSnap.exists()) {
      throw new Error("You are not a member of this group.");
    }

    if (!targetMemberSnap.exists()) {
      throw new Error("That member is not in this group.");
    }

    const actorMember = actorMemberSnap.data();
    const targetMember = targetMemberSnap.data();

    if (actorMember.status !== "active") {
      throw new Error("You cannot message from this group.");
    }

    if (targetMember.status !== "active") {
      throw new Error("That member is no longer active in this group.");
    }

    /** if (actorBlockedSnap.exists() || targetBlockedSnap.exists()) {
      throw new Error("Messaging is not available for this member.");
    } **/

    if (dmSnap.exists()) {
     /**  tx.update(dmRef, {
        updatedAtMs: nowMs,
        updatedAt: serverTimestamp(),
      }); **/

      return;
    }

    tx.set(dmRef, {
      groupId,

      participantUids: [actorUid, targetUid].sort(),
      participantMap: {
        [actorUid]: true,
        [targetUid]: true,
      },

      lastReadByUid: {
        [actorUid]: nowMs,
        [targetUid]: 0,
      },

      groupName,
      subject:
        subject ??
        `DM with ${targetName ?? targetEmail ?? "group member"}`,

      participantNames: {
        [actorUid]: actorName,
        [targetUid]: targetName,
      },

      participantEmails: {
        [actorUid]: actorEmail,
        [targetUid]: targetEmail,
      },

      createdByUid: actorUid,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,

      lastMessagePreview: null,
      lastMessageAtMs: null,
      lastMessageSenderUid: null,

      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });

  return dmId;
};

export const updateGroupConversationMembers = async ({
  conversationId,
  groupId,
  actorUid,
  nextMemberUids,
}: {
  conversationId: string;
  groupId: string;
  actorUid: string;
  nextMemberUids: string[];
}) => {
  if (!conversationId) throw new Error("Missing conversation id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!actorUid) throw new Error("Missing user id.");

  const uniqueMemberUids = Array.from(new Set(nextMemberUids.filter(Boolean)));

  if (!uniqueMemberUids.includes(actorUid)) {
    throw new Error("You must remain in the conversation.");
  }

  if (uniqueMemberUids.length < 2) {
    throw new Error("A conversation needs at least two members.");
  }

  const conversationRef = doc(db, "groupConversations", conversationId);
  const nowMs = Date.now();

  const nextMemberMap = uniqueMemberUids.reduce<Record<string, true>>(
    (acc, uid) => {
      acc[uid] = true;
      return acc;
    },
    {}
  );

  await runTransaction(db, async (tx) => {
    const conversationSnap = await tx.get(conversationRef);

    if (!conversationSnap.exists()) {
      throw new Error("Conversation not found.");
    }

    const conversationData = conversationSnap.data();

    if (conversationData.groupId !== groupId) {
      throw new Error("Conversation group mismatch.");
    }

    if (conversationData.archived === true) {
      throw new Error("This conversation is archived.");
    }

    const currentMemberUids = Array.isArray(conversationData.memberUids)
      ? conversationData.memberUids.filter(
          (uid): uid is string => typeof uid === "string"
        )
      : [];



    if (!currentMemberUids.includes(actorUid)) {
      throw new Error("You are not part of this conversation.");
    }

    const memberSnaps = await Promise.all(
      uniqueMemberUids.map((uid) =>
        tx.get(doc(db, "groups", groupId, "members", uid))
      )
    );

    const blockedSnaps = await Promise.all(
      uniqueMemberUids.map((uid) =>
        tx.get(doc(db, "groups", groupId, "blockedUsers", uid))
      )
    );

    memberSnaps.forEach((memberSnap) => {
      if (!memberSnap.exists() || memberSnap.data().status !== "active") {
        throw new Error("One or more members are no longer active.");
      }
    });

    if (blockedSnaps.some((blockedSnap) => blockedSnap.exists())) {
      throw new Error("Conversation is not available for one or more members.");
    }

const addedMemberUid =
  uniqueMemberUids.find((uid) => !currentMemberUids.includes(uid)) ?? null;

tx.update(conversationRef, {
  memberUids: uniqueMemberUids,
  memberMap: nextMemberMap,
  lastAddedMemberUid: addedMemberUid,
  lastMembersUpdatedByUid: actorUid,
  lastMembersUpdatedAtMs: nowMs,
  updatedAtMs: nowMs,
  updatedAt: serverTimestamp(),
});
  });
};

export const leaveGroupConversation = async ({
  conversationId,
  groupId,
  actorUid,
}: {
  conversationId: string;
  groupId: string;
  actorUid: string;
}) => {
  if (!conversationId) throw new Error("Missing conversation id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!actorUid) throw new Error("Missing user id.");

  const conversationRef = doc(db, "groupConversations", conversationId);
  const memberRef = doc(db, "groups", groupId, "members", actorUid);
  const blockedRef = doc(db, "groups", groupId, "blockedUsers", actorUid);
  const nowMs = Date.now();

  await runTransaction(db, async (tx) => {
    const [conversationSnap, memberSnap, blockedSnap] = await Promise.all([
      tx.get(conversationRef),
      tx.get(memberRef),
      tx.get(blockedRef),
    ]);

    if (!conversationSnap.exists()) {
      throw new Error("Conversation not found.");
    }

    const conversationData = conversationSnap.data();

    if (conversationData.groupId !== groupId) {
      throw new Error("Conversation group mismatch.");
    }

    if (conversationData.archived === true) {
      throw new Error("This conversation is already archived.");
    }

    const memberUids = Array.isArray(conversationData.memberUids)
      ? conversationData.memberUids.filter(
          (uid): uid is string => typeof uid === "string"
        )
      : [];

    if (!memberUids.includes(actorUid)) {
      throw new Error("You are not part of this conversation.");
    }

    if (!memberSnap.exists() || memberSnap.data().status !== "active") {
      throw new Error("You can no longer leave this conversation.");
    }

    if (blockedSnap.exists()) {
      throw new Error("Conversation actions are not available.");
    }

    const nextMemberUids = memberUids.filter((uid) => uid !== actorUid);

    const nextMemberMap = nextMemberUids.reduce<Record<string, true>>(
      (acc, uid) => {
        acc[uid] = true;
        return acc;
      },
      {}
    );

tx.update(conversationRef, {
  memberUids: nextMemberUids,
  memberMap: nextMemberMap,
  lastLeftByUid: actorUid,
  lastLeftAtMs: nowMs,
  updatedAtMs: nowMs,
  updatedAt: serverTimestamp(),
});
  });
};

export const archiveGroupConversation = async ({
  conversationId,
  groupId,
  actorUid,
}: {
  conversationId: string;
  groupId: string;
  actorUid: string;
}) => {
  if (!conversationId) throw new Error("Missing conversation id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!actorUid) throw new Error("Missing user id.");

  const conversationRef = doc(db, "groupConversations", conversationId);
  const memberRef = doc(db, "groups", groupId, "members", actorUid);
  const blockedRef = doc(db, "groups", groupId, "blockedUsers", actorUid);

  const nowMs = Date.now();

  await runTransaction(db, async (tx) => {
    const [conversationSnap, memberSnap, blockedSnap] = await Promise.all([
      tx.get(conversationRef),
      tx.get(memberRef),
      tx.get(blockedRef),
    ]);

    if (!conversationSnap.exists()) {
      throw new Error("Conversation not found.");
    }

    const conversationData = conversationSnap.data();

    if (conversationData.groupId !== groupId) {
      throw new Error("Conversation group mismatch.");
    }

    const memberUids = Array.isArray(conversationData.memberUids)
      ? conversationData.memberUids.filter(
          (uid): uid is string => typeof uid === "string"
        )
      : [];

    if (!memberUids.includes(actorUid)) {
      throw new Error("You are not part of this conversation.");
    }

    if (!memberSnap.exists() || memberSnap.data().status !== "active") {
      throw new Error("You can no longer archive this conversation.");
    }

    if (blockedSnap.exists()) {
      throw new Error("Conversation archive is not available.");
    }

    tx.update(conversationRef, {
      [`archivedByUid.${actorUid}`]: true,
      [`archivedAtMsByUid.${actorUid}`]: nowMs,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });
  });
};

export const restoreGroupConversationForUser = async ({
  conversationId,
  groupId,
  actorUid,
}: {
  conversationId: string;
  groupId: string;
  actorUid: string;
}) => {
  if (!conversationId) throw new Error("Missing conversation id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!actorUid) throw new Error("Missing user id.");

  const conversationRef = doc(db, "groupConversations", conversationId);
  const nowMs = Date.now();

  await updateDoc(conversationRef, {
    [`archivedByUid.${actorUid}`]: false,
    [`archivedAtMsByUid.${actorUid}`]: null,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
};

export const updateGroupConversationDetails = async ({
  conversationId,
  groupId,
  title,
  subject = null,
  actorUid,
}: {
  conversationId: string;
  groupId: string;
  title: string;
  subject?: string | null;
  actorUid: string;
}) => {
  if (!conversationId) throw new Error("Missing conversation id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!actorUid) throw new Error("Missing user id.");

  const trimmedTitle = title.trim();
  const trimmedSubject = subject?.trim() || null;

  if (!trimmedTitle) throw new Error("Conversation title is required.");
  if (trimmedTitle.length > 120) {
    throw new Error("Conversation title must be 120 characters or fewer.");
  }
  if (trimmedSubject && trimmedSubject.length > 240) {
    throw new Error("Subject must be 240 characters or fewer.");
  }

  const conversationRef = doc(db, "groupConversations", conversationId);
  const memberRef = doc(db, "groups", groupId, "members", actorUid);
  const blockedRef = doc(db, "groups", groupId, "blockedUsers", actorUid);
  const nowMs = Date.now();

  await runTransaction(db, async (tx) => {
    const [conversationSnap, memberSnap, blockedSnap] = await Promise.all([
      tx.get(conversationRef),
      tx.get(memberRef),
      tx.get(blockedRef),
    ]);

    if (!conversationSnap.exists()) {
      throw new Error("Conversation not found.");
    }

    const conversationData = conversationSnap.data();

    if (conversationData.groupId !== groupId) {
      throw new Error("Conversation group mismatch.");
    }

    if (conversationData.archived === true) {
      throw new Error("This conversation is archived.");
    }

    const memberUids = Array.isArray(conversationData.memberUids)
      ? conversationData.memberUids.filter(
          (uid): uid is string => typeof uid === "string"
        )
      : [];

    if (!memberUids.includes(actorUid)) {
      throw new Error("You are not part of this conversation.");
    }

    if (!memberSnap.exists() || memberSnap.data().status !== "active") {
      throw new Error("You can no longer edit this conversation.");
    }

    if (blockedSnap.exists()) {
      throw new Error("Conversation editing is not available.");
    }

    tx.update(conversationRef, {
      title: trimmedTitle,
      subject: trimmedSubject,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });
  });
};

export const getSafeMessagePreview = (
  body: string,
  attachments: readonly MediaAttachmentDoc[],
  maxLength = 120
): string => {
  const text = body.trim();
  if (text) {
    return text.length > maxLength
      ? `${text.slice(0, Math.max(0, maxLength - 3))}...`
      : text;
  }
  if (attachments.length === 1) {
    const type = attachments[0]?.type;
    return type === "video"
      ? "Sent a video"
      : type === "gif"
        ? "Sent a GIF"
        : type === "image"
          ? "Sent a photo"
          : "Sent an attachment";
  }
  return `Sent ${attachments.length} attachments`;
};

export const reserveGroupConversationMessageId = (
  conversationId: string
): string =>
  doc(collection(db, "groupConversations", conversationId, "messages")).id;

export const reserveGroupDmMessageId = (dmId: string): string =>
  doc(collection(db, "groupDms", dmId, "messages")).id;

export const sendGroupConversationMessage = async ({
  conversationId,
  groupId,
  body,
  senderUid,
  senderName = null,
  senderEmail = null,
  replyTo = null,
  messageId = null,
  attachments: rawAttachments = [],
}: {
  conversationId: string;
  groupId: string;
  body: string;
  senderUid: string;
  senderName?: string | null;
  senderEmail?: string | null;
  replyTo?: GroupMessageReplyPreview | null;
  messageId?: string | null;
  attachments?: readonly MediaAttachmentDoc[];
}) => {
  if (!conversationId) throw new Error("Missing conversation id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!senderUid) throw new Error("Missing sender id.");

  const trimmedBody = body.trim();

  if (trimmedBody.length > 2000) {
    throw new Error("Messages must be 2000 characters or fewer.");
  }

  const conversationRef = doc(db, "groupConversations", conversationId);
  const resolvedMessageId =
    messageId?.trim() || reserveGroupConversationMessageId(conversationId);
  const attachments = mapMediaAttachmentDocs(rawAttachments, {
    type: "group_conversation_message",
    groupId,
    conversationId,
    messageId: resolvedMessageId,
  });
  if (attachments.length !== rawAttachments.length) {
    throw new Error("One or more attachments are invalid.");
  }
  if (!trimmedBody && attachments.length === 0) {
    throw new Error("Write a message or add an attachment.");
  }
  const messageRef = doc(
    db,
    "groupConversations",
    conversationId,
    "messages",
    resolvedMessageId
  );

  const nowMs = Date.now();

  const [conversationSnap, senderMemberSnap, senderBlockedSnap] =
    await Promise.all([
      getDoc(conversationRef),
      getDoc(doc(db, "groups", groupId, "members", senderUid)),
      getDoc(doc(db, "groups", groupId, "blockedUsers", senderUid)),
    ]);

  if (!conversationSnap.exists()) {
    throw new Error("Conversation not found.");
  }

  const conversationData = conversationSnap.data();

  if (conversationData.groupId !== groupId) {
    throw new Error("Conversation group mismatch.");
  }

  if (conversationData.archived === true) {
    throw new Error("This conversation is archived.");
  }

  const memberUids = Array.isArray(conversationData.memberUids)
    ? conversationData.memberUids.filter(
        (uid): uid is string => typeof uid === "string"
      )
    : [];

  if (!memberUids.includes(senderUid)) {
    throw new Error("You are not part of this conversation.");
  }

  if (!senderMemberSnap.exists() || senderMemberSnap.data().status !== "active") {
    throw new Error("You can no longer send messages in this group.");
  }

  if (senderBlockedSnap.exists()) {
    throw new Error("Messaging is not available for this group.");
  }

  const memberChecks = await Promise.all(
    memberUids.map(async (memberUid) => {
      const [memberSnap, blockedSnap] = await Promise.all([
        getDoc(doc(db, "groups", groupId, "members", memberUid)),
        getDoc(doc(db, "groups", groupId, "blockedUsers", memberUid)),
      ]);

      return {
        memberUid,
        isActive: memberSnap.exists() && memberSnap.data().status === "active",
        isBlocked: blockedSnap.exists(),
      };
    })
  );

  if (memberChecks.some((item) => !item.isActive)) {
    throw new Error("This conversation is no longer available.");
  }

  if (memberChecks.some((item) => item.isBlocked)) {
    throw new Error("Messaging is not available for this conversation.");
  }

  const recipientUids = memberUids.filter((uid) => uid !== senderUid);

  await setDoc(messageRef, {
    conversationId,
    groupId,
    body: trimmedBody,
    senderUid,
    senderName,
    senderEmail,
    replyTo: replyTo
      ? {
          messageId: replyTo.messageId,
          senderUid: replyTo.senderUid ?? null,
          senderName: replyTo.senderName ?? null,
          bodyPreview: (replyTo.bodyPreview ?? "").slice(0, 160),
        }
      : null,

    hiddenByModeration: false,
    deletedByAuthor: false,
    deletedAtMs: null,
    attachments,
    attachmentCount: attachments.length,

    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateDoc(conversationRef, {
    lastMessagePreview: getSafeMessagePreview(trimmedBody, attachments),
    lastMessageAtMs: nowMs,
    lastMessageSenderUid: senderUid,
    updatedAtMs: nowMs,
  }).catch((error) => {
    console.log("[Groups] conversation parent preview update failed", error);
  });

  const preview = getSafeMessagePreview(trimmedBody, attachments, 200);

  await Promise.all(
    recipientUids.map(async (recipientUid) => {
let muted = false;

try {
  muted = await isGroupConversationMutedForUser({
    uid: recipientUid,
    conversationId,
  });
} catch (err) {
  console.log("[Groups] conversation mute check failed; sending inbox item", err);
}

const shouldNotify = await shouldCreateGroupNotificationForUser({
  uid: recipientUid,
  groupId,
  category: "comments",
});

if (muted || !shouldNotify) return;

await notifyGroupMessageRecipient({
  uid: recipientUid,
  groupId,

  inboxType: "conversation",

  title: "New group conversation message",
  body: `${senderName ?? senderEmail ?? "Someone"}: ${preview}`,

  actorUid: senderUid,
  actorName: senderName ?? senderEmail ?? null,

  groupKey: `conversation:${conversationId}`,

  relatedEntityType: "group",
  relatedEntityId: conversationId,

  notificationType: "conversation_message",

  conversationId,

  idempotencyKey: `conversation_${conversationId}_${recipientUid}_${nowMs}`,
});
    })
  ).catch((error) => {
    console.log("[Groups] conversation notification fanout failed", error);
  });
};

export const sendGroupDmMessage = async ({
  dmId,
  groupId,
  body,
  senderUid,
  senderName = null,
  senderEmail = null,
  replyTo = null,
  messageId = null,
  attachments: rawAttachments = [],
}: {
  dmId: string;
  groupId: string;
  body: string;
  senderUid: string;
  senderName?: string | null;
  senderEmail?: string | null;
  replyTo?: GroupMessageReplyPreview | null;
  messageId?: string | null;
  attachments?: readonly MediaAttachmentDoc[];
}) => {
  if (!dmId) throw new Error("Missing DM id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!senderUid) throw new Error("Missing sender id.");

  const trimmedBody = body.trim();

  if (trimmedBody.length > 2000) {
    throw new Error("Messages must be 2000 characters or fewer.");
  }

  const dmRef = doc(db, "groupDms", dmId);
  const resolvedMessageId = messageId?.trim() || reserveGroupDmMessageId(dmId);
  const attachments = mapMediaAttachmentDocs(rawAttachments, {
    type: "group_dm_message",
    groupId,
    dmId,
    messageId: resolvedMessageId,
  });
  if (attachments.length !== rawAttachments.length) {
    throw new Error("One or more attachments are invalid.");
  }
  if (!trimmedBody && attachments.length === 0) {
    throw new Error("Write a message or add an attachment.");
  }
  const messageRef = doc(db, "groupDms", dmId, "messages", resolvedMessageId);
  const senderMemberRef = doc(db, "groups", groupId, "members", senderUid);
  const senderBlockedRef = doc(db, "groups", groupId, "blockedUsers", senderUid);

  const nowMs = Date.now();

const [dmSnap, senderMemberSnap, senderBlockedSnap] = await Promise.all([
  getDoc(dmRef),
  getDoc(senderMemberRef),
  getDoc(senderBlockedRef),
]);

if (!dmSnap.exists()) {
  throw new Error("Conversation not found.");
}

const dmData = dmSnap.data();

if (dmData.groupId !== groupId) {
  throw new Error("Conversation group mismatch.");
}

const participantUids = Array.isArray(dmData.participantUids)
  ? dmData.participantUids.filter((uid): uid is string => typeof uid === "string")
  : [];

const otherParticipantUids = participantUids.filter((uid) => uid !== senderUid);

if (!participantUids.includes(senderUid)) {
  throw new Error("You are not part of this conversation.");
}

if (!senderMemberSnap.exists() || senderMemberSnap.data().status !== "active") {
  throw new Error("You can no longer send messages in this group.");
}

if (senderBlockedSnap.exists()) {
  throw new Error("Messaging is not available for this group.");
}

await Promise.all(
  otherParticipantUids.map(async (participantUid) => {
    const [memberSnap, blockedSnap] = await Promise.all([
      getDoc(doc(db, "groups", groupId, "members", participantUid)),
      getDoc(doc(db, "groups", groupId, "blockedUsers", participantUid)),
    ]);

    if (!memberSnap.exists() || memberSnap.data().status !== "active") {
      throw new Error("This conversation is no longer available.");
    }

    if (blockedSnap.exists()) {
      throw new Error("Messaging is not available for this conversation.");
    }
  })
);

const batch = writeBatch(db);

batch.set(messageRef, {
  dmId,
  groupId,
  body: trimmedBody,
  senderUid,
  senderName,
  senderEmail,
  replyTo: replyTo
    ? {
        messageId: replyTo.messageId,
        senderUid: replyTo.senderUid ?? null,
        senderName: replyTo.senderName ?? null,
        bodyPreview: (replyTo.bodyPreview ?? "").slice(0, 160),
      }
    : null,

  hiddenByModeration: false,
  deletedByAuthor: false,
  deletedAtMs: null,
  attachments,
  attachmentCount: attachments.length,

  createdAtMs: nowMs,
  updatedAtMs: nowMs,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
});

batch.update(dmRef, {
  lastMessagePreview: getSafeMessagePreview(trimmedBody, attachments),
  lastMessageAtMs: nowMs,
  lastMessageSenderUid: senderUid,
  updatedAtMs: nowMs,
  updatedAt: serverTimestamp(),
});

await batch.commit();

const dmSnapAfterSend = await getDoc(dmRef).catch((error) => {
  console.log("[Groups] DM post-send recipient refresh failed", error);
  return null;
});

if (!dmSnapAfterSend?.exists()) {
  return;
}

const dmDataAfterSend = dmSnapAfterSend.data();
const participantUidsAfterSend = Array.isArray(dmDataAfterSend.participantUids)
  ? dmDataAfterSend.participantUids.filter(
      (uid): uid is string => typeof uid === "string"
    )
  : [];

const recipientUids = participantUidsAfterSend.filter((uid) => uid !== senderUid);

  const preview = getSafeMessagePreview(trimmedBody, attachments, 200);

await Promise.all(
  recipientUids.map(async (recipientUid) => {
    const shouldNotify = await shouldCreateGroupNotificationForUser({
      uid: recipientUid,
      groupId,
      category: "comments",
    });

    if (!shouldNotify) return;

await notifyGroupMessageRecipient({
  uid: recipientUid,
  groupId,

  inboxType: "dm",

  title: `New message from ${senderName ?? senderEmail ?? "Someone"}`,
  body: preview,

  actorUid: senderUid,
  actorName: senderName ?? senderEmail ?? null,

  groupKey: `dm:${dmId}`,

  relatedEntityType: "dm",
  relatedEntityId: dmId,

  notificationType: "dm_message",

  dmId,

  idempotencyKey: `dm_${dmId}_${recipientUid}_${nowMs}`,
});
  })
).catch((error) => {
  console.log("[Groups] DM notification fanout failed", error);
});
};

export const markGroupDmRead = async ({
  dmId,
  uid,
}: {
  dmId: string;
  uid: string;
}) => {
  if (!dmId) throw new Error("Missing DM id.");
  if (!uid) throw new Error("Missing user id.");

  const nowMs = Date.now();
  const dmRef = doc(db, "groupDms", dmId);

  await updateDoc(dmRef, {
    [`lastReadByUid.${uid}`]: nowMs,
  });
};

const CONVERSATION_TYPING_ACTIVE_WINDOW_MS = 8000;

export const upsertGroupConversationTyping = async ({
  conversationId,
  groupId,
  uid,
  displayName = null,
  email = null,
}: {
  conversationId: string;
  groupId: string;
  uid: string;
  displayName?: string | null;
  email?: string | null;
}) => {
  if (!conversationId) throw new Error("Missing conversation id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!uid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  await setDoc(
    doc(db, "groupConversations", conversationId, "typing", uid),
    {
      uid,
      conversationId,
      groupId,
      displayName,
      email,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const clearGroupConversationTyping = async ({
  conversationId,
  groupId,
  uid,
}: {
  conversationId: string;
  groupId: string;
  uid: string;
}) => {
  if (!conversationId) throw new Error("Missing conversation id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!uid) throw new Error("Missing user id.");

await deleteDoc(
  doc(db, "groupConversations", conversationId, "typing", uid)
);
};

export const subscribeGroupConversationTyping = (
  conversationId: string,
  currentUid: string,
  onNext: (items: GroupConversationTypingDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!conversationId) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collection(db, "groupConversations", conversationId, "typing"),
    orderBy("updatedAtMs", "desc"),
    limit(10)
  );

  return onSnapshot(
    q,
    (snap) => {
      const nowMs = Date.now();

      const items = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();

          return {
            uid: data.uid ?? docSnap.id,
            conversationId: data.conversationId ?? conversationId,
            groupId: data.groupId ?? "",
            displayName: data.displayName ?? null,
            email: data.email ?? null,
            updatedAtMs:
              typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,
          } satisfies GroupConversationTypingDoc;
        })
        .filter(
          (item) =>
            item.uid !== currentUid &&
            item.updatedAtMs > 0 &&
            nowMs - item.updatedAtMs <= CONVERSATION_TYPING_ACTIVE_WINDOW_MS
        );

      onNext(items);
    },
    (err) => {
      console.log("[Groups] subscribeGroupConversationTyping failed", err);
      onError?.(err);
    }
  );
};

export const subscribeGroupConversationReactions = (
  conversationId: string,
  messageId: string,
  onNext: (items: GroupConversationReactionDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!conversationId || !messageId) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collection(
      db,
      "groupConversations",
      conversationId,
      "messages",
      messageId,
      "reactions"
    ),
    orderBy("createdAtMs", "asc")
  );

  return onSnapshot(
    q,
    (snap) => {
      onNext(
        snap.docs.map((docSnap) => {
          const data = docSnap.data();

          return {
            uid: data.uid ?? docSnap.id,
            conversationId: data.conversationId ?? conversationId,
            messageId: data.messageId ?? messageId,
            emoji: data.emoji ?? "👍",
            displayName: data.displayName ?? null,
            email: data.email ?? null,
            createdAtMs: data.createdAtMs ?? 0,
            updatedAtMs: data.updatedAtMs ?? 0,
          };
        })
      );
    },
    (err) => {
      console.log("[Groups] subscribeGroupConversationReactions failed", err);
      onError?.(err);
    }
  );
};

export const toggleGroupConversationReaction = async ({
  conversationId,
  messageId,
  uid,
  emoji,
  displayName = null,
  email = null,
}: {
  conversationId: string;
  messageId: string;
  uid: string;
  emoji: GroupConversationReactionEmoji;
  displayName?: string | null;
  email?: string | null;
}) => {
  if (!conversationId) throw new Error("Missing conversation id.");
  if (!messageId) throw new Error("Missing message id.");
  if (!uid) throw new Error("Missing user id.");

  const reactionRef = doc(
    db,
    "groupConversations",
    conversationId,
    "messages",
    messageId,
    "reactions",
    `${uid}_${emoji}`
  );

  const snap = await getDoc(reactionRef);

  if (snap.exists()) {
    await deleteDoc(reactionRef);
    return;
  }

  const nowMs = Date.now();

  await setDoc(reactionRef, {
    uid,
    conversationId,
    messageId,
    emoji,
    displayName,
    email,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const setGroupConversationMuted = async ({
  conversationId,
  groupId,
  uid,
  muted,
}: {
  conversationId: string;
  groupId: string;
  uid: string;
  muted: boolean;
}) => {
  if (!conversationId) throw new Error("Missing conversation id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!uid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  await setDoc(
    doc(db, "users", uid, "groupConversationMutes", conversationId),
    {
      conversationId,
      groupId,
      uid,
      muted,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const subscribeGroupConversationMute = (
  uid: string,
  conversationId: string,
  onNext: (mute: GroupConversationMuteDoc | null) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!uid || !conversationId) {
    onNext(null);
    return () => {};
  }

  return onSnapshot(
    doc(db, "users", uid, "groupConversationMutes", conversationId),
    (snap) => {
      if (!snap.exists()) {
        onNext(null);
        return;
      }

      const data = snap.data();

      onNext({
        conversationId: data.conversationId ?? conversationId,
        groupId: data.groupId ?? "",
        uid: data.uid ?? uid,
        muted: data.muted === true,
        updatedAtMs:
          typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,
      });
    },
    (err) => {
      console.log("[Groups] subscribeGroupConversationMute failed", err);
      onError?.(err);
    }
  );
};

const isGroupConversationMutedForUser = async ({
  uid,
  conversationId,
}: {
  uid: string;
  conversationId: string;
}): Promise<boolean> => {
  if (!uid || !conversationId) return false;

  const snap = await getDoc(
    doc(db, "users", uid, "groupConversationMutes", conversationId)
  );

  return snap.exists() && snap.data().muted === true;
};

export const markGroupConversationRead = async ({
  conversationId,
  uid,
}: {
  conversationId: string;
  uid: string;
}) => {
  if (!conversationId) throw new Error("Missing conversation id.");
  if (!uid) throw new Error("Missing user id.");

  const nowMs = Date.now();
  const conversationRef = doc(db, "groupConversations", conversationId);

  await updateDoc(conversationRef, {
    [`lastReadByUid.${uid}`]: nowMs,
    updatedAt: serverTimestamp(),
  });
};

export const deleteGroupDmMessageForAuthor = async ({
  dmId,
  messageId,
  uid,
}: {
  dmId: string;
  messageId: string;
  uid: string;
}) => {
  if (!dmId) throw new Error("Missing DM id.");
  if (!messageId) throw new Error("Missing message id.");
  if (!uid) throw new Error("Missing user id.");

  const messageRef = doc(db, "groupDms", dmId, "messages", messageId);
  const nowMs = Date.now();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(messageRef);

    if (!snap.exists()) throw new Error("Message not found.");

    const data = snap.data();

    if (data.senderUid !== uid) {
      throw new Error("You can only delete your own messages.");
    }

    if (data.hiddenByModeration === true) {
      throw new Error("This message was removed by moderators.");
    }

    tx.update(messageRef, {
      deletedByAuthor: true,
      deletedAtMs: nowMs,
      body: "",
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });
  });
};

export const editGroupDmMessageForAuthor = async ({
  dmId,
  messageId,
  uid,
  body,
}: {
  dmId: string;
  messageId: string;
  uid: string;
  body: string;
}) => {
  const trimmedBody = body.trim();

  if (!trimmedBody) throw new Error("Message cannot be empty.");
  if (trimmedBody.length > 2000) {
    throw new Error("Messages must be 2000 characters or fewer.");
  }

  const nowMs = Date.now();
  const messageRef = doc(db, "groupDms", dmId, "messages", messageId);
  const snap = await getDoc(messageRef);

  if (!snap.exists()) throw new Error("Message not found.");

  const data = snap.data();

  if (data.senderUid !== uid) throw new Error("You can only edit your own messages.");
  if (data.hiddenByModeration === true || data.deletedByAuthor === true) {
    throw new Error("This message cannot be edited.");
  }

  await updateDoc(messageRef, {
    body: trimmedBody,
    editedAtMs: nowMs,
    editedByUid: uid,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
};

export const editGroupConversationMessageForAuthor = async ({
  conversationId,
  messageId,
  uid,
  body,
}: {
  conversationId: string;
  messageId: string;
  uid: string;
  body: string;
}) => {
  const trimmedBody = body.trim();

  if (!trimmedBody) throw new Error("Message cannot be empty.");
  if (trimmedBody.length > 2000) {
    throw new Error("Messages must be 2000 characters or fewer.");
  }

  const nowMs = Date.now();
  const messageRef = doc(
    db,
    "groupConversations",
    conversationId,
    "messages",
    messageId
  );
  const snap = await getDoc(messageRef);

  if (!snap.exists()) throw new Error("Message not found.");

  const data = snap.data();

  if (data.senderUid !== uid) throw new Error("You can only edit your own messages.");
  if (data.hiddenByModeration === true || data.deletedByAuthor === true) {
    throw new Error("This message cannot be edited.");
  }

  await updateDoc(messageRef, {
    body: trimmedBody,
    editedAtMs: nowMs,
    editedByUid: uid,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
};

export const deleteGroupConversationMessageForAuthor = async ({
  conversationId,
  messageId,
  uid,
}: {
  conversationId: string;
  messageId: string;
  uid: string;
}) => {
  if (!conversationId) throw new Error("Missing conversation id.");
  if (!messageId) throw new Error("Missing message id.");
  if (!uid) throw new Error("Missing user id.");

  const messageRef = doc(
    db,
    "groupConversations",
    conversationId,
    "messages",
    messageId
  );
  const nowMs = Date.now();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(messageRef);

    if (!snap.exists()) throw new Error("Message not found.");

    const data = snap.data();

    if (data.senderUid !== uid) {
      throw new Error("You can only delete your own messages.");
    }

    if (data.hiddenByModeration === true) {
      throw new Error("This message was removed by moderators.");
    }

    tx.update(messageRef, {
      deletedByAuthor: true,
      deletedAtMs: nowMs,
      body: "",
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });
  });
};

export const subscribeMyGroupConversations = (
  uid: string,
  onNext: (items: GroupConversationDoc[]) => void,
  onError?: (error: unknown) => void,
  groupId?: string
): Unsubscribe => {
  if (!uid) {
    onNext([]);
    return () => {};
  }

  if (!groupId) {
    const childUnsubscribes = new Map<string, Unsubscribe>();
    const itemsByGroup = new Map<string, GroupConversationDoc[]>();
    const emit = () => onNext(
      [...itemsByGroup.values()].flat()
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
        .slice(0, 50)
    );
    const membershipUnsubscribe = subscribeMyGroupMemberships(
      uid,
      (memberships) => {
        const activeGroupIds = new Set(
          memberships.map((membership) => membership.groupId)
        );
        for (const [subscribedGroupId, unsubscribe] of childUnsubscribes) {
          if (!activeGroupIds.has(subscribedGroupId)) {
            unsubscribe();
            childUnsubscribes.delete(subscribedGroupId);
            itemsByGroup.delete(subscribedGroupId);
          }
        }
        for (const activeGroupId of activeGroupIds) {
          if (childUnsubscribes.has(activeGroupId)) continue;
          childUnsubscribes.set(activeGroupId, subscribeMyGroupConversations(
            uid,
            (items) => {
              itemsByGroup.set(activeGroupId, items);
              emit();
            },
            onError,
            activeGroupId
          ));
        }
        emit();
      },
      onError
    );
    return () => {
      membershipUnsubscribe();
      childUnsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }

  const q = query(
    collection(db, "groupConversations"),
    where("groupId", "==", groupId),
    where("memberUids", "array-contains", uid),
    orderBy("updatedAtMs", "desc"),
    limit(50)
  );

  return onSnapshot(
    q,
    (snap) => {
      onNext(
        snap.docs
          .map((docSnap) =>
            mapGroupConversationDoc(docSnap.id, docSnap.data())
          )
          .filter((item) => item.archived !== true)
.filter((item) => item.archivedByUid?.[uid] !== true)
      );
    },
    (err) => {
      console.log("[Groups] subscribeMyGroupConversations failed", err);
      onError?.(err);
    }
  );
};

export const subscribeMyArchivedGroupConversations = (
  uid: string,
  onNext: (items: GroupConversationDoc[]) => void,
  onError?: (error: unknown) => void,
  groupId?: string
): Unsubscribe => {
  if (!uid) {
    onNext([]);
    return () => {};
  }

  if (!groupId) {
    const childUnsubscribes = new Map<string, Unsubscribe>();
    const itemsByGroup = new Map<string, GroupConversationDoc[]>();
    const emit = () => onNext(
      [...itemsByGroup.values()].flat()
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
        .slice(0, 50)
    );
    const membershipUnsubscribe = subscribeMyGroupMemberships(
      uid,
      (memberships) => {
        const activeGroupIds = new Set(
          memberships.map((membership) => membership.groupId)
        );
        for (const [subscribedGroupId, unsubscribe] of childUnsubscribes) {
          if (!activeGroupIds.has(subscribedGroupId)) {
            unsubscribe();
            childUnsubscribes.delete(subscribedGroupId);
            itemsByGroup.delete(subscribedGroupId);
          }
        }
        for (const activeGroupId of activeGroupIds) {
          if (childUnsubscribes.has(activeGroupId)) continue;
          childUnsubscribes.set(
            activeGroupId,
            subscribeMyArchivedGroupConversations(
              uid,
              (items) => {
                itemsByGroup.set(activeGroupId, items);
                emit();
              },
              onError,
              activeGroupId
            )
          );
        }
        emit();
      },
      onError
    );
    return () => {
      membershipUnsubscribe();
      childUnsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }

  const q = query(
    collection(db, "groupConversations"),
    where("groupId", "==", groupId),
    where("memberUids", "array-contains", uid),
    orderBy("updatedAtMs", "desc"),
    limit(50)
  );

  return onSnapshot(
    q,
    (snap) => {
      onNext(
        snap.docs
          .map((docSnap) =>
            mapGroupConversationDoc(docSnap.id, docSnap.data())
          )
          .filter(
  (item) =>
    item.archived === true ||
    item.archivedByUid?.[uid] === true
)
      );
    },
    (err) => {
      console.log(
        "[Groups] subscribeMyArchivedGroupConversations failed",
        err
      );
      onError?.(err);
    }
  );
};

export const subscribeGroupConversationMessages = (
  conversationId: string,
  onNext: (items: GroupConversationMessageDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!conversationId) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collection(db, "groupConversations", conversationId, "messages"),
    orderBy("createdAtMs", "asc"),
    limit(100)
  );

  return onSnapshot(
    q,
    (snap) => {
      onNext(
        snap.docs.map((docSnap) =>
          mapGroupConversationMessageDoc(docSnap.id, docSnap.data())
        )
      );
    },
    (err) => {
      console.log("[Groups] subscribeGroupConversationMessages failed", err);
      onError?.(err);
    }
  );
};

export const subscribeMyGroupDms = (
  uid: string,
  onNext: (items: GroupDmDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!uid) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collection(db, "groupDms"),
    where("participantUids", "array-contains", uid),
    orderBy("updatedAtMs", "desc"),
    limit(50)
  );

  return onSnapshot(
    q,
    (snap) => {
      onNext(
        snap.docs.map((docSnap) =>
          mapGroupDmDoc(docSnap.id, docSnap.data())
        )
      );
    },
    (err) => {
      console.log("[Groups] subscribeMyGroupDms failed", err);
      onError?.(err);
    }
  );
};

export const subscribeGroupDmMessages = (
  dmId: string,
  onNext: (items: GroupDmMessageDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!dmId) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collection(db, "groupDms", dmId, "messages"),
    orderBy("createdAtMs", "asc"),
    limit(100)
  );

  return onSnapshot(
    q,
    (snap) => {
      onNext(
        snap.docs.map((docSnap) =>
          mapGroupDmMessageDoc(docSnap.id, docSnap.data())
        )
      );
    },
    (err) => {
      console.log("[Groups] subscribeGroupDmMessages failed", err);
      onError?.(err);
    }
  );
};

const DM_TYPING_ACTIVE_WINDOW_MS = 8000;

export const upsertGroupDmTyping = async ({
  dmId,
  groupId,
  uid,
  displayName = null,
  email = null,
}: {
  dmId: string;
  groupId: string;
  uid: string;
  displayName?: string | null;
  email?: string | null;
}) => {
  if (!dmId) throw new Error("Missing DM id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!uid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  await setDoc(
    doc(db, "groupDms", dmId, "typing", uid),
    {
      uid,
      dmId,
      groupId,
      displayName,
      email,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const clearGroupDmTyping = async ({
  dmId,
  groupId,
  uid,
}: {
  dmId: string;
  groupId: string;
  uid: string;
}) => {
  if (!dmId) throw new Error("Missing DM id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!uid) throw new Error("Missing user id.");

await deleteDoc(doc(db, "groupDms", dmId, "typing", uid));
};

export const subscribeGroupDmTyping = (
  dmId: string,
  currentUid: string,
  onNext: (items: GroupDmTypingDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!dmId) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collection(db, "groupDms", dmId, "typing"),
    orderBy("updatedAtMs", "desc"),
    limit(10)
  );

  return onSnapshot(
    q,
    (snap) => {
      const nowMs = Date.now();

      const items = snap.docs
        .map((docSnap) => {
          const data = docSnap.data();

          return {
            uid: data.uid ?? docSnap.id,
            dmId: data.dmId ?? dmId,
            groupId: data.groupId ?? "",
            displayName: data.displayName ?? null,
            email: data.email ?? null,
            updatedAtMs:
              typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,
          } satisfies GroupDmTypingDoc;
        })
        .filter(
          (item) =>
            item.uid !== currentUid &&
            item.updatedAtMs > 0 &&
            nowMs - item.updatedAtMs <= DM_TYPING_ACTIVE_WINDOW_MS
        );

      onNext(items);
    },
    (err) => {
      console.log("[Groups] subscribeGroupDmTyping failed", err);
      onError?.(err);
    }
  );
};

export const subscribeGroupDmReactions = (
  dmId: string,
  messageId: string,
  onNext: (items: GroupDmReactionDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!dmId || !messageId) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collection(
      db,
      "groupDms",
      dmId,
      "messages",
      messageId,
      "reactions"
    ),
    orderBy("createdAtMs", "asc")
  );

  return onSnapshot(
    q,
    (snap) => {
      onNext(
        snap.docs.map((docSnap) => {
          const data = docSnap.data();

          return {
            uid: data.uid ?? docSnap.id,
            dmId: data.dmId ?? dmId,
            messageId: data.messageId ?? messageId,
            emoji: data.emoji ?? "👍",
            displayName: data.displayName ?? null,
            email: data.email ?? null,
            createdAtMs: data.createdAtMs ?? 0,
            updatedAtMs: data.updatedAtMs ?? 0,
          };
        })
      );
    },
    (err) => {
      console.log("[Groups] subscribeGroupDmReactions failed", err);
      onError?.(err);
    }
  );
};

export const toggleGroupDmReaction = async ({
  dmId,
  messageId,
  uid,
  emoji,
  displayName = null,
  email = null,
}: {
  dmId: string;
  messageId: string;
  uid: string;
  emoji: GroupDmReactionEmoji;
  displayName?: string | null;
  email?: string | null;
}) => {
  const reactionRef = doc(
    db,
    "groupDms",
    dmId,
    "messages",
    messageId,
    "reactions",
    `${uid}_${emoji}`
  );

  const snap = await getDoc(reactionRef);

  if (snap.exists()) {
    await deleteDoc(reactionRef);
    return;
  }

  const nowMs = Date.now();

  await setDoc(reactionRef, {
    uid,
    dmId,
    messageId,
    emoji,
    displayName,
    email,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const getDiscoverableGroupPreview = async (
  groupId: string
): Promise<GroupDiscoverySummary | null> => {
  if (!groupId) {
    throw new Error("Missing group id.");
  }

  const groupRef = doc(db, "groups", groupId);
  const snap = await getDoc(groupRef);

  if (!snap.exists()) {
    return null;
  }

  const summary = toGroupDiscoverySummary(snap.id, {
    id: snap.id,
    ...(snap.data() as Omit<GroupDoc, "id">),
  });

  return summary;
};

export const GROUP_CONVERSATION_REACTION_EMOJIS = [
  "👍",
  "❤️",
  "🎉",
  "👀",
] as const;

export type GroupConversationReactionEmoji =
  (typeof GROUP_CONVERSATION_REACTION_EMOJIS)[number];

export type GroupConversationReactionDoc = {
  uid: string;
  conversationId: string;
  messageId: string;
  emoji: GroupConversationReactionEmoji;
  displayName?: string | null;
  email?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type GroupConversationTypingDoc = {
  uid: string;
  conversationId: string;
  groupId: string;
  displayName?: string | null;
  email?: string | null;
  updatedAtMs: number;
};

export type GroupConversationMuteDoc = {
  conversationId: string;
  groupId: string;
  uid: string;
  muted: boolean;
  updatedAtMs: number;
};

export type GroupThreadUnreadState = {
  isUnread: boolean;
  lastReadAtMs: number;
  lastMessageAtMs: number;
};

export type GroupConversationDoc = {
  id: string;
  groupId: string;

  title: string;
  subject?: string | null;

  memberUids: string[];
  memberMap: Record<string, true>;

  createdByUid: string;
  createdAtMs: number;
  updatedAtMs: number;

  lastMessagePreview?: string | null;
  lastMessageAtMs?: number | null;
  lastMessageSenderUid?: string | null;
    lastReadByUid?: Record<string, number | null>;

  archived?: boolean;
archivedByUid?: Record<string, boolean | null>;
archivedAtMsByUid?: Record<string, number | null>;
};

export type GroupMessageReplyPreview = {
  messageId: string;
  senderUid?: string | null;
  senderName?: string | null;
  bodyPreview: string;
};

export type GroupConversationMessageDoc = {
  id: string;
  conversationId: string;
  groupId: string;

  body: string;
  senderUid: string;
  senderName?: string | null;
  senderEmail?: string | null;

    replyTo?: GroupMessageReplyPreview | null;

    editedAtMs?: number | null;
editedByUid?: string | null;

  createdAtMs: number;
  updatedAtMs: number;

  hiddenByModeration?: boolean;

    deletedByAuthor?: boolean;
  deletedAtMs?: number | null;
  attachments: MediaAttachmentDoc[];
  attachmentCount: number;
};

export type GroupDmDoc = {
  id: string;
  groupId: string;

  participantUids: string[];
  participantMap: Record<string, true>;

    lastReadByUid?: Record<string, number | null>;

  participantNames?: Record<string, string | null>;
  participantEmails?: Record<string, string | null>;

  createdByUid: string;
  createdAtMs: number;
  updatedAtMs: number;

  lastMessagePreview?: string | null;
  lastMessageAtMs?: number | null;
  lastMessageSenderUid?: string | null;

  groupName?: string | null;
subject?: string | null;
};



export type GroupDmMessageDoc = {
  id: string;
  dmId: string;
  groupId: string;

  body: string;
  senderUid: string;
  senderName?: string | null;
  senderEmail?: string | null;

    replyTo?: GroupMessageReplyPreview | null;

    editedAtMs?: number | null;
editedByUid?: string | null;

  createdAtMs: number;
  updatedAtMs: number;

  hiddenByModeration?: boolean;

    deletedByAuthor?: boolean;
  deletedAtMs?: number | null;
  attachments: MediaAttachmentDoc[];
  attachmentCount: number;
};

export const getGroupThreadUnreadState = (
  thread: {
    lastReadByUid?: Record<string, number | null>;
    lastMessageAtMs?: number | null;
    lastMessageSenderUid?: string | null;
  },
  uid: string
): GroupThreadUnreadState => {
  const lastMessageAtMs =
    typeof thread.lastMessageAtMs === "number" ? thread.lastMessageAtMs : 0;

  const lastReadAtMs =
    typeof thread.lastReadByUid?.[uid] === "number"
      ? thread.lastReadByUid[uid] ?? 0
      : 0;

  return {
    lastReadAtMs,
    lastMessageAtMs,
    isUnread:
      !!uid &&
      lastMessageAtMs > 0 &&
      thread.lastMessageSenderUid !== uid &&
      lastMessageAtMs > lastReadAtMs,
  };
};

export type GroupDmReactionDoc = {
  uid: string;

  dmId: string;
  messageId: string;

  emoji: GroupDmReactionEmoji;

  displayName?: string | null;
  email?: string | null;

  createdAtMs: number;
  updatedAtMs: number;
};

export type GroupMemberDoc = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  role: GroupRole;
  status: GroupMemberStatus;
  joinedAtMs: number;
  invitedByUid?: string | null;
  groupName?: string | null;
};

export type GroupBulletinDoc = {
  id: string;
  groupId: string;

  title: string;
  body: string;

  authorUid: string;
  authorName?: string | null;
  authorEmail?: string | null;

  createdAtMs: number;
  updatedAtMs: number;

  hiddenByModeration?: boolean;
  hiddenAtMs?: number | null;
  hiddenByUid?: string | null;
  hiddenByName?: string | null;
  hiddenReason?: string | null;
  hiddenReportId?: string | null;
  deletedByAuthor: boolean;
  deletedAtMs: number | null;
  attachments: MediaAttachmentDoc[];
  imageUrls?: string[];
  videoUrls?: string[];
  attachmentCount: number;
};

export type GroupBulletinCommentDoc = {
  id: string;
  groupId: string;
  bulletinId: string;

  body: string;

  authorUid: string;
  authorName?: string | null;
  authorEmail?: string | null;

  createdAtMs: number;
  updatedAtMs: number | null;

  hiddenByModeration?: boolean;
  hiddenAtMs?: number | null;
  hiddenByUid?: string | null;
  hiddenByName?: string | null;
  hiddenReason?: string | null;
  hiddenReportId?: string | null;
  attachments: MediaAttachmentDoc[];
  attachmentCount: number;
};

export type CreateGroupBulletinInput = {
  groupId: string;
  title: string;
  body: string;
  authorUid: string;
  authorName?: string | null;
  authorEmail?: string | null;
  attachments: MediaAttachmentDoc[];
   bulletinId?: string | null;
};

export type GroupPresenceStatus = "online" | "recent" | "offline";

export type GroupPresenceDoc = {
  uid: string;
  groupId: string;
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
  status: GroupPresenceStatus;
  activeRoute?: string | null;
  activeGoalId?: string | null;
  activeGoalTitle?: string | null;
  lastSeenAtMs: number;
  updatedAtMs: number;
};

export type GroupMemberReadStateDoc = {
  uid: string;
  groupId: string;
  lastViewedActivityAtMs?: number | null;
  lastViewedCommentsAtMs?: number | null;
  lastViewedAssignmentsAtMs?: number | null;
  updatedAtMs: number;
};

export type GroupGoalTypingDoc = {
  uid: string;
  groupId: string;
  goalId: string;
  displayName?: string | null;
  email?: string | null;
  updatedAtMs: number;
};

export type GroupGoalCommentReactionDoc = {
  uid: string;
  groupId: string;
  goalId: string;
  commentId: string;
  emoji: string;
  displayName?: string | null;
  email?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type GroupTaskStatus =
  | "unclaimed"
  | "claimed"
  | "in_progress"
  | "completed";

export type GroupTaskPriority = "low" | "medium" | "high";

export type GroupTaskDoc = {
  id: string;
  groupId: string;
  title: string;
  description?: string | null;
  status: GroupTaskStatus;
  priority?: GroupTaskPriority | null;

  createdByUid: string;
  createdByName?: string | null;
  createdByEmail?: string | null;

  claimedByUid?: string | null;
  claimedByName?: string | null;
  claimedByEmail?: string | null;
  claimedAtMs?: number | null;

  assignedToUid?: string | null;
  assignedToName?: string | null;
  assignedToEmail?: string | null;
  assignedAtMs?: number | null;

  dueAtMs?: number | null;

  linkedGoalId?: string | null;
  linkedGoalTitle?: string | null;
  linkedSubtaskId?: string | null;
  linkedSubtaskTitle?: string | null;

  completedByUid?: string | null;
  completedByName?: string | null;
  completedAtMs?: number | null;

  createdAtMs: number;
  updatedAtMs: number;
  hiddenByModeration?: boolean;
hiddenAtMs?: number | null;
hiddenByUid?: string | null;
hiddenByName?: string | null;
hiddenReason?: string | null;
hiddenReportId?: string | null;
};

export type GroupInboxItemType =
  | "assignment"
  | "comment"
  | "activity"
  | "dm"
  | "conversation"
  | "planner";



export type GroupInboxItemDoc = {
  id: string;
  uid: string;
  groupId: string;
  type: GroupInboxItemType;
  title: string;
  body?: string | null;
    dmId?: string | null;
  goalId?: string | null;
  goalTitle?: string | null;
  subtaskId?: string | null;
  subtaskTitle?: string | null;
  boardId?: string | null;
  boardTitle?: string | null;
  cardId?: string | null;
  cardTitle?: string | null;
  actorUid?: string | null;
  actorName?: string | null;
  readAtMs?: number | null;
  createdAtMs: number;
  updatedAtMs: number;
  reportId?: string | null;
moderation?: boolean;
joinRequest?: boolean;
joinRequestUid?: string | null;
  groupKey?: string | null;
relatedEntityType?: "goal" | "task" | "group" | "dm" | "planning_board" |
  "routine_occurrence" | "planner" | null;
relatedEntityId?: string | null;
idempotencyKey?: string | null;
deepLink?: string | null;
transitionEventId?: string | null;
trustedRoutine?: boolean;
trustedPlanner?: boolean;
suggestionCount?: number;
};

export type CreateGroupInput = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  name: string;
  description?: string | null;
  visibility?: GroupVisibility;
  discoverable?: boolean;
  joinPolicy?: GroupJoinPolicy;
  category?: GroupDiscoveryCategory;
  tags?: string[];
  summary?: string | null;
};

export type GroupJoinRequestStatus =
  | "pending"
  | "approved"
  | "declined"
  | "cancelled";

export type GroupJoinRequestDoc = {
  id: string;
  groupId: string;

  groupName?: string | null;

  uid: string;
  email?: string | null;
  displayName?: string | null;

  status: GroupJoinRequestStatus;
  message?: string | null;

  createdAtMs: number;
  updatedAtMs: number;

  reviewedByUid?: string | null;
  reviewedByName?: string | null;
  reviewedAtMs?: number | null;
};



export type GroupInviteStatus = "pending" | "accepted" | "declined" | "expired";

export type GroupInviteDoc = {
  id: string;
  groupId: string;
  groupName: string;
  invitedEmail: string;
  invitedByUid: string;
  invitedByName?: string | null;
  role: AssignableGroupRole;
  status: GroupInviteStatus;
  createdAtMs: number;
  expiresAtMs?: number | null;
};

export type GroupActivityType =
  | "goal_shared"
    | "member_left"
  | "invite_created"
  | "comment_created"
  | "invite_accepted"
  | "invite_declined"
  | "member_removed"
  | "member_role_changed"
  | "subtask_completed"
  | "task_assigned"
  | "task_unassigned"
  | "planning_board_card_assigned"
  | "planning_board_card_reassigned"
  | "planning_board_card_unassigned"
  | "occurrence_completed"
  | "occurrence_skipped"
  | "occurrence_reopened"
  | "note_created";

  export const GROUP_ACTIVITY_REACTION_EMOJIS = ["👍", "🎉", "👀"] as const;
  export const GROUP_DM_REACTION_EMOJIS = [
  "👍",
  "❤️",
  "🎉",
  "👀",
] as const;

export type GroupDmReactionEmoji =
  (typeof GROUP_DM_REACTION_EMOJIS)[number];

export type GroupActivityReactionEmoji =
  (typeof GROUP_ACTIVITY_REACTION_EMOJIS)[number];

export type GroupActivityReactionDoc = {
  uid: string;
  groupId: string;
  activityId: string;
  emoji: GroupActivityReactionEmoji;
  displayName?: string | null;
  email?: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};


export type GroupActivityDoc = {
  id: string;
  groupId: string;
  type: GroupActivityType;
  actorUid: string;
  actorName?: string | null;
  actorEmail?: string | null;
  message: string;
  goalId?: string | null;
  goalTitle?: string | null;
  targetUid?: string | null;
  targetEmail?: string | null;
  createdAtMs: number;
  taskId?: string | null;
taskTitle?: string | null;
boardId?: string | null;
boardTitle?: string | null;
cardId?: string | null;
cardTitle?: string | null;
previousAssignedToUid?: string | null;
previousAssignedToName?: string | null;
previousAssignedToEmail?: string | null;
assignedToUid?: string | null;
assignedToName?: string | null;
assignedToEmail?: string | null;
hiddenByModeration?: boolean;
hiddenAtMs?: number | null;
hiddenByUid?: string | null;
hiddenByName?: string | null;
hiddenReason?: string | null;
hiddenReportId?: string | null;
};

export type GroupAdminLogAction =
  | "member_removed"
  | "member_role_changed"
  | "invite_created"
  | "invite_revoked"
  | "group_settings_updated"
  | "user_unblocked"
  | "routine_participant_status_corrected"
  | "routine_participant_excused"
    | "content_restored"
  | "content_removed";


export type GroupAdminLogDoc = {
  id: string;
  groupId: string;
  action: GroupAdminLogAction;


  actorUid: string;
  actorName?: string | null;
  actorEmail?: string | null;

  targetUid?: string | null;
  targetEmail?: string | null;
  targetName?: string | null;

  message: string;
  metadata?: Record<string, unknown> | null;

  createdAtMs: number;
};

export type GroupTaskCommentDoc = {
  id: string;
  groupId: string;
  taskId: string;
  body: string;
  authorUid: string;
  authorName?: string | null;
  createdAtMs: number;
  updatedAtMs?: number | null;
  hiddenByModeration?: boolean;
  hiddenAtMs?: number | null;
  hiddenByUid?: string | null;
  hiddenByName?: string | null;
  hiddenReason?: string | null;
  hiddenReportId?: string | null;
};

export type GroupGoalCommentDoc = {
  id: string;
  groupId: string;
  goalId: string;
  body: string;
  authorUid: string;
  authorName?: string | null;
  createdAtMs: number;
  updatedAtMs?: number | null;
  hiddenByModeration?: boolean;
hiddenAtMs?: number | null;
hiddenByUid?: string | null;
hiddenByName?: string | null;
hiddenReason?: string | null;
hiddenReportId?: string | null;
attachments: MediaAttachmentDoc[];
attachmentCount: number;
};

export type SharedGoalLinkDoc = {
  goalId: string;
  groupId: string;
  ownerUserId: string;
  sharedByUid: string;
  status: "active" | "removed";
  sharedAtMs: number;
  updatedAtMs: number;
};

export type GroupNotificationCategory =
  | "assignments"
  | "comments"
  | "reactions"
  | "activity"
  | "celebrations"
  | "mentions";

export type GroupNotificationCategoryPreferences = Record<
  GroupNotificationCategory,
  boolean
>;

export type GroupNotificationPreferences = {
  muted: boolean;
  categories: GroupNotificationCategoryPreferences;
  mutedTaskIds: string[];
  updatedAtMs?: number;
};

export type GroupReportTargetType = 
  | "goal_comment"
  | "task_comment"
  | "activity"
  | "bulletin"
  | "bulletin_comment"
  | "task"
   | "dm_message"
    | "conversation_message";

export type GroupReportReason =
  | "spam"
  | "harassment"
  | "inappropriate"
  | "misleading"
  | "other";

export type GroupReportStatus =
  | "open"
  | "reviewing"
  | "resolved"
  | "dismissed";

export type GroupReportDoc = {
  id: string;
  groupId: string;

  targetType: GroupReportTargetType;
  targetId: string;

  goalId?: string | null;
  taskId?: string | null;
  commentId?: string | null;
  activityId?: string | null;
  bulletinId?: string | null;
    dmId?: string | null;
      conversationId?: string | null;

  reason: GroupReportReason;
  note?: string | null;

  status: GroupReportStatus;

  reporterUid: string;
  reporterName?: string | null;
  reporterEmail?: string | null;

  reviewedByUid?: string | null;
  reviewedByName?: string | null;
  reviewedAtMs?: number | null;

  resolutionNote?: string | null;

  createdAtMs: number;
  updatedAtMs: number;
  targetAuthorUid?: string | null;
targetAuthorName?: string | null;
  moderatorNote?: string | null;
lastActionType?:
  | "reviewing"
  | "resolved"
  | "dismissed"
  | "hidden"
  | "restored"
  | null;

targetPreviewTitle?: string | null;
targetPreviewBody?: string | null;
};

export type ModerationTargetType =
  | "goal_comment"
  | "task_comment"
  | "activity"
  | "bulletin"
   | "bulletin_comment"
     | "dm_message"
       | "conversation_message"
  | "task";

export type HideModerationTargetInput = {
  groupId: string;
  targetType: ModerationTargetType;
  targetId: string;
  reportId?: string | null;

  hiddenByUid: string;
  hiddenByName?: string | null;
  reason?: string | null;

  dmId?: string | null;
    conversationId?: string | null;

  goalId?: string | null;
  taskId?: string | null;
  bulletinId?: string | null;
  targetPreviewTitle?: string | null;
targetPreviewBody?: string | null;
};

export type RestoreModerationTargetInput = {
  groupId: string;
  targetType: ModerationTargetType;
  targetId: string;
  reportId?: string | null;

  restoredByUid: string;
  restoredByName?: string | null;

  dmId?: string | null;
    conversationId?: string | null;

  goalId?: string | null;
  taskId?: string | null;
  bulletinId?: string | null;

  targetPreviewTitle?: string | null;
  targetPreviewBody?: string | null;
};

export const DEFAULT_GROUP_NOTIFICATION_CATEGORIES: GroupNotificationCategoryPreferences =
  {
    assignments: true,
    comments: true,
    reactions: true,
    activity: true,
    celebrations: true,
    mentions: true,
  };

export const DEFAULT_GROUP_NOTIFICATION_PREFERENCES: GroupNotificationPreferences =
  {
    muted: false,
    categories: DEFAULT_GROUP_NOTIFICATION_CATEGORIES,
    mutedTaskIds: [],
  };

export function normalizeGroupNotificationPreferences(
  raw: Partial<GroupNotificationPreferences> | null | undefined
): GroupNotificationPreferences {
  return {
    muted: raw?.muted === true,
    categories: {
      ...DEFAULT_GROUP_NOTIFICATION_CATEGORIES,
      ...(raw?.categories ?? {}),
    },
    mutedTaskIds: Array.isArray(raw?.mutedTaskIds)
      ? raw.mutedTaskIds.filter((id): id is string => typeof id === "string")
      : [],
    updatedAtMs:
      typeof raw?.updatedAtMs === "number" ? raw.updatedAtMs : undefined,
  };
}

function getModerationTargetRef({
  groupId,
  targetType,
  targetId,
  goalId,
  taskId,
  bulletinId,
   dmId,
   conversationId,
}: {
  groupId: string;
  targetType: ModerationTargetType;
  targetId: string;
  goalId?: string | null;
    dmId?: string | null;
      conversationId?: string | null;
  taskId?: string | null;
  bulletinId?: string | null;
}): DocumentReference {
  switch (targetType) {
    case "goal_comment": {
      if (!goalId) {
        throw new Error("Missing goalId for goal comment moderation.");
      }

      return doc(
        db,
        "goals",
        goalId,
        "comments",
        targetId
      );
    }

    case "task_comment": {
      if (!groupId || !taskId) {
        throw new Error("Missing taskId for task comment moderation.");
      }

      return doc(
        db,
        "groups",
        groupId,
        "taskComments",
        targetId
      );
    }

    case "activity": {
      return doc(
        db,
        "groups",
        groupId,
        "activity",
        targetId
      );
    }
        case "bulletin": {
      return doc(
        db,
        "groups",
        groupId,
        "bulletins",
        targetId
      );
    }

    case "bulletin_comment": {
      if (!bulletinId) {
        throw new Error("Missing bulletinId for bulletin comment moderation.");
      }

      return doc(
        db,
        "groups",
        groupId,
        "bulletins",
        bulletinId,
        "comments",
        targetId
      );
    }

    case "task": {
      return doc(
        db,
        "groups",
        groupId,
        "tasks",
        targetId
      );
    }

    default:
      if (targetType === "dm_message") {
  if (!dmId) {
    throw new Error("Missing DM id.");
  }

  return doc(db, "groupDms", dmId, "messages", targetId);
}
if (targetType === "conversation_message") {
  if (!conversationId) {
    throw new Error("Missing conversation id.");
  }

  return doc(
    db,
    "groupConversations",
    conversationId,
    "messages",
    targetId
  );
}
      throw new Error("Unsupported moderation target type.");
  }
}

export const hideModerationTarget = async ({
  groupId,
  targetType,
  targetId,
  reportId = null,
  hiddenByUid,
  hiddenByName = null,
  reason = null,
  goalId = null,
  taskId = null,
   dmId = null,
   conversationId = null,
   bulletinId = null,
   targetPreviewTitle = null,
  targetPreviewBody = null,
}: HideModerationTargetInput) => {
  if (!groupId) {
    throw new Error("Missing groupId.");
  }

  if (!targetId) {
    throw new Error("Missing targetId.");
  }

  if (!hiddenByUid) {
    throw new Error("Missing moderator uid.");
  }

  const targetRef = getModerationTargetRef({
    groupId,
    targetType,
    targetId,
    goalId,
    taskId,
      dmId,
       conversationId,
     bulletinId,
  });

  const nowMs = Date.now();

  await updateDoc(targetRef, {
    hiddenByModeration: true,
    hiddenAtMs: nowMs,
    hiddenByUid,
    hiddenByName,
    hiddenReason: reason,
    hiddenReportId: reportId,
  });
  await createGroupAdminLog({
  groupId,
  action: "content_removed",
  actorUid: hiddenByUid,
  actorName: hiddenByName ?? null,
  actorEmail: auth.currentUser?.email ?? null,
    message:
      targetType === "bulletin"
        ? `Hidden bulletin${targetPreviewTitle ? `: ${targetPreviewTitle}` : ""}`
        : targetType === "bulletin_comment"
        ? `Hidden bulletin comment${targetPreviewTitle ? `: ${targetPreviewTitle}` : ""}`
        : targetType === "dm_message"
        ? `Hidden DM message${targetPreviewTitle ? `: ${targetPreviewTitle}` : ""}`
        : targetType === "conversation_message"
        ? `Hidden conversation message${targetPreviewTitle ? `: ${targetPreviewTitle}` : ""}`
        : `Hidden reported content`,
  metadata: {
    targetType,
    targetId,
    reportId,
    goalId,
    taskId,
        conversationId,
    bulletinId,
    targetPreviewTitle,
    targetPreviewBody,
  },
});
  if (reportId) {
  const reportRef = doc(
    db,
    "groups",
    groupId,
    "reports",
    reportId
  );

  await updateDoc(reportRef, {
    status: "resolved",
    reviewedByUid: hiddenByUid,
    reviewedByName: hiddenByName ?? null,
    reviewedAtMs: nowMs,

    moderatorNote:
      reason?.trim()?.length
        ? reason.trim()
        : null,

    lastActionType: "hidden",

    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
}
};

export const restoreModerationTarget = async ({
  groupId,
  targetType,
  targetId,
  reportId = null,
  restoredByUid,
  restoredByName = null,
  goalId = null,
  taskId = null,
  bulletinId = null,
     conversationId = null,
  targetPreviewTitle = null,
   dmId = null,
  targetPreviewBody = null,
}: RestoreModerationTargetInput) => {
  if (!groupId) {
    throw new Error("Missing groupId.");
  }

  if (!targetId) {
    throw new Error("Missing targetId.");
  }

  if (!restoredByUid) {
    throw new Error("Missing moderator uid.");
  }

  const targetRef = getModerationTargetRef({
    groupId,
    targetType,
    targetId,
          conversationId,
    goalId,
    taskId,
      dmId,
      
    bulletinId,
  });

  const nowMs = Date.now();

  await updateDoc(targetRef, {
    hiddenByModeration: false,
    restoredAtMs: nowMs,
    restoredByUid,
    restoredByName,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });

  await createGroupAdminLog({
    groupId,
    action: "content_restored",
    actorUid: restoredByUid,
    actorName: restoredByName ?? null,
    actorEmail: auth.currentUser?.email ?? null,
    message:
      targetType === "bulletin"
        ? `Restored bulletin${targetPreviewTitle ? `: ${targetPreviewTitle}` : ""}`
        : targetType === "bulletin_comment"
        ? `Restored bulletin comment${targetPreviewTitle ? `: ${targetPreviewTitle}` : ""}`
        : targetType === "dm_message"
        ? `Restored DM message${targetPreviewTitle ? `: ${targetPreviewTitle}` : ""}`
        : targetType === "conversation_message"
        ? `Restored conversation message${targetPreviewTitle ? `: ${targetPreviewTitle}` : ""}`
        : "Restored reported content",
    metadata: {
      targetType,
      targetId,
      reportId,
      goalId,
      taskId,
      conversationId,
      bulletinId,
      targetPreviewTitle,
      targetPreviewBody,
    },
  });

  if (reportId) {
    const reportRef = doc(
      db,
      "groups",
      groupId,
      "reports",
      reportId
    );

    await updateDoc(reportRef, {
      status: "reviewing",
      reviewedByUid: restoredByUid,
      reviewedByName: restoredByName ?? null,
      reviewedAtMs: nowMs,
      moderatorNote: "Content restored by moderator.",
      lastActionType: "restored",
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });
  }
};

export const subscribeGroupNotificationPreferences = (
  uid: string,
  groupId: string,
  onNext: (preferences: GroupNotificationPreferences) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!uid || !groupId) {
    onNext(DEFAULT_GROUP_NOTIFICATION_PREFERENCES);
    return () => {};
  }

  const ref = doc(db, "users", uid, "groupNotificationPreferences", groupId);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onNext(DEFAULT_GROUP_NOTIFICATION_PREFERENCES);
        return;
      }

      onNext(normalizeGroupNotificationPreferences(snap.data()));
    },
    (err) => {
      console.log("[Groups] subscribeGroupNotificationPreferences failed", err);
      onError?.(err);
    }
  );
};

export const updateGroupNotificationPreferences = async (params: {
  uid: string;
  groupId: string;
  patch: Partial<GroupNotificationPreferences>;
}) => {
  if (!params.uid) throw new Error("Missing user id.");
  if (!params.groupId) throw new Error("Missing group id.");

  const nowMs = Date.now();

  const ref = doc(
    db,
    "users",
    params.uid,
    "groupNotificationPreferences",
    params.groupId
  );

  await setDoc(
    ref,
    {
      ...params.patch,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const setGroupNotificationsMuted = async (params: {
  uid: string;
  groupId: string;
  muted: boolean;
}) => {
  await updateGroupNotificationPreferences({
    uid: params.uid,
    groupId: params.groupId,
    patch: {
      muted: params.muted,
    },
  });
};

export const setGroupNotificationCategoryEnabled = async (params: {
  uid: string;
  groupId: string;
  category: GroupNotificationCategory;
  enabled: boolean;
}) => {
  if (!params.uid) throw new Error("Missing user id.");
  if (!params.groupId) throw new Error("Missing group id.");

  const nowMs = Date.now();

  const ref = doc(
    db,
    "users",
    params.uid,
    "groupNotificationPreferences",
    params.groupId
  );

  await setDoc(
    ref,
    {
      categories: {
        [params.category]: params.enabled,
      },
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const setGroupTaskNotificationsMuted = async (params: {
  uid: string;
  groupId: string;
  taskId: string;
  muted: boolean;
}) => {
  if (!params.uid) throw new Error("Missing user id.");
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.taskId) throw new Error("Missing task id.");

  const ref = doc(
    db,
    "users",
    params.uid,
    "groupNotificationPreferences",
    params.groupId
  );

  const snap = await getDoc(ref);
  const current = normalizeGroupNotificationPreferences(
    snap.exists() ? snap.data() : null
  );

  const mutedTaskIds = params.muted
    ? Array.from(new Set([...current.mutedTaskIds, params.taskId]))
    : current.mutedTaskIds.filter((id) => id !== params.taskId);

  await updateGroupNotificationPreferences({
    uid: params.uid,
    groupId: params.groupId,
    patch: {
      mutedTaskIds,
    },
  });
};

export const isGroupNotificationsMuted = (
  preferences: GroupNotificationPreferences | null | undefined
): boolean => {
  return normalizeGroupNotificationPreferences(preferences).muted === true;
};

export const isGroupTaskNotificationsMuted = (
  preferences: GroupNotificationPreferences | null | undefined,
  taskId?: string | null
): boolean => {
  if (!taskId) return false;

  return normalizeGroupNotificationPreferences(preferences).mutedTaskIds.includes(
    taskId
  );
};

export const isGroupNotificationCategoryEnabled = (
  preferences: GroupNotificationPreferences | null | undefined,
  category: GroupNotificationCategory
): boolean => {
  return normalizeGroupNotificationPreferences(preferences).categories[category] === true;
};

export const shouldCreateGroupNotification = (params: {
  preferences: GroupNotificationPreferences | null | undefined;
  category: GroupNotificationCategory;
  taskId?: string | null;
}): boolean => {
  const normalized = normalizeGroupNotificationPreferences(params.preferences);

  if (normalized.muted) return false;

  if (params.taskId && normalized.mutedTaskIds.includes(params.taskId)) {
    return false;
  }

  return normalized.categories[params.category] === true;
};

const shouldCreateGroupNotificationForUser = async (params: {
  uid: string;
  groupId: string;
  category: GroupNotificationCategory;
  taskId?: string | null;
}): Promise<boolean> => {
  if (!params.uid) return false;
  if (!params.groupId) return false;

  try {
    const preferenceRef = doc(
      db,
      "users",
      params.uid,
      "groupNotificationPreferences",
      params.groupId
    );

    const preferenceSnap = await getDoc(preferenceRef);

    const preferences = normalizeGroupNotificationPreferences(
      preferenceSnap.exists() ? preferenceSnap.data() : null
    );

    return shouldCreateGroupNotification({
      preferences,
      category: params.category,
      taskId: params.taskId ?? null,
    });
  } catch (err) {
    console.log(
      "[Groups] notification preference check failed; allowing notification",
      err
    );

    return true;
  }
};

const HERE_MENTION_REGEX = /(^|\s)@here(\s|$|[.,!?;:])/i;

const bodyHasHereMention = (body: string): boolean => {
  return HERE_MENTION_REGEX.test(body);
};

const normalizeMentionToken = (value: string): string => {
  return value
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "");
};

const getMentionTokenForText = (value?: string | null): string => {
  if (!value) return "";

  return normalizeMentionToken(value.split("@")[0] ?? value);
};

const extractMentionTokens = (body: string): string[] => {
  if (!body.trim()) return [];

  const matches = body.match(/(^|\s)@([a-zA-Z0-9._-]+)/g) ?? [];

  return Array.from(
    new Set(
      matches
        .map((match) => normalizeMentionToken(match))
        .filter((token) => token.length >= 2)
    )
  );
};

const getMemberMentionCandidates = (member: GroupMemberDoc): string[] => {
  return Array.from(
    new Set(
      [
        member.displayName,
        member.email,
        member.email?.split("@")[0] ?? null,
        member.uid,
      ]
        .map(getMentionTokenForText)
        .filter((token) => token.length >= 2)
    )
  );
};

const getActiveGroupMembers = async (
  groupId: string
): Promise<GroupMemberDoc[]> => {
  const membersSnap = await getDocs(
    query(
      collection(db, "groups", groupId, "members"),
      where("status", "==", "active")
    )
  );

  return membersSnap.docs.map((docSnap) => {
    const data = docSnap.data();

    return {
      uid: data.uid ?? docSnap.id,
      email: data.email ?? null,
      displayName: data.displayName ?? null,
      role: data.role ?? "member",
      status: data.status ?? "active",
      joinedAtMs: data.joinedAtMs ?? 0,
    };
  });
};

const resolveMentionedGroupMembers = async (params: {
  groupId: string;
  body: string;
  authorUid: string;
}): Promise<GroupMemberDoc[]> => {
  const mentionTokens = extractMentionTokens(params.body);

  if (mentionTokens.length === 0) {
    return [];
  }

  const membersSnap = await getDocs(
    query(
      collection(db, "groups", params.groupId, "members"),
      where("status", "==", "active")
    )
  );

  const members = membersSnap.docs
    .map((docSnap) => {
      const data = docSnap.data();

      return {
        uid: data.uid ?? docSnap.id,
        email: data.email ?? null,
        displayName: data.displayName ?? null,
        role: data.role ?? "member",
        status: data.status ?? "active",
        joinedAtMs: data.joinedAtMs ?? 0,
        invitedByUid: data.invitedByUid ?? null,
      } satisfies GroupMemberDoc;
    })
    .filter((member) => member.uid !== params.authorUid);

  return members.filter((member) => {
    const candidates = getMemberMentionCandidates(member);

    return mentionTokens.some((token) =>
      candidates.some((candidate) => candidate === token)
    );
  });
  
};




const createMentionInboxItemsForComment = async (params: {
  groupId: string;
  body: string;
  actorUid: string;
  actorName?: string | null;
  goalId?: string | null;
  goalTitle?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
}) => {
  const mentionedMembers = await resolveMentionedGroupMembers({
    groupId: params.groupId,
    body: params.body,
    authorUid: params.actorUid,
  });

 

  await Promise.all(
    mentionedMembers.map(async (member) => {
      const shouldNotify = await shouldCreateGroupNotificationForUser({
        uid: member.uid,
        groupId: params.groupId,
        category: "mentions",
        taskId: params.taskId ?? null,
      });

      

      if (!shouldNotify) return;

const dedupeWindowMs = 2 * 60 * 1000;
const dedupeSinceMs = Date.now() - dedupeWindowMs;

const existingMentionSnap = await getDocs(
  query(
    collection(db, "mentionNotificationRequests"),
    where("targetUid", "==", member.uid),
    where("actorUid", "==", params.actorUid),
    where("groupId", "==", params.groupId),
    where("status", "in", ["queued", "processing", "sent"]),
    where("createdAtMs", ">=", dedupeSinceMs),
    limit(1)
  )
);

const alreadyRecentlyMentioned = !existingMentionSnap.empty;

      try {
const mentionPreview =
  params.body.trim().length > 200
    ? `${params.body.trim().slice(0, 197)}...`
    : params.body.trim();
        await createGroupInboxItem({
          uid: member.uid,
          groupId: params.groupId,
          type: "comment",
          title: "You were mentioned",
         body: `${params.actorName ?? "Someone"}: ${mentionPreview}`,
          goalId: params.goalId ?? null,
          goalTitle: params.goalTitle ?? null,
          subtaskId: params.taskId ?? null,
          subtaskTitle: params.taskTitle ?? null,
          actorUid: params.actorUid,
          
          actorName: params.actorName ?? null,
          idempotencyKey: `mention_${params.groupId}_${params.taskId ?? params.goalId ?? "group"}_${member.uid}_${params.actorUid}_${normalizeMentionToken(params.body).slice(0, 40)}`,
          groupKey: params.taskId
  ? `task:${params.taskId}:mentions`
  : params.goalId
  ? `goal:${params.goalId}:mentions`
  : `group:${params.groupId}:mentions`,

relatedEntityType: params.taskId
  ? "task"
  : params.goalId
  ? "goal"
  : "group",

relatedEntityId:
  params.taskId ?? params.goalId ?? params.groupId,
        });
if (!alreadyRecentlyMentioned) {
  await createMentionNotificationRequest({
    groupId: params.groupId,
    targetUid: member.uid,
    targetName: member.displayName ?? member.email ?? null,
    actorUid: params.actorUid,
    actorName: params.actorName ?? null,
    body: params.body,
    goalId: params.goalId ?? null,
    goalTitle: params.goalTitle ?? null,
    taskId: params.taskId ?? null,
    taskTitle: params.taskTitle ?? null,
  });
}
        
      } catch (err) {
        console.log("[Groups] mention inbox item failed", err);
      }
    })
  );
};


const createCommentInboxItemsForGroupMembers = async (params: {
  groupId: string;
  actorUid: string;
  actorName?: string | null;
  goalId?: string | null;
  goalTitle?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
}) => {
  const membersSnap = await getDocs(
    query(
      collection(db, "groups", params.groupId, "members"),
      where("status", "==", "active")
    )
  );

  const recipients = membersSnap.docs
    .map((docSnap) => docSnap.data())
    .filter((member) => member.uid && member.uid !== params.actorUid);

  await Promise.all(
    recipients.map(async (member) => {
      const shouldNotify = await shouldCreateGroupNotificationForUser({
        uid: member.uid,
        groupId: params.groupId,
        category: "comments",
        taskId: params.taskId ?? null,
      });

      if (!shouldNotify) return;

      await createGroupInboxItem({
        uid: member.uid,
        groupId: params.groupId,
        type: "comment",
        title: "New group comment",
        body: `${params.actorName ?? "Someone"} commented on "${
          params.taskTitle ?? params.goalTitle ?? "a shared item"
        }".`,
        goalId: params.goalId ?? null,
        goalTitle: params.goalTitle ?? null,
        subtaskId: params.taskId ?? null,
        subtaskTitle: params.taskTitle ?? null,
        idempotencyKey: `comment_${params.groupId}_${params.taskId ?? params.goalId ?? "group"}_${member.uid}_${params.actorUid}_${Date.now()}`,
        actorUid: params.actorUid,
        actorName: params.actorName ?? null,
        groupKey: params.taskId
  ? `task:${params.taskId}:comments`
  : params.goalId
  ? `goal:${params.goalId}:comments`
  : `group:${params.groupId}:comments`,

relatedEntityType: params.taskId
  ? "task"
  : params.goalId
  ? "goal"
  : "group",

relatedEntityId:
  params.taskId ?? params.goalId ?? params.groupId,
      });
    })
  );
};

const formatReportReasonLabel = (reason: GroupReportReason): string => {
  switch (reason) {
    case "spam":
      return "Spam";
    case "harassment":
      return "Harassment";
    case "inappropriate":
      return "Inappropriate";
    case "misleading":
      return "Misleading";
    default:
      return "Other";
  }
};

const formatReportTargetTypeLabel = (
  targetType: GroupReportTargetType
): string => {
  switch (targetType) {
    case "goal_comment":
      return "Goal comment";
    case "task_comment":
      return "Task comment";
    case "activity":
      return "Activity";
    case "bulletin":
      return "Bulletin post";
    case "bulletin_comment":
      return "Bulletin comment";
    case "task":
      return "Shared task";
    default:
      return "Content";
  }
};

const createModerationInboxItems = async (params: {
  groupId: string;
  reportId: string;
  reporterUid: string;
  reporterName?: string | null;
  reason: GroupReportReason;
  targetType: GroupReportTargetType;
}) => {
  const membersSnap = await getDocs(
    query(
      collection(db, "groups", params.groupId, "members"),
      where("status", "==", "active")
    )
  );

  const recipients = membersSnap.docs
    .map((docSnap) => docSnap.data() as GroupMemberDoc)
    .filter(
      (member) =>
        member.uid &&
        member.uid !== params.reporterUid &&
        canModerateGroupContent(member.role)
    );

  await Promise.all(
    recipients.map((member) =>
      createGroupInboxItem({
        uid: member.uid,
        groupId: params.groupId,
        type: "activity",
        title: "New moderation report",
        reportId: params.reportId,
moderation: true,
        body: `Reason: ${formatReportReasonLabel(
          params.reason
        )} · ${formatReportTargetTypeLabel(params.targetType)}`,
        actorUid: params.reporterUid,
        actorName: params.reporterName ?? null,
        groupKey: `moderation:${params.groupId}:reports`,
        relatedEntityType: "group",
        relatedEntityId: params.groupId,
        idempotencyKey: `moderation_report_${params.reportId}_${member.uid}`,
      })
    )
  );
};

const createJoinRequestInboxItems = async (params: {
  groupId: string;
  requestUid: string;
  requesterName?: string | null;
  requesterEmail?: string | null;
}) => {
  const membersSnap = await getDocs(
    query(
      collection(db, "groups", params.groupId, "members"),
      where("status", "==", "active")
    )
  );

  const recipients = membersSnap.docs
    .map((docSnap) => docSnap.data() as GroupMemberDoc)
    .filter(
      (member) =>
        member.uid &&
        member.uid !== params.requestUid &&
        canManageGroupMembers(member.role)
    );

  await Promise.all(
    recipients.map((member) =>
      createGroupInboxItem({
        uid: member.uid,
        groupId: params.groupId,
        type: "activity",
        title: "New join request",
        body: `${params.requesterName ?? params.requesterEmail ?? "Someone"} requested to join this group.`,
        actorUid: params.requestUid,
        actorName: params.requesterName ?? params.requesterEmail ?? null,
        groupKey: `joinRequests:${params.groupId}`,
        relatedEntityType: "group",
        relatedEntityId: params.groupId,
        joinRequest: true,
        joinRequestUid: params.requestUid,
        idempotencyKey: `join_request_${params.groupId}_${params.requestUid}`,
      })
    )
  );
};

const mapGroupJoinRequestDoc = (
  docId: string,
  groupId: string,
  data: any
): GroupJoinRequestDoc => {
  return {
    id: docId,
    groupId: data.groupId ?? groupId,
    uid: data.uid ?? docId,
    email: data.email ?? null,
    displayName: data.displayName ?? null,
    status: data.status ?? "pending",
    message: data.message ?? null,
    groupName: data.groupName ?? null,
    createdAtMs:
      typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,
    reviewedByUid: data.reviewedByUid ?? null,
    reviewedByName: data.reviewedByName ?? null,
    reviewedAtMs:
      typeof data.reviewedAtMs === "number" ? data.reviewedAtMs : null,
  };
};





const normalizeInviteEmail = (email: string) => {
  return email.trim().toLowerCase();
};

const emailToDocSafeId = (email: string) => {
  return normalizeInviteEmail(email).replace(/[^a-z0-9]/g, "_");
};

const createGroupActivityTx = (
  tx: any,
  params: {
    groupId: string;
    type: GroupActivityType;
    actorUid: string;
    actorName?: string | null;
    message: string;
    goalId?: string | null;
    goalTitle?: string | null;
    targetUid?: string | null;
    targetEmail?: string | null;
    createdAtMs: number;
    taskId?: string | null;
taskTitle?: string | null;
  }
) => {
  const activityRef = doc(collection(db, "groups", params.groupId, "activity"));

  tx.set(activityRef, {
    groupId: params.groupId,
    type: params.type,
    actorUid: params.actorUid,
    actorName: params.actorName ?? null,
    message: params.message,
    goalId: params.goalId ?? null,
    goalTitle: params.goalTitle ?? null,
    targetUid: params.targetUid ?? null,
    targetEmail: params.targetEmail ?? null,
    createdAtMs: params.createdAtMs,
    createdAt: serverTimestamp(),
    taskId: params.taskId ?? null,
taskTitle: params.taskTitle ?? null,
  });
};

const createGroupAdminLogTx = (
  tx: Parameters<typeof runTransaction>[1] extends (
    tx: infer T
  ) => unknown
    ? T
    : never,
  {
    groupId,
    action,
    actorUid,
    actorName = null,
    actorEmail = null,
    targetUid = null,
    targetEmail = null,
    targetName = null,
    message,
    metadata = null,
    createdAtMs,
  }: Omit<GroupAdminLogDoc, "id">
) => {
  const logRef = doc(collection(db, "groups", groupId, "adminLogs"));

  tx.set(logRef, {
    groupId,
    action,
    actorUid,
    actorName,
    actorEmail,
    targetUid,
    targetEmail,
    targetName,
    message,
    metadata,
    createdAtMs,
    createdAt: serverTimestamp(),
  });
};

export const createGroupAdminLog = async ({
  groupId,
  action,
  actorUid,
  actorName = null,
  actorEmail = null,
  targetUid = null,
  targetEmail = null,
  targetName = null,
  message,
  metadata = null,
}: Omit<GroupAdminLogDoc, "id" | "createdAtMs">) => {
  if (!groupId) throw new Error("Missing group id.");
  if (!actorUid) throw new Error("Missing actor id.");
  if (!message.trim()) throw new Error("Missing admin log message.");

  const nowMs = Date.now();

  await addDoc(collection(db, "groups", groupId, "adminLogs"), {
    groupId,
    action,
    actorUid,
    actorName,
    actorEmail,
    targetUid,
    targetEmail,
    targetName,
    message: message.trim(),
    metadata,
    createdAtMs: nowMs,
    createdAt: serverTimestamp(),
  });
};

export const subscribeGroupAdminLogs = (
  groupId: string,
  onNext: (logs: GroupAdminLogDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!groupId) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collection(db, "groups", groupId, "adminLogs"),
    orderBy("createdAtMs", "desc"),
    limit(20)
  );

  return onSnapshot(
    q,
    (snap) => {
      const logs: GroupAdminLogDoc[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();

        logs.push({
          id: docSnap.id,
          groupId: data.groupId ?? groupId,
          action: data.action ?? "group_settings_updated",
          actorUid: data.actorUid ?? "",
          actorName: data.actorName ?? null,
          actorEmail: data.actorEmail ?? null,
          targetUid: data.targetUid ?? null,
          targetEmail: data.targetEmail ?? null,
          targetName: data.targetName ?? null,
          message: data.message ?? "Admin action recorded.",
          metadata: data.metadata ?? null,
          createdAtMs: data.createdAtMs ?? 0,
        });
      });

      onNext(logs);
    },
    (err) => {
      console.log("[Groups] subscribeGroupAdminLogs failed", err);
      onError?.(err);
    }
  );
};

const createAssignmentNotificationRequest = async (params: {
  groupId: string;
  goalId: string;
  goalTitle?: string | null;
  subtaskId: string;
  subtaskTitle?: string | null;
  assignedToUid: string;
  assignedToName?: string | null;
  assignedByUid: string;
  assignedByName?: string | null;
}) => {
  const nowMs = Date.now();

  const idempotencyKey = `assignment_${params.groupId}_${params.goalId}_${params.subtaskId}_${params.assignedToUid}`;

const requestRef = doc(
  db,
  "assignmentNotificationRequests",
  idempotencyKey
);

const existingSnap = await getDoc(requestRef);

if (existingSnap.exists()) {
  const existingStatus = existingSnap.data().status;

  if (
    existingStatus === "processing" ||
    existingStatus === "sent" ||
    existingStatus === "failed"
  ) {
    return;
  }
}

  await setDoc(requestRef, {
    groupId: params.groupId,
    goalId: params.goalId,
    goalTitle: params.goalTitle ?? null,
    subtaskId: params.subtaskId,
    subtaskTitle: params.subtaskTitle ?? null,
    targetUid: params.assignedToUid,
    targetName: params.assignedToName ?? null,
    actorUid: params.assignedByUid,
    actorName: params.assignedByName ?? null,
    status: "queued",
    idempotencyKey,
    type: "task_assigned",
    createdAtMs: nowMs,
    createdAt: serverTimestamp(),
  }, { merge: true });
};

export const createPlanningBoardCardAssignmentNotification = async (params: {
  groupId: string;
  boardId: string;
  boardTitle?: string | null;
  cardId: string;
  cardTitle: string;
  assignedToUid: string;
  assignedToName?: string | null;
  actorUid: string;
  actorName?: string | null;
  eventId: string;
}) => {
  if (!params.assignedToUid || params.assignedToUid === params.actorUid) return;

  const recipientRef = doc(
    db,
    "groups",
    params.groupId,
    "members",
    params.assignedToUid
  );
  const recipientSnap = await getDoc(recipientRef);
  if (!recipientSnap.exists() || recipientSnap.data().status !== "active") return;

  const shouldNotify = await shouldCreateGroupNotificationForUser({
    uid: params.assignedToUid,
    groupId: params.groupId,
    category: "assignments",
  });
  if (!shouldNotify) return;

  const boardTitle = params.boardTitle?.trim() || "Planning board";
  const cardTitle = params.cardTitle.trim() || "a board card";
  const actorName = params.actorName?.trim() || "A group coordinator";
  const idempotencyKey =
    `planning_board_assignment_${params.groupId}_${params.boardId}_` +
    `${params.cardId}_${params.assignedToUid}_${params.eventId}`;
  const body = `${actorName} assigned “${cardTitle}” to you on ${boardTitle}.`;

  try {
    await createGroupInboxItem({
      uid: params.assignedToUid,
      groupId: params.groupId,
      type: "assignment",
      title: "New board assignment",
      body,
      boardId: params.boardId,
      boardTitle,
      cardId: params.cardId,
      cardTitle,
      actorUid: params.actorUid,
      actorName,
      groupKey: `planning-board:${params.boardId}:assignments`,
      relatedEntityType: "planning_board",
      relatedEntityId: params.boardId,
      idempotencyKey,
    });
  } catch (error) {
    console.log("[Groups] planning board assignment inbox item failed", error);
  }

  try {
    const requestRef = doc(db, "assignmentNotificationRequests", idempotencyKey);
    const existingSnap = await getDoc(requestRef);
    if (
      existingSnap.exists() &&
      ["processing", "sent", "failed"].includes(existingSnap.data().status)
    ) {
      return;
    }

    await setDoc(
      requestRef,
      {
        groupId: params.groupId,
        boardId: params.boardId,
        boardTitle,
        cardId: params.cardId,
        cardTitle,
        targetUid: params.assignedToUid,
        targetName: params.assignedToName ?? null,
        actorUid: params.actorUid,
        actorName,
        status: "queued",
        idempotencyKey,
        type: "planning_board_card_assignment",
        createdAtMs: Date.now(),
        createdAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    console.log(
      "[Groups] planning board assignment notification request failed",
      error
    );
  }
};

const createMessageNotificationRequest = async (params: {
  groupId: string;
  targetUid: string;
  targetName?: string | null;
  actorUid: string;
  actorName?: string | null;
  title: string;
  body: string;
  type: "dm_message" | "conversation_message";
  dmId?: string | null;
  conversationId?: string | null;
  idempotencyKey: string;
}) => {
  const nowMs = Date.now();

  const requestRef = doc(
    db,
    "messageNotificationRequests",
    params.idempotencyKey
  );

  const existingSnap = await getDoc(requestRef);

  if (existingSnap.exists()) {
    const existingStatus = existingSnap.data().status;

    if (
      existingStatus === "processing" ||
      existingStatus === "sent" ||
      existingStatus === "failed"
    ) {
      return;
    }
  }

  await setDoc(
    requestRef,
    {
      groupId: params.groupId,
      targetUid: params.targetUid,
      targetName: params.targetName ?? null,
      actorUid: params.actorUid,
      actorName: params.actorName ?? null,
      title: params.title,
      body: params.body,
      type: params.type,
      dmId: params.dmId ?? null,
      conversationId: params.conversationId ?? null,
      status: "queued",
      idempotencyKey: params.idempotencyKey,
      createdAtMs: nowMs,
      createdAt: serverTimestamp(),
    },
    { merge: true }
  );
};

const notifyGroupMessageRecipient = async (params: {
  uid: string;
  groupId: string;

  inboxType: "dm" | "conversation";

  title: string;
  body: string;

  actorUid: string;
  actorName?: string | null;

  groupKey: string;

  relatedEntityType: "dm" | "group";
  relatedEntityId: string;

  notificationType: "dm_message" | "conversation_message";

  dmId?: string;
  conversationId?: string;

  idempotencyKey: string;
}) => {
  await createGroupInboxItem({
    uid: params.uid,
    groupId: params.groupId,
    type: params.inboxType,

    title: params.title,
    body: params.body,

    dmId: params.dmId,

    actorUid: params.actorUid,
    actorName: params.actorName ?? null,

    groupKey: params.groupKey,

    relatedEntityType: params.relatedEntityType,
    relatedEntityId: params.relatedEntityId,

    idempotencyKey: params.idempotencyKey,
  });

await createMessageNotificationRequest({
  groupId: params.groupId,

  targetUid: params.uid,

  actorUid: params.actorUid,
  actorName: params.actorName ?? null,

  title: params.title,
  body: params.body,

  type: params.notificationType,

  dmId: params.dmId,
  conversationId: params.conversationId,

  idempotencyKey: `${params.idempotencyKey}_push`,
}).catch((err) => {
  console.log("[Groups] message notification request failed", err);
});
};

const createMentionNotificationRequest = async (params: {
  groupId: string;
  targetUid: string;
  targetName?: string | null;
  actorUid: string;
  actorName?: string | null;
  body: string;
  goalId?: string | null;
  goalTitle?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
}) => {
  const nowMs = Date.now();

  const idempotencyKey = `mention_${params.groupId}_${params.taskId ?? params.goalId ?? "group"}_${params.targetUid}_${params.actorUid}_${nowMs}`;

const requestRef = doc(
  db,
  "mentionNotificationRequests",
  idempotencyKey
);

  const preview =
    params.body.length > 160 ? `${params.body.slice(0, 157)}...` : params.body;

    const existingSnap = await getDoc(requestRef);

if (existingSnap.exists()) {
  const existingStatus = existingSnap.data().status;

  if (
    existingStatus === "processing" ||
    existingStatus === "sent" ||
    existingStatus === "failed"
  ) {
    return;
  }
}

  await setDoc(requestRef, {
    groupId: params.groupId,
    targetUid: params.targetUid,
    targetName: params.targetName ?? null,
    actorUid: params.actorUid,
    actorName: params.actorName ?? null,
    bodyPreview: preview,
    goalId: params.goalId ?? null,
    idempotencyKey,
    goalTitle: params.goalTitle ?? null,
    taskId: params.taskId ?? null,
    taskTitle: params.taskTitle ?? null,
    status: "queued",
    type: "mention",
    createdAtMs: nowMs,
    createdAt: serverTimestamp(),
  }, { merge: true });
};

export const GROUP_PRESENCE_ONLINE_WINDOW_MS = 90 * 1000;
export const GROUP_PRESENCE_RECENT_WINDOW_MS = 10 * 60 * 1000;
export const GROUP_PRESENCE_HEARTBEAT_THROTTLE_MS = 45 * 1000;

const mapGroupPresenceDoc = (
  docId: string,
  groupId: string,
  data: any
): GroupPresenceDoc => {
  const nowMs = Date.now();

  const lastSeenAtMs =
    typeof data.lastSeenAtMs === "number" ? data.lastSeenAtMs : 0;

  let status: GroupPresenceStatus = "offline";

  if (nowMs - lastSeenAtMs <= GROUP_PRESENCE_ONLINE_WINDOW_MS) {
    status = "online";
  } else if (nowMs - lastSeenAtMs <= GROUP_PRESENCE_RECENT_WINDOW_MS) {
    status = "recent";
  }

  return {
    uid: data.uid ?? docId,
    groupId: data.groupId ?? groupId,
    displayName: data.displayName ?? null,
    email: data.email ?? null,
    photoURL: data.photoURL ?? null,
    status,
    activeRoute: data.activeRoute ?? null,
    activeGoalId: data.activeGoalId ?? null,
    activeGoalTitle: data.activeGoalTitle ?? null,
    lastSeenAtMs,
    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : lastSeenAtMs,
  };
};

const mapGroupGoalTypingDoc = (
  docId: string,
  groupId: string,
  goalId: string,
  data: any
): GroupGoalTypingDoc => {
  return {
    uid: data.uid ?? docId,
    groupId: data.groupId ?? groupId,
    goalId: data.goalId ?? goalId,
    displayName: data.displayName ?? null,
    email: data.email ?? null,
    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,
  };
};

const mapGroupMemberReadStateDoc = (
  docId: string,
  groupId: string,
  data: any
): GroupMemberReadStateDoc => {
  return {
    uid: data.uid ?? docId,
    groupId: data.groupId ?? groupId,
    lastViewedActivityAtMs:
      typeof data.lastViewedActivityAtMs === "number"
        ? data.lastViewedActivityAtMs
        : null,
    lastViewedCommentsAtMs:
      typeof data.lastViewedCommentsAtMs === "number"
        ? data.lastViewedCommentsAtMs
        : null,
    lastViewedAssignmentsAtMs:
      typeof data.lastViewedAssignmentsAtMs === "number"
        ? data.lastViewedAssignmentsAtMs
        : null,
    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,
  };
};

const mapGroupActivityReactionDoc = (
  docId: string,
  groupId: string,
  activityId: string,
  data: any
): GroupActivityReactionDoc => {
  const rawEmoji = data.emoji;

  const emoji: GroupActivityReactionEmoji =
    rawEmoji === "🎉" || rawEmoji === "👀" || rawEmoji === "👍"
      ? rawEmoji
      : "👍";

  return {
    uid: data.uid ?? docId,
    groupId: data.groupId ?? groupId,
    activityId: data.activityId ?? activityId,
    emoji,
    displayName: data.displayName ?? null,
    email: data.email ?? null,
    createdAtMs:
      typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,
  };
};

const mapGroupGoalCommentReactionDoc = (
  docId: string,
  groupId: string,
  goalId: string,
  commentId: string,
  data: any
): GroupGoalCommentReactionDoc => {
  return {
    uid: data.uid ?? docId,
    groupId: data.groupId ?? groupId,
    goalId: data.goalId ?? goalId,
    commentId: data.commentId ?? commentId,
    emoji: typeof data.emoji === "string" ? data.emoji : "👍",
    displayName: data.displayName ?? null,
    email: data.email ?? null,
    createdAtMs:
      typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,
  };
};

const mapGroupTaskDoc = (
  docId: string,
  groupId: string,
  data: any
): GroupTaskDoc => {
  const rawStatus = data.status;

  const status: GroupTaskStatus =
    rawStatus === "claimed" ||
    rawStatus === "in_progress" ||
    rawStatus === "completed" ||
    rawStatus === "unclaimed"
      ? rawStatus
      : "unclaimed";

  const rawPriority = data.priority;

  const priority: GroupTaskPriority | null =
    rawPriority === "low" ||
    rawPriority === "medium" ||
    rawPriority === "high"
      ? rawPriority
      : null;

  return {
    id: docId,
    groupId: data.groupId ?? groupId,
    title:
      typeof data.title === "string" && data.title.trim()
        ? data.title.trim()
        : "Untitled task",
    description: data.description ?? null,
    status,
    priority,

    createdByUid: data.createdByUid ?? "",
    createdByName: data.createdByName ?? null,
    createdByEmail: data.createdByEmail ?? null,

    claimedByUid: data.claimedByUid ?? null,
    claimedByName: data.claimedByName ?? null,
    claimedByEmail: data.claimedByEmail ?? null,
    claimedAtMs:
      typeof data.claimedAtMs === "number" ? data.claimedAtMs : null,

    assignedToUid: data.assignedToUid ?? null,
    assignedToName: data.assignedToName ?? null,
    assignedToEmail: data.assignedToEmail ?? null,
    assignedAtMs:
      typeof data.assignedAtMs === "number" ? data.assignedAtMs : null,

    dueAtMs: typeof data.dueAtMs === "number" ? data.dueAtMs : null,

    linkedGoalId: data.linkedGoalId ?? null,
    linkedGoalTitle: data.linkedGoalTitle ?? null,
    linkedSubtaskId: data.linkedSubtaskId ?? null,
    linkedSubtaskTitle: data.linkedSubtaskTitle ?? null,

    completedByUid: data.completedByUid ?? null,
    completedByName: data.completedByName ?? null,
    completedAtMs:
      typeof data.completedAtMs === "number" ? data.completedAtMs : null,

    createdAtMs:
      typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,
     hiddenByModeration: data.hiddenByModeration === true,
hiddenAtMs: typeof data.hiddenAtMs === "number" ? data.hiddenAtMs : null,
hiddenByUid: data.hiddenByUid ?? null,
hiddenByName: data.hiddenByName ?? null,
hiddenReason: data.hiddenReason ?? null,
hiddenReportId: data.hiddenReportId ?? null, 
  };
};

const mapGroupInboxItemDoc = (
  docId: string,
  data: any
): GroupInboxItemDoc => {
  return {
    id: docId,
    uid: data.uid ?? "",
    groupId: data.groupId ?? "",
type:
  data.type === "assignment" ||
  data.type === "comment" ||
  data.type === "activity" ||
  data.type === "dm" ||
  data.type === "conversation"
  || data.type === "planner"
    ? data.type
    : "activity",
    title: data.title ?? "Group update",
    dmId: data.dmId ?? null,
    body: data.body ?? null,
    goalId: data.goalId ?? null,
    goalTitle: data.goalTitle ?? null,
    subtaskId: data.subtaskId ?? null,
    subtaskTitle: data.subtaskTitle ?? null,
    boardId: data.boardId ?? null,
    boardTitle: data.boardTitle ?? null,
    cardId: data.cardId ?? null,
    cardTitle: data.cardTitle ?? null,
    actorUid: data.actorUid ?? null,
    actorName: data.actorName ?? null,
groupKey: data.groupKey ?? null,
relatedEntityType:
  data.relatedEntityType === "goal" ||
  data.relatedEntityType === "task" ||
  data.relatedEntityType === "group" ||
 data.relatedEntityType === "dm" ||
data.relatedEntityType === "bulletin"
  || data.relatedEntityType === "planning_board"
  || data.relatedEntityType === "routine_occurrence"
  || data.relatedEntityType === "planner"
    ? data.relatedEntityType
    : null,
relatedEntityId: data.relatedEntityId ?? null,
readAtMs:
      typeof data.readAtMs === "number" ? data.readAtMs : null,
    createdAtMs:
      typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,
idempotencyKey: data.idempotencyKey ?? null,
deepLink: data.deepLink ?? null,
transitionEventId: data.transitionEventId ?? null,
trustedRoutine: data.trustedRoutine === true,
trustedPlanner: data.trustedPlanner === true,
suggestionCount:
  typeof data.suggestionCount === "number" ? data.suggestionCount : undefined,
reportId: data.reportId ?? null,
moderation: data.moderation === true,
  };
};

export const upsertGroupPresence = async (params: {
  groupId: string;
  uid: string;
  displayName?: string | null;
  email?: string | null;
  photoURL?: string | null;
  activeRoute?: string | null;
  activeGoalId?: string | null;
  activeGoalTitle?: string | null;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.uid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  const presenceRef = doc(
    db,
    "groups",
    params.groupId,
    "presence",
    params.uid
  );

  await setDoc(
    presenceRef,
    {
      uid: params.uid,
      groupId: params.groupId,
      displayName: params.displayName ?? null,
      email: params.email ?? null,
      photoURL: params.photoURL ?? null,
      status: "online",
      activeRoute: params.activeRoute ?? null,
      activeGoalId: params.activeGoalId ?? null,
      activeGoalTitle: params.activeGoalTitle ?? null,
      lastSeenAtMs: nowMs,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const markGroupPresenceRecent = async (params: {
  groupId: string;
  uid: string;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.uid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  const presenceRef = doc(
    db,
    "groups",
    params.groupId,
    "presence",
    params.uid
  );

  await setDoc(
    presenceRef,
    {
      uid: params.uid,
      groupId: params.groupId,
      status: "recent",
      activeRoute: null,
      activeGoalId: null,
      activeGoalTitle: null,
      lastSeenAtMs: nowMs,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const subscribeGroupPresence = (
  groupId: string,
  onNext: (presence: GroupPresenceDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(db, "groups", groupId, "presence"),
    orderBy("lastSeenAtMs", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const presence: GroupPresenceDoc[] = [];

      snap.forEach((docSnap) => {
        presence.push(
          mapGroupPresenceDoc(docSnap.id, groupId, docSnap.data())
        );
      });

      onNext(
        presence
          .filter((p) => p.status !== "offline")
          .sort((a, b) => {
            if (a.status === b.status) {
              return b.lastSeenAtMs - a.lastSeenAtMs;
            }

            if (a.status === "online") return -1;
            if (b.status === "online") return 1;

            return b.lastSeenAtMs - a.lastSeenAtMs;
          })
      );
    },
    (err) => {
      console.log("[Groups] subscribeGroupPresence failed", err);
      onError?.(err);
    }
  );
};

export const subscribeMyGroupReadState = (
  groupId: string,
  uid: string,
  onNext: (readState: GroupMemberReadStateDoc | null) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const ref = doc(db, "groups", groupId, "memberReadState", uid);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onNext(null);
        return;
      }

      onNext(
        mapGroupMemberReadStateDoc(
          snap.id,
          groupId,
          snap.data()
        )
      );
    },
    (err) => {
      console.log("[Groups] subscribeMyGroupReadState failed", err);
      onError?.(err);
    }
  );
};

export const markGroupReadState = async (params: {
  groupId: string;
  uid: string;
  activity?: boolean;
  comments?: boolean;
  assignments?: boolean;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.uid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  const patch: Record<string, unknown> = {
    uid: params.uid,
    groupId: params.groupId,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  };

  if (params.activity) {
    patch.lastViewedActivityAtMs = nowMs;
  }

  if (params.comments) {
    patch.lastViewedCommentsAtMs = nowMs;
  }

  if (params.assignments) {
    patch.lastViewedAssignmentsAtMs = nowMs;
  }

  const ref = doc(
    db,
    "groups",
    params.groupId,
    "memberReadState",
    params.uid
  );

  await setDoc(ref, patch, { merge: true });
};

export const upsertGroupGoalTyping = async (params: {
  groupId: string;
  goalId: string;
  uid: string;
  displayName?: string | null;
  email?: string | null;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.goalId) throw new Error("Missing goal id.");
  if (!params.uid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  const ref = doc(
    db,
    "groups",
    params.groupId,
    "sharedGoals",
    params.goalId,
    "typing",
    params.uid
  );

  await setDoc(
    ref,
    {
      uid: params.uid,
      groupId: params.groupId,
      goalId: params.goalId,
      displayName: params.displayName ?? null,
      email: params.email ?? null,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const clearGroupGoalTyping = async (params: {
  groupId: string;
  goalId: string;
  uid: string;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.goalId) throw new Error("Missing goal id.");
  if (!params.uid) throw new Error("Missing user id.");

  const ref = doc(
    db,
    "groups",
    params.groupId,
    "sharedGoals",
    params.goalId,
    "typing",
    params.uid
  );

  await setDoc(
    ref,
    {
      uid: params.uid,
      groupId: params.groupId,
      goalId: params.goalId,
      updatedAtMs: 0,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const subscribeGroupGoalTyping = (
  groupId: string,
  goalId: string,
  onNext: (typing: GroupGoalTypingDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(
      db,
      "groups",
      groupId,
      "sharedGoals",
      goalId,
      "typing"
    ),
    orderBy("updatedAtMs", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const nowMs = Date.now();

      const typing: GroupGoalTypingDoc[] = [];

      snap.forEach((docSnap) => {
        const item = mapGroupGoalTypingDoc(
          docSnap.id,
          groupId,
          goalId,
          docSnap.data()
        );

        if (item.updatedAtMs > 0 && nowMs - item.updatedAtMs <= 12000) {
          typing.push(item);
        }
      });

      onNext(typing);
    },
    (err) => {
      console.log("[Groups] subscribeGroupGoalTyping failed", err);
      onError?.(err);
    }
  );
};

export const subscribeGroupActivityReactions = (
  groupId: string,
  activityId: string,
  onNext: (reactions: GroupActivityReactionDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(
      db,
      "groups",
      groupId,
      "activity",
      activityId,
      "reactions"
    ),
    orderBy("updatedAtMs", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const reactions: GroupActivityReactionDoc[] = [];

      snap.forEach((docSnap) => {
        reactions.push(
          mapGroupActivityReactionDoc(
            docSnap.id,
            groupId,
            activityId,
            docSnap.data()
          )
        );
      });

      onNext(reactions);
    },
    (err) => {
      console.log("[Groups] subscribeGroupActivityReactions failed", err);
      onError?.(err);
    }
  );
};

export const fetchGroupActivityReactions = async (params: {
  groupId: string;
  activityId: string;
}): Promise<GroupActivityReactionDoc[]> => {
  if (!params.groupId || !params.activityId) {
    return [];
  }

  const q = query(
    collection(
      db,
      "groups",
      params.groupId,
      "activity",
      params.activityId,
      "reactions"
    ),
    orderBy("updatedAtMs", "desc")
  );

  const snap = await getDocs(q);

  return snap.docs.map((docSnap) =>
    mapGroupActivityReactionDoc(
      docSnap.id,
      params.groupId,
      params.activityId,
      docSnap.data()
    )
  );
};

export const upsertGroupActivityReaction = async (params: {
  groupId: string;
  activityId: string;
  uid: string;
  emoji: GroupActivityReactionEmoji;
  displayName?: string | null;
  email?: string | null;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.activityId) throw new Error("Missing activity id.");
  if (!params.uid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  const ref = doc(
    db,
    "groups",
    params.groupId,
    "activity",
    params.activityId,
    "reactions",
    params.uid
  );

  await setDoc(
    ref,
    {
      uid: params.uid,
      groupId: params.groupId,
      activityId: params.activityId,
      emoji: params.emoji,
      displayName: params.displayName ?? null,
      email: params.email ?? null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const removeGroupActivityReaction = async (params: {
  groupId: string;
  activityId: string;
  uid: string;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.activityId) throw new Error("Missing activity id.");
  if (!params.uid) throw new Error("Missing user id.");

  const ref = doc(
    db,
    "groups",
    params.groupId,
    "activity",
    params.activityId,
    "reactions",
    params.uid
  );

  await deleteDoc(ref);
};

export const subscribeGroupGoalCommentReactions = (
  groupId: string,
  goalId: string,
  commentId: string,
  onNext: (reactions: GroupGoalCommentReactionDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(
      db,
      "groups",
      groupId,
      "sharedGoals",
      goalId,
      "comments",
      commentId,
      "reactions"
    ),
    orderBy("updatedAtMs", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const reactions: GroupGoalCommentReactionDoc[] = [];

      snap.forEach((docSnap) => {
        reactions.push(
          mapGroupGoalCommentReactionDoc(
            docSnap.id,
            groupId,
            goalId,
            commentId,
            docSnap.data()
          )
        );
      });

      onNext(reactions);
    },
    (err) => {
      console.log("[Groups] subscribeGroupGoalCommentReactions failed", err);
      onError?.(err);
    }
  );
};

export const fetchGroupGoalCommentReactions = async (params: {
  groupId: string;
  goalId: string;
  commentId: string;
}): Promise<GroupGoalCommentReactionDoc[]> => {
  if (!params.groupId || !params.goalId || !params.commentId) {
    return [];
  }

  const q = query(
    collection(
      db,
      "groups",
      params.groupId,
      "sharedGoals",
      params.goalId,
      "comments",
      params.commentId,
      "reactions"
    ),
    orderBy("updatedAtMs", "desc")
  );

  const snap = await getDocs(q);

  return snap.docs.map((docSnap) =>
    mapGroupGoalCommentReactionDoc(
      docSnap.id,
      params.groupId,
      params.goalId,
      params.commentId,
      docSnap.data()
    )
  );
};

export const upsertGroupGoalCommentReaction = async (params: {
  groupId: string;
  goalId: string;
  commentId: string;
  uid: string;
  emoji: string;
  displayName?: string | null;
  email?: string | null;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.goalId) throw new Error("Missing goal id.");
  if (!params.commentId) throw new Error("Missing comment id.");
  if (!params.uid) throw new Error("Missing user id.");
  if (!params.emoji.trim()) throw new Error("Missing emoji.");

  const nowMs = Date.now();

  const ref = doc(
    db,
    "groups",
    params.groupId,
    "sharedGoals",
    params.goalId,
    "comments",
    params.commentId,
    "reactions",
    params.uid
  );

  await setDoc(
    ref,
    {
      uid: params.uid,
      groupId: params.groupId,
      goalId: params.goalId,
      commentId: params.commentId,
      emoji: params.emoji.trim(),
      displayName: params.displayName ?? null,
      email: params.email ?? null,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
};

export const removeGroupGoalCommentReaction = async (params: {
  groupId: string;
  goalId: string;
  commentId: string;
  uid: string;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.goalId) throw new Error("Missing goal id.");
  if (!params.commentId) throw new Error("Missing comment id.");
  if (!params.uid) throw new Error("Missing user id.");

  const ref = doc(
    db,
    "groups",
    params.groupId,
    "sharedGoals",
    params.goalId,
    "comments",
    params.commentId,
    "reactions",
    params.uid
  );

  await deleteDoc(ref);
};

export const createHereMentionInboxItemsForComment = async (params: {
  groupId: string;
  body: string;
  actorUid: string;
  actorName?: string | null;
  actorRole?: GroupRole | null;
  goalId?: string | null;
  goalTitle?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  bulletinId?: string | null;
  bulletinTitle?: string | null;
}) => {
if (!params.groupId || !params.actorUid) return;
if (!bodyHasHereMention(params.body)) return;

let actorRole = params.actorRole ?? null;

if (!actorRole) {
  const actorMemberSnap = await getDoc(
    doc(db, "groups", params.groupId, "members", params.actorUid)
  );

  actorRole =
    actorMemberSnap.exists()
      ? actorMemberSnap.data().role ?? null
      : null;
}

if (!canUseGroupHereMention(actorRole)) return;

const members = await getActiveGroupMembers(params.groupId);

  const mentionPreview =
    params.body.trim().length > 200
      ? `${params.body.trim().slice(0, 197)}...`
      : params.body.trim();

await Promise.all(
    members
      .filter((member) => member.uid !== params.actorUid)
      .map(async (member) => {
        const shouldNotify = await shouldCreateGroupNotificationForUser({
          uid: member.uid,
          groupId: params.groupId,
          category: "mentions",
          taskId: params.taskId ?? null,
        });

        if (!shouldNotify) return;

        await createGroupInboxItem({
          uid: member.uid,
          groupId: params.groupId,
          type: "comment",
          title: "@here mention",
          body: `${
            params.actorName ?? "Someone"
          } mentioned everyone: ${mentionPreview}`,
          goalId: params.goalId ?? null,
          goalTitle: params.goalTitle ?? null,
          subtaskId: params.taskId ?? null,
          subtaskTitle: params.taskTitle ?? null,
          actorUid: params.actorUid,
          actorName: params.actorName ?? null,
          groupKey: params.taskId
            ? `task:${params.taskId}:mentions`
            : params.goalId
            ? `goal:${params.goalId}:mentions`
            : params.bulletinId
            ? `bulletin:${params.bulletinId}:mentions`
            : `group:${params.groupId}:mentions`,
relatedEntityType: params.taskId
  ? "task"
  : params.goalId
  ? "goal"
  : params.bulletinId
  ? "bulletin"
  : "group",
          relatedEntityId:
            params.taskId ??
            params.goalId ??
            params.bulletinId ??
            params.groupId,
          idempotencyKey: `here_${params.groupId}_${
            params.taskId ??
            params.goalId ??
            params.bulletinId ??
            "group"
          }_${member.uid}_${params.actorUid}_${normalizeMentionToken(
            params.body
          ).slice(0, 40)}`,
        });

        await createMentionNotificationRequest({
          groupId: params.groupId,
          targetUid: member.uid,
          targetName: member.displayName ?? member.email ?? null,
          actorUid: params.actorUid,
          actorName: params.actorName ?? null,
          body: mentionPreview,
          goalId: params.goalId ?? null,
          goalTitle: params.goalTitle ?? null,
          taskId: params.taskId ?? null,
          taskTitle: params.taskTitle ?? null,
        }).catch((err) => {
          console.log("[Groups] @here push request failed", err);
        });
      })
  );
};

export const createGroupGoalComment = async (params: {
  groupId: string;
  goalId: string;
  goalTitle?: string | null;
  body: string;
  authorUid: string;
  authorName?: string | null;
  attachments?: readonly MediaAttachmentDoc[];
  commentId?: string | null;
}) => {
  const trimmedBody = params.body.trim();

  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.goalId) throw new Error("Missing goal id.");
  if (!params.authorUid) throw new Error("Missing author id.");
  const commentId =
    params.commentId?.trim() ||
    doc(
      collection(
        db,
        "groups",
        params.groupId,
        "sharedGoals",
        params.goalId,
        "comments"
      )
    ).id;
  const attachments = mapMediaAttachmentDocs(params.attachments ?? [], {
    type: "shared_goal_comment",
    groupId: params.groupId,
    goalId: params.goalId,
    commentId,
  });
  if (attachments.length !== (params.attachments?.length ?? 0)) {
    throw new Error("One or more attachments are invalid.");
  }
  if (!trimmedBody && attachments.length === 0) {
    throw new Error("Write a comment or add an attachment.");
  }

  const nowMs = Date.now();

  const commentRef = doc(
    db,
    "groups",
    params.groupId,
    "sharedGoals",
    params.goalId,
    "comments",
    commentId
  );

  await setDoc(commentRef, {
    groupId: params.groupId,
    goalId: params.goalId,
    body: trimmedBody,
    authorUid: params.authorUid,
    authorName: params.authorName ?? null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    attachments,
    attachmentCount: attachments.length,
  });

  await createGroupActivity({
  groupId: params.groupId,
  type: "comment_created",
  actorUid: params.authorUid,
  actorName: params.authorName ?? null,
  goalId: params.goalId,
  goalTitle: params.goalTitle ?? null,
  message: `commented on "${params.goalTitle ?? "a shared goal"}"`,
}).catch((error) => {
  console.log("[Groups] goal comment activity failed", error);
}).catch((error) => {
  console.log("[Groups] conversation notification failed", error);
}).catch((error) => {
  console.log("[Groups] DM notification failed", error);
});

await createCommentInboxItemsForGroupMembers({
  groupId: params.groupId,
  actorUid: params.authorUid,
  actorName: params.authorName ?? null,
  goalId: params.goalId,
  goalTitle: params.goalTitle ?? null,
}).catch((error) => {
  console.log("[Groups] goal comment inbox fanout failed", error);
});

await createMentionInboxItemsForComment({
  groupId: params.groupId,
  body: trimmedBody,
  actorUid: params.authorUid,
  actorName: params.authorName ?? null,
  goalId: params.goalId,
  goalTitle: params.goalTitle ?? null,
}).catch((error) => {
  console.log("[Groups] goal comment mention fanout failed", error);
});

await createHereMentionInboxItemsForComment({
  groupId: params.groupId,
  body: trimmedBody,
  actorUid: params.authorUid,
  actorName: params.authorName ?? null,
  goalId: params.goalId,
  goalTitle: params.goalTitle ?? null,
}).catch((error) => {
  console.log("[Groups] goal comment here-mention fanout failed", error);
});

  return commentRef.id;
};

export const reserveGroupGoalCommentId = (
  groupId: string,
  goalId: string
): string =>
  doc(collection(db, "groups", groupId, "sharedGoals", goalId, "comments")).id;

export const createGroupTaskComment = async (params: {
  groupId: string;
  taskId: string;
  taskTitle?: string | null;
  body: string;
  authorUid: string;
  authorName?: string | null;
}) => {
  const trimmedBody = params.body.trim();

  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.taskId) throw new Error("Missing task id.");
  if (!params.authorUid) throw new Error("Missing author id.");
  if (!trimmedBody) throw new Error("Comment cannot be empty.");

  const nowMs = Date.now();

  const commentRef = doc(
    collection(
      db,
      "groups",
      params.groupId,
      "tasks",
      params.taskId,
      "comments"
    )
  );

  await setDoc(commentRef, {
    groupId: params.groupId,
    taskId: params.taskId,
    body: trimmedBody,
    authorUid: params.authorUid,
    authorName: params.authorName ?? null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await createGroupActivity({
    groupId: params.groupId,
    type: "comment_created",
    actorUid: params.authorUid,
    actorName: params.authorName ?? null,
    taskId: params.taskId,
    taskTitle: params.taskTitle ?? null,
    message: `commented on "${params.taskTitle ?? "a shared task"}"`,
  });

await createCommentInboxItemsForGroupMembers({
  groupId: params.groupId,
  actorUid: params.authorUid,
  actorName: params.authorName ?? null,
  taskId: params.taskId,
  taskTitle: params.taskTitle ?? null,
});

await createMentionInboxItemsForComment({
  groupId: params.groupId,
  body: trimmedBody,
  actorUid: params.authorUid,
  actorName: params.authorName ?? null,
  taskId: params.taskId,
  taskTitle: params.taskTitle ?? null,
});

await createHereMentionInboxItemsForComment({
  groupId: params.groupId,
  body: trimmedBody,
  actorUid: params.authorUid,
  actorName: params.authorName ?? null,
  taskId: params.taskId,
  taskTitle: params.taskTitle ?? null,
});

  return commentRef.id;
};

export const subscribeGroupTaskComments = (
  groupId: string,
  taskId: string,
  onNext: (comments: GroupTaskCommentDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(db, "groups", groupId, "tasks", taskId, "comments"),
    orderBy("createdAtMs", "asc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const comments: GroupTaskCommentDoc[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();

        comments.push({
          id: docSnap.id,
          groupId: data.groupId ?? groupId,
          taskId: data.taskId ?? taskId,
          body: data.body ?? "",
          authorUid: data.authorUid ?? "",
          authorName: data.authorName ?? null,
          createdAtMs:
            typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
          updatedAtMs:
            typeof data.updatedAtMs === "number" ? data.updatedAtMs : null,
            hiddenByModeration: data.hiddenByModeration === true,
hiddenAtMs: typeof data.hiddenAtMs === "number" ? data.hiddenAtMs : null,
hiddenByUid: data.hiddenByUid ?? null,
hiddenByName: data.hiddenByName ?? null,
hiddenReason: data.hiddenReason ?? null,
hiddenReportId: data.hiddenReportId ?? null,
        });
      });

      onNext(comments);
    },
    (err) => {
      console.log("[Groups] subscribeGroupTaskComments failed", err);
      onError?.(err);
    }
  );
};

export const fetchGroupTaskCommentsPage = async (params: {
  groupId: string;
  taskId: string;
  pageSize?: number;
  cursorCreatedAtMs?: number | null;
}): Promise<{
  items: GroupTaskCommentDoc[];
  nextCursorCreatedAtMs: number | null;
  hasMore: boolean;
}> => {
  if (!params.groupId || !params.taskId) {
    return {
      items: [],
      nextCursorCreatedAtMs: null,
      hasMore: false,
    };
  }

  const pageSize = params.pageSize ?? 20;
  const fetchSize = pageSize + 1;

  const q = query(
    collection(db, "groups", params.groupId, "tasks", params.taskId, "comments"),
    orderBy("createdAtMs", "desc"),
    ...(typeof params.cursorCreatedAtMs === "number"
      ? [startAfter(params.cursorCreatedAtMs)]
      : []),
    limit(fetchSize)
  );

  const snap = await getDocs(q);
  const docs = snap.docs.slice(0, pageSize);

  const items = docs.map((docSnap) => {
    const data = docSnap.data();

    return {
      id: docSnap.id,
      groupId: data.groupId ?? params.groupId,
      taskId: data.taskId ?? params.taskId,
      body: data.body ?? "",
      authorUid: data.authorUid ?? "",
      authorName: data.authorName ?? null,
      createdAtMs:
        typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
      updatedAtMs:
        typeof data.updatedAtMs === "number" ? data.updatedAtMs : null,
        hiddenByModeration: data.hiddenByModeration === true,
hiddenAtMs: typeof data.hiddenAtMs === "number" ? data.hiddenAtMs : null,
hiddenByUid: data.hiddenByUid ?? null,
hiddenByName: data.hiddenByName ?? null,
hiddenReason: data.hiddenReason ?? null,
hiddenReportId: data.hiddenReportId ?? null,
    };
  });

  const lastItem = items[items.length - 1] ?? null;

  return {
    items: items.sort((a, b) => a.createdAtMs - b.createdAtMs),
    nextCursorCreatedAtMs: lastItem?.createdAtMs ?? null,
    hasMore: snap.docs.length > pageSize,
  };
};

export const mapGroupGoalCommentDoc = (
  id: string,
  groupId: string,
  goalId: string,
  data: Record<string, any>
): GroupGoalCommentDoc => {
  const attachments = mapMediaAttachmentDocs(data.attachments, {
    type: "shared_goal_comment",
    groupId,
    goalId,
    commentId: id,
  });
  return {
    id,
    groupId: data.groupId ?? groupId,
    goalId: data.goalId ?? goalId,
    body: data.body ?? "",
    authorUid: data.authorUid ?? "",
    authorName: data.authorName ?? null,
    createdAtMs: typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
    updatedAtMs: typeof data.updatedAtMs === "number" ? data.updatedAtMs : null,
    hiddenByModeration: data.hiddenByModeration === true,
    attachments,
    attachmentCount: attachments.length,
    hiddenAtMs: typeof data.hiddenAtMs === "number" ? data.hiddenAtMs : null,
    hiddenByUid: data.hiddenByUid ?? null,
    hiddenByName: data.hiddenByName ?? null,
    hiddenReason: data.hiddenReason ?? null,
    hiddenReportId: data.hiddenReportId ?? null,
  };
};

export const subscribeGroupGoalComments = (
  groupId: string,
  goalId: string,
  onNext: (comments: GroupGoalCommentDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(db, "groups", groupId, "sharedGoals", goalId, "comments"),
    orderBy("createdAtMs", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const comments: GroupGoalCommentDoc[] = [];

      snap.forEach((docSnap) => {
        comments.push(
          mapGroupGoalCommentDoc(docSnap.id, groupId, goalId, docSnap.data())
        );
      });

      onNext(comments);
    },
    (err) => {
      console.log("[Groups] subscribeGroupGoalComments failed", err);
      onError?.(err);
    }
  );
};

export const fetchGroupGoalCommentsPage = async (params: {
  groupId: string;
  goalId: string;
  pageSize?: number;
  cursorCreatedAtMs?: number | null;
}): Promise<{
  items: GroupGoalCommentDoc[];
  nextCursorCreatedAtMs: number | null;
  hasMore: boolean;
}> => {
  if (!params.groupId || !params.goalId) {
    return {
      items: [],
      nextCursorCreatedAtMs: null,
      hasMore: false,
    };
  }

  const pageSize = params.pageSize ?? 20;
  const fetchSize = pageSize + 1;

  const q = query(
    collection(
      db,
      "groups",
      params.groupId,
      "sharedGoals",
      params.goalId,
      "comments"
    ),
    orderBy("createdAtMs", "desc"),
    ...(typeof params.cursorCreatedAtMs === "number"
      ? [startAfter(params.cursorCreatedAtMs)]
      : []),
    limit(fetchSize)
  );

  const snap = await getDocs(q);
  const docs = snap.docs.slice(0, pageSize);

  const items = docs.map((docSnap) => {
    const data = docSnap.data();
    return mapGroupGoalCommentDoc(
      docSnap.id,
      params.groupId,
      params.goalId,
      data
    );
  });

  const lastItem = items[items.length - 1] ?? null;

  return {
    items: items.sort((a, b) => a.createdAtMs - b.createdAtMs),
    nextCursorCreatedAtMs: lastItem?.createdAtMs ?? null,
    hasMore: snap.docs.length > pageSize,
  };
};

export const assignSharedGoalSubtaskToMember = async (params: {
  groupId: string;
  goalId: string;
  goalTitle?: string | null;
  subtaskId: string;
  subtaskTitle?: string | null;
  assignedToUid: string;
  assignedToName?: string | null;
  assignedToEmail?: string | null;
  assignedByUid: string;
  assignedByName?: string | null;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.goalId) throw new Error("Missing goal id.");
  if (!params.subtaskId) throw new Error("Missing subtask id.");
  if (!params.assignedToUid) throw new Error("Missing assignee id.");
  if (!params.assignedByUid) throw new Error("Missing assigner id.");

  const nowMs = Date.now();

  const subtaskRef = doc(
    db,
    "goals",
    params.goalId,
    "subtasks",
    params.subtaskId
  );

  const subtaskSnap = await getDoc(subtaskRef);
const existingSubtaskData = subtaskSnap.data();

const wasAlreadyAssignedToSameUser =
  existingSubtaskData?.assignedToUid === params.assignedToUid;

  await updateDoc(subtaskRef, {
    assignedToUid: params.assignedToUid,
    assignedToName: params.assignedToName ?? null,
    assignedToEmail: params.assignedToEmail ?? null,
    assignedByUid: params.assignedByUid,
    assignedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });

  await createGroupActivity({
    groupId: params.groupId,
    type: "task_assigned",
    actorUid: params.assignedByUid,
    actorName: params.assignedByName ?? null,
    goalId: params.goalId,
    goalTitle: params.goalTitle ?? null,
    targetUid: params.assignedToUid,
    targetEmail: params.assignedToEmail ?? null,
    message: `assigned "${params.subtaskTitle ?? "a task"}" to ${
  params.assignedToName ?? params.assignedToEmail ?? "someone"
} in "${params.goalTitle ?? "a shared goal"}"`,
  });

if (!wasAlreadyAssignedToSameUser) {
  const shouldNotifyAssignee = await shouldCreateGroupNotificationForUser({
  uid: params.assignedToUid,
  groupId: params.groupId,
  category: "assignments",
  taskId: params.subtaskId,
});

  if (shouldNotifyAssignee) {
    try {
      await createAssignmentNotificationRequest({
        groupId: params.groupId,
        goalId: params.goalId,
        goalTitle: params.goalTitle ?? null,
        subtaskId: params.subtaskId,
        subtaskTitle: params.subtaskTitle ?? null,
        assignedToUid: params.assignedToUid,
        assignedToName:
          params.assignedToName ?? params.assignedToEmail ?? null,
        assignedByUid: params.assignedByUid,
        assignedByName: params.assignedByName ?? null,
      });
    } catch (err) {
      console.log("[Groups] assignment notification request failed", err);
    }

    try {
      await createGroupInboxItem({
        uid: params.assignedToUid,
        groupId: params.groupId,
        type: "assignment",
        title: "New task assigned",
        
        idempotencyKey: `assignment_${params.groupId}_${params.goalId}_${params.subtaskId}_${params.assignedToUid}`,
        body: `${params.assignedByName ?? "Someone"} assigned "${
          params.subtaskTitle ?? "a task"
        }" to you.`,
        goalId: params.goalId,
        goalTitle: params.goalTitle ?? null,
        subtaskId: params.subtaskId,
        subtaskTitle: params.subtaskTitle ?? null,
        actorUid: params.assignedByUid,
        actorName: params.assignedByName ?? null,
        groupKey: `goal:${params.goalId}:assignments`,
relatedEntityType: "goal",
relatedEntityId: params.goalId,
      });
    } catch (err) {
      console.log("[Groups] assignment inbox item failed", err);
    }
  }
}
};

export const unassignSharedGoalSubtask = async (params: {
  groupId: string;
  goalId: string;
  goalTitle?: string | null;
  subtaskId: string;
  subtaskTitle?: string | null;
  unassignedByUid: string;
  unassignedByName?: string | null;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.goalId) throw new Error("Missing goal id.");
  if (!params.subtaskId) throw new Error("Missing subtask id.");
  if (!params.unassignedByUid) throw new Error("Missing user id.");

  const subtaskRef = doc(
    db,
    "goals",
    params.goalId,
    "subtasks",
    params.subtaskId
  );

  await updateDoc(subtaskRef, {
    assignedToUid: null,
    assignedToName: null,
    assignedToEmail: null,
    assignedByUid: null,
    assignedAtMs: null,
    updatedAt: serverTimestamp(),
  });

  await createGroupActivity({
    groupId: params.groupId,
    type: "task_unassigned",
    actorUid: params.unassignedByUid,
    actorName: params.unassignedByName ?? null,
    goalId: params.goalId,
    goalTitle: params.goalTitle ?? null,
    message: `unassigned "${params.subtaskTitle ?? "a task"}" in "${
      params.goalTitle ?? "a shared goal"
    }"`,
  }).catch((error) => {
    console.log("[Groups] bulletin comment activity failed", error);
  });
};

export const mapGroupBulletinDoc = (
  id: string,
  groupId: string,
  data: Record<string, any>
): GroupBulletinDoc => {
  const attachments = mapBulletinAttachments({
    groupId,
    bulletinId: id,
    authorUid: typeof data.authorUid === "string" ? data.authorUid : "",
    createdAtMs: typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
    attachments: data.attachments,
    imageUrls: data.imageUrls,
    videoUrls: data.videoUrls,
  });
  return {
    id,
    groupId: data.groupId ?? groupId,

    title: data.title ?? "",
    body: data.body ?? "",

    authorUid: data.authorUid ?? "",
    authorName: data.authorName ?? null,
    authorEmail: data.authorEmail ?? null,

    createdAtMs:
      typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : 0,

    attachments,
    imageUrls: Array.isArray(data.imageUrls)
  ? data.imageUrls.filter((url): url is string => typeof url === "string")
  : [],

videoUrls: Array.isArray(data.videoUrls)
  ? data.videoUrls.filter((url): url is string => typeof url === "string")
  : [],

attachmentCount:
  attachments.length,

    hiddenByModeration: data.hiddenByModeration === true,
    hiddenAtMs: typeof data.hiddenAtMs === "number" ? data.hiddenAtMs : null,
    hiddenByUid: data.hiddenByUid ?? null,
    hiddenByName: data.hiddenByName ?? null,
    hiddenReason: data.hiddenReason ?? null,
    hiddenReportId: data.hiddenReportId ?? null,
    deletedByAuthor: data.deletedByAuthor === true,
    deletedAtMs: typeof data.deletedAtMs === "number" ? data.deletedAtMs : null,
  };
};

export const subscribeGroupBulletins = (
  groupId: string,
  onNext: (bulletins: GroupBulletinDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!groupId) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collection(db, "groups", groupId, "bulletins"),
    orderBy("createdAtMs", "desc"),
    limit(20)
  );

  return onSnapshot(
    q,
    (snap) => {
      const bulletins: GroupBulletinDoc[] = [];

      snap.forEach((docSnap) => {
        bulletins.push(
          mapGroupBulletinDoc(docSnap.id, groupId, docSnap.data())
        );
      });

      onNext(bulletins);
    },
    (err) => {
      console.log("[Groups] subscribeGroupBulletins failed", err);
      onError?.(err);
    }
  );
};

export const subscribeGroupBulletin = (
  groupId: string,
  bulletinId: string,
  onNext: (bulletin: GroupBulletinDoc | null) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!groupId || !bulletinId) {
    onNext(null);
    return () => {};
  }

  return onSnapshot(
    doc(db, "groups", groupId, "bulletins", bulletinId),
    (snap) => {
      if (!snap.exists()) {
        onNext(null);
        return;
      }

      onNext(mapGroupBulletinDoc(snap.id, groupId, snap.data()));
    },
    (err) => {
      console.log("[Groups] subscribeGroupBulletin failed", err);
      onError?.(err);
    }
  );
};

export const mapGroupBulletinCommentDoc = (
  id: string,
  groupId: string,
  bulletinId: string,
  data: Record<string, any>
): GroupBulletinCommentDoc => {
  const attachments = mapMediaAttachmentDocs(data.attachments, {
    type: "bulletin_comment",
    groupId,
    bulletinId,
    commentId: id,
  });
  return {
    id,
    groupId: data.groupId ?? groupId,
    bulletinId: data.bulletinId ?? bulletinId,

    body: data.body ?? "",

    authorUid: data.authorUid ?? "",
    authorName: data.authorName ?? null,
    authorEmail: data.authorEmail ?? null,

    createdAtMs:
      typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
    updatedAtMs:
      typeof data.updatedAtMs === "number" ? data.updatedAtMs : null,

    hiddenByModeration: data.hiddenByModeration === true,
    hiddenAtMs: typeof data.hiddenAtMs === "number" ? data.hiddenAtMs : null,
    hiddenByUid: data.hiddenByUid ?? null,
    hiddenByName: data.hiddenByName ?? null,
    hiddenReason: data.hiddenReason ?? null,
    hiddenReportId: data.hiddenReportId ?? null,
    attachments,
    attachmentCount: attachments.length,
  };
};

export const subscribeGroupBulletinComments = (
  groupId: string,
  bulletinId: string,
  onNext: (comments: GroupBulletinCommentDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!groupId || !bulletinId) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collection(db, "groups", groupId, "bulletins", bulletinId, "comments"),
    orderBy("createdAtMs", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const comments: GroupBulletinCommentDoc[] = [];

      snap.forEach((docSnap) => {
        comments.push(
          mapGroupBulletinCommentDoc(
            docSnap.id,
            groupId,
            bulletinId,
            docSnap.data()
          )
        );
      });

      onNext(comments);
    },
    (err) => {
      console.log("[Groups] subscribeGroupBulletinComments failed", err);
      onError?.(err);
    }
  );
};

export const createGroupBulletinComment = async (params: {
  groupId: string;
  bulletinId: string;
  bulletinTitle?: string | null;
  body: string;
  authorUid: string;
  authorName?: string | null;
  authorEmail?: string | null;
  attachments?: readonly MediaAttachmentDoc[];
  commentId?: string | null;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.bulletinId) throw new Error("Missing bulletin id.");
  if (!params.authorUid) throw new Error("Missing author id.");

  const body = params.body.trim();
  const commentId =
    params.commentId?.trim() ||
    doc(
      collection(
        db,
        "groups",
        params.groupId,
        "bulletins",
        params.bulletinId,
        "comments"
      )
    ).id;
  const attachments = mapMediaAttachmentDocs(params.attachments ?? [], {
    type: "bulletin_comment",
    groupId: params.groupId,
    bulletinId: params.bulletinId,
    commentId,
  });
  if (attachments.length !== (params.attachments?.length ?? 0)) {
    throw new Error("One or more attachments are invalid.");
  }
  if (!body && attachments.length === 0) {
    throw new Error("Write a comment or add an attachment.");
  }
  if (body.length > 1000) throw new Error("Comment is too long.");

  const nowMs = Date.now();

  await setDoc(
    doc(
      db,
      "groups",
      params.groupId,
      "bulletins",
      params.bulletinId,
      "comments",
      commentId
    ),
    {
      groupId: params.groupId,
      bulletinId: params.bulletinId,

      body,

      authorUid: params.authorUid,
      authorName: params.authorName ?? null,
      authorEmail: params.authorEmail ?? null,

      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),

      hiddenByModeration: false,
      hiddenAtMs: null,
      hiddenByUid: null,
      hiddenByName: null,
      hiddenReason: null,
      hiddenReportId: null,
      attachments,
      attachmentCount: attachments.length,
    }
  );

  await createGroupActivity({
    groupId: params.groupId,
    type: "comment_created",
    actorUid: params.authorUid,
    actorName: params.authorName ?? null,
    message: `commented on bulletin "${
      params.bulletinTitle ?? "Untitled bulletin"
    }"`,
  });

await createMentionInboxItemsForComment({
  groupId: params.groupId,
  body,
  actorUid: params.authorUid,
  actorName: params.authorName ?? null,
}).catch((error) => {
  console.log("[Groups] bulletin comment mention fanout failed", error);
});

await createHereMentionInboxItemsForComment({
  groupId: params.groupId,
  body,
  actorUid: params.authorUid,
  actorName: params.authorName ?? null,
  bulletinId: params.bulletinId,
  bulletinTitle: params.bulletinTitle ?? null,
}).catch((error) => {
  console.log("[Groups] bulletin comment here-mention fanout failed", error);
});
};

export const createGroupBulletin = async (
  input: CreateGroupBulletinInput
): Promise<string> => {
  if (!input.groupId) throw new Error("Missing group id.");
  if (!input.authorUid) throw new Error("Missing author id.");

  const title = input.title.trim();
  const body = input.body.trim();
  const bulletinRef = input.bulletinId
    ? doc(db, "groups", input.groupId, "bulletins", input.bulletinId)
    : doc(collection(db, "groups", input.groupId, "bulletins"));

  const attachments = mapMediaAttachmentDocs(input.attachments, {
    type: "bulletin",
    groupId: input.groupId,
    bulletinId: bulletinRef.id,
  });
  if (attachments.length !== input.attachments.length) {
    throw new Error("One or more bulletin attachments are invalid.");
  }

  if (!title) throw new Error("Bulletin title is required.");
  if (!body) throw new Error("Bulletin body is required.");

  const nowMs = Date.now();
  await setDoc(bulletinRef, {
    groupId: input.groupId,

    title,
    body,
    attachments,
    attachmentCount: attachments.length,

    authorUid: input.authorUid,
    authorName: input.authorName ?? null,
    authorEmail: input.authorEmail ?? null,

    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),

    hiddenByModeration: false,
    hiddenAtMs: null,
    hiddenByUid: null,
    hiddenByName: null,
    hiddenReason: null,
    hiddenReportId: null,
    deletedByAuthor: false,
    deletedAtMs: null,
  });

  await updateDoc(doc(db, "groups", input.groupId), {
    lastActivityAtMs: nowMs,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });

await createGroupActivity({
  groupId: input.groupId,
  type: "note_created",
  actorUid: input.authorUid,
  actorName: input.authorName ?? null,
  message: `posted a bulletin: "${title}"`,
});

await createMentionInboxItemsForComment({
  groupId: input.groupId,
  body,
  actorUid: input.authorUid,
  actorName: input.authorName ?? null,
});

await createHereMentionInboxItemsForComment({
  groupId: input.groupId,
  body,
  actorUid: input.authorUid,
  actorName: input.authorName ?? null,
  bulletinId: bulletinRef.id,
  bulletinTitle: title,
});

return bulletinRef.id;
};

export const updateGroupBulletin = async (input: {
  groupId: string;
  bulletinId: string;
  title: string;
  body: string;
  attachments: MediaAttachmentDoc[];
}) => {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title || !body) throw new Error("Bulletin title and message are required.");
  const attachments = mapMediaAttachmentDocs(input.attachments, {
    type: "bulletin",
    groupId: input.groupId,
    bulletinId: input.bulletinId,
  });
  if (attachments.length !== input.attachments.length) {
    throw new Error("One or more bulletin attachments are invalid.");
  }
  await updateDoc(doc(db, "groups", input.groupId, "bulletins", input.bulletinId), {
    title,
    body,
    attachments,
    attachmentCount: attachments.length,
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  });
};

export const reserveGroupBulletinCommentId = (
  groupId: string,
  bulletinId: string
): string =>
  doc(collection(db, "groups", groupId, "bulletins", bulletinId, "comments")).id;

export const softDeleteGroupBulletin = async (groupId: string, bulletinId: string) => {
  const nowMs = Date.now();
  await updateDoc(doc(db, "groups", groupId, "bulletins", bulletinId), {
    deletedByAuthor: true,
    deletedAtMs: nowMs,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
};

export const permanentlyDeleteGroupBulletin = async (
  groupId: string,
  bulletinId: string
) => {
  await deleteDoc(doc(db, "groups", groupId, "bulletins", bulletinId));
};

export const createGroupActivity = async (params: {
  groupId: string;
  type: GroupActivityType;
  actorUid: string;
  actorName?: string | null;
  actorEmail?: string | null;
  message: string;
  goalId?: string | null;
  goalTitle?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  targetUid?: string | null;
  targetEmail?: string | null;
  boardId?: string | null;
  boardTitle?: string | null;
  cardId?: string | null;
  cardTitle?: string | null;
  previousAssignedToUid?: string | null;
  previousAssignedToName?: string | null;
  previousAssignedToEmail?: string | null;
  assignedToUid?: string | null;
  assignedToName?: string | null;
  assignedToEmail?: string | null;
}) => {
  const nowMs = Date.now();

  const activityRef = doc(collection(db, "groups", params.groupId, "activity"));

  await setDoc(activityRef, {
    groupId: params.groupId,
    type: params.type,
    actorUid: params.actorUid,
    actorName: params.actorName ?? null,
    actorEmail: params.actorEmail ?? null,
    message: params.message,
    goalId: params.goalId ?? null,
    goalTitle: params.goalTitle ?? null,
    targetUid: params.targetUid ?? null,
    targetEmail: params.targetEmail ?? null,
    createdAtMs: nowMs,
    createdAt: serverTimestamp(),
    taskId: params.taskId ?? null,
taskTitle: params.taskTitle ?? null,
    boardId: params.boardId ?? null,
    boardTitle: params.boardTitle ?? null,
    cardId: params.cardId ?? null,
    cardTitle: params.cardTitle ?? null,
    previousAssignedToUid: params.previousAssignedToUid ?? null,
    previousAssignedToName: params.previousAssignedToName ?? null,
    previousAssignedToEmail: params.previousAssignedToEmail ?? null,
    assignedToUid: params.assignedToUid ?? null,
    assignedToName: params.assignedToName ?? null,
    assignedToEmail: params.assignedToEmail ?? null,
  });
};



export const subscribeGroupActivity = (
  groupId: string,
  onNext: (activity: GroupActivityDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(db, "groups", groupId, "activity"),
    orderBy("createdAtMs", "desc"),
    limit(50)
  );

  return onSnapshot(
    q,
    (snap) => {
      const items: GroupActivityDoc[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();

        items.push({
          id: docSnap.id,
          groupId: data.groupId ?? groupId,
          type: data.type ?? "note_created",
          actorUid: data.actorUid ?? "",
          actorName: data.actorName ?? null,
          actorEmail: data.actorEmail ?? null,
          message: data.message ?? "",
          goalId: data.goalId ?? null,
          goalTitle: data.goalTitle ?? null,
          targetUid: data.targetUid ?? null,
          targetEmail: data.targetEmail ?? null,
          createdAtMs:
            typeof data.createdAtMs === "number"
              ? data.createdAtMs
              : 0,
          taskId: data.taskId ?? null,
          taskTitle: data.taskTitle ?? null,
          boardId: data.boardId ?? null,
          boardTitle: data.boardTitle ?? null,
          cardId: data.cardId ?? null,
          cardTitle: data.cardTitle ?? null,
          previousAssignedToUid: data.previousAssignedToUid ?? null,
          previousAssignedToName: data.previousAssignedToName ?? null,
          previousAssignedToEmail: data.previousAssignedToEmail ?? null,
          assignedToUid: data.assignedToUid ?? null,
          assignedToName: data.assignedToName ?? null,
          assignedToEmail: data.assignedToEmail ?? null,
          hiddenByModeration: data.hiddenByModeration === true,
hiddenAtMs: typeof data.hiddenAtMs === "number" ? data.hiddenAtMs : null,
hiddenByUid: data.hiddenByUid ?? null,
hiddenByName: data.hiddenByName ?? null,
hiddenReason: data.hiddenReason ?? null,
hiddenReportId: data.hiddenReportId ?? null,
        });
      });

      onNext(items);
    },
    (err) => {
      console.log("[Groups] subscribeGroupActivity failed", err);
      onError?.(err);
    }
  );
};

export const fetchGroupActivityPage = async (params: {
  groupId: string;
  pageSize?: number;
  cursorCreatedAtMs?: number | null;
}): Promise<{
  items: GroupActivityDoc[];
  nextCursorCreatedAtMs: number | null;
  hasMore: boolean;
}> => {
  if (!params.groupId) {
    return {
      items: [],
      nextCursorCreatedAtMs: null,
      hasMore: false,
    };
  }

  const pageSize = params.pageSize ?? 20;
  const fetchSize = pageSize + 1;

  const q = query(
    collection(db, "groups", params.groupId, "activity"),
    orderBy("createdAtMs", "desc"),
    ...(typeof params.cursorCreatedAtMs === "number"
      ? [startAfter(params.cursorCreatedAtMs)]
      : []),
    limit(fetchSize)
  );

  const snap = await getDocs(q);

  const docs = snap.docs.slice(0, pageSize);

  const items: GroupActivityDoc[] = docs.map((docSnap) => {
    const data = docSnap.data();

    return {
      id: docSnap.id,
      groupId: data.groupId ?? params.groupId,
      type: data.type ?? "note_created",
      actorUid: data.actorUid ?? "",
      actorName: data.actorName ?? null,
      actorEmail: data.actorEmail ?? null,
      message: data.message ?? "",
      goalId: data.goalId ?? null,
      goalTitle: data.goalTitle ?? null,
      targetUid: data.targetUid ?? null,
      targetEmail: data.targetEmail ?? null,
      createdAtMs:
        typeof data.createdAtMs === "number" ? data.createdAtMs : 0,
      taskId: data.taskId ?? null,
      taskTitle: data.taskTitle ?? null,
      boardId: data.boardId ?? null,
      boardTitle: data.boardTitle ?? null,
      cardId: data.cardId ?? null,
      cardTitle: data.cardTitle ?? null,
      previousAssignedToUid: data.previousAssignedToUid ?? null,
      previousAssignedToName: data.previousAssignedToName ?? null,
      previousAssignedToEmail: data.previousAssignedToEmail ?? null,
      assignedToUid: data.assignedToUid ?? null,
      assignedToName: data.assignedToName ?? null,
      assignedToEmail: data.assignedToEmail ?? null,
      hiddenByModeration: data.hiddenByModeration === true,
hiddenAtMs: typeof data.hiddenAtMs === "number" ? data.hiddenAtMs : null,
hiddenByUid: data.hiddenByUid ?? null,
hiddenByName: data.hiddenByName ?? null,
hiddenReason: data.hiddenReason ?? null,
hiddenReportId: data.hiddenReportId ?? null,
    };
  });

  const lastItem = items[items.length - 1] ?? null;

  return {
    items,
    nextCursorCreatedAtMs: lastItem?.createdAtMs ?? null,
    hasMore: snap.docs.length > pageSize,
  };
};

export const createGroup = async ({
  uid,
  email = null,
  displayName = null,
  name,
  description = null,
  visibility = "invite_only",
  discoverable = false,
  joinPolicy = "invite_only",
  category = "general",
  tags = [],
  summary = null,
}: CreateGroupInput) => {
  const trimmedName = name.trim();

  if (!uid) {
    throw new Error("Missing user id.");
  }

  if (!trimmedName) {
    throw new Error("Group name is required.");
  }

  const nowMs = Date.now();
  const groupRef = doc(collection(db, "groups"));
  const memberRef = doc(db, "groups", groupRef.id, "members", uid);
  const membershipMirrorRef = doc(db, "groupMemberships", `${uid}_${groupRef.id}`);

  

  const normalizedVisibility: GroupVisibility =
    visibility === "searchable" || visibility === "private"
      ? visibility
      : "invite_only";

 const normalizedDiscoverable =
  normalizedVisibility === "searchable" && discoverable === true;

const normalizedJoinPolicy =
  normalizedVisibility === "searchable"
    ? normalizeGroupJoinPolicy(joinPolicy)
    : "invite_only";

await setDoc(groupRef, {
    name: trimmedName,
    description: description?.trim() || null,
    ownerUserId: uid,
    visibility: normalizedVisibility,

    discoverable: normalizedDiscoverable,
joinPolicy: normalizedJoinPolicy,
category: normalizeGroupDiscoveryCategory(category),
tags: normalizeGroupDiscoveryTags(tags),
summary: summary?.trim() || description?.trim() || null,
    isHiddenFromDiscovery: false,
    lastActivityAtMs: nowMs,

    memberCount: 1,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await setDoc(memberRef, {
    uid,
    email,
    displayName,
    role: "owner",
    status: "active",
    joinedAtMs: nowMs,
    joinedAt: serverTimestamp(),
    invitedByUid: null,
  });

  await setDoc(membershipMirrorRef, {
  groupId: groupRef.id,
  groupName: trimmedName,
  uid,
  email,
  displayName,
  role: "owner",
  status: "active",
  joinedAtMs: nowMs,
  joinedAt: serverTimestamp(),
  invitedByUid: null,
});

  return groupRef.id;
};

export const subscribeBlockedUsers = (
  groupId: string,
  onNext: (users: GroupBlockedUserDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(db, "groups", groupId, "blockedUsers"),
    orderBy("createdAtMs", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const users: GroupBlockedUserDoc[] = [];

      snap.forEach((docSnap) => {
        users.push(
          mapGroupBlockedUserDoc(
            docSnap.id,
            docSnap.data()
          )
        );
      });

      onNext(users);
    },
    (err) => {
      console.log("[Groups] subscribeBlockedUsers failed", err);
      onError?.(err);
    }
  );
};

export const subscribeGroupMembers = (
  groupId: string,
  onNext: (members: GroupMemberDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(db, "groups", groupId, "members"),
    where("status", "==", "active")
  );

  return onSnapshot(
    q,
    (snap) => {
      const members: GroupMemberDoc[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();

        members.push({
          uid: data.uid ?? docSnap.id,
          email: data.email ?? null,
          displayName: data.displayName ?? null,
          role: data.role ?? "member",
          status: data.status ?? "active",
          joinedAtMs: data.joinedAtMs ?? 0,
          invitedByUid: data.invitedByUid ?? null,
        });
      });

      onNext(members);
    },
    (err) => {
      console.log("[Groups] subscribeGroupMembers failed", err);
      onError?.(err);
    }
  );
};

export const subscribeDiscoverableGroups = (
  onNext: (groups: GroupDiscoverySummary[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(db, "groups"),
    where("visibility", "==", "searchable"),
    where("discoverable", "==", true),
    where("isHiddenFromDiscovery", "==", false),
    orderBy("lastActivityAtMs", "desc"),
    limit(25)
  );

  return onSnapshot(
    q,
    (snap) => {
      const groups: GroupDiscoverySummary[] = [];

      snap.forEach((docSnap) => {
        const summary = toGroupDiscoverySummary(
          docSnap.id,
          {
            id: docSnap.id,
            ...(docSnap.data() as Omit<GroupDoc, "id">),
          }
        );

        if (summary) {
          groups.push(summary);
        }
      });

      onNext(groups);
    },
    (err) => {
      console.log("[Groups] subscribeDiscoverableGroups failed", err);
      onError?.(err);
    }
  );
};

export const subscribeDiscoverableGroupsByCategory = (
  category: GroupDiscoveryCategory,
  onNext: (groups: GroupDiscoverySummary[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const normalizedCategory = normalizeGroupDiscoveryCategory(category);

  const q = query(
    collection(db, "groups"),
    where("visibility", "==", "searchable"),
    where("discoverable", "==", true),
    where("isHiddenFromDiscovery", "==", false),
    where("category", "==", normalizedCategory),
    orderBy("lastActivityAtMs", "desc"),
    limit(25)
  );

  return onSnapshot(
    q,
    (snap) => {
      const groups: GroupDiscoverySummary[] = [];

      snap.forEach((docSnap) => {
        const summary = toGroupDiscoverySummary(docSnap.id, {
          id: docSnap.id,
          ...(docSnap.data() as Omit<GroupDoc, "id">),
        });

        if (summary) {
          groups.push(summary);
        }
      });

      onNext(groups);
    },
    (err) => {
      console.log("[Groups] subscribeDiscoverableGroupsByCategory failed", err);
      onError?.(err);
    }
  );
};

export const subscribeMyGroupMemberships = (
  uid: string,
  onNext: (memberships: Array<GroupMemberDoc & { groupId: string }>) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(db, "groupMemberships"),
    where("uid", "==", uid),
    where("status", "==", "active")
  );

  return onSnapshot(
    q,
    (snap) => {
      const memberships: Array<GroupMemberDoc & { groupId: string }> = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();

        memberships.push({
          groupId: data.groupId,
          uid: data.uid ?? uid,
          email: data.email ?? null,
          displayName: data.displayName ?? null,
          role: data.role ?? "member",
          status: data.status ?? "active",
          joinedAtMs: data.joinedAtMs ?? 0,
          invitedByUid: data.invitedByUid ?? null,
          groupName: data.groupName ?? null,
        });
      });

      onNext(memberships);
    },
    (err) => {
      console.log("[Groups] subscribeMyGroupMemberships failed", err);
      onError?.(err);
    }
  );
};

export const markGroupUpdated = async (groupId: string) => {
  const nowMs = Date.now();

  await updateDoc(doc(db, "groups", groupId), {
    updatedAtMs: nowMs,
    lastActivityAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
};

export type UpdateGroupDiscoverySettingsInput = {
  groupId: string;
  visibility?: GroupVisibility;
  discoverable?: boolean;
  joinPolicy?: GroupJoinPolicy;
  category?: GroupDiscoveryCategory | null;
  tags?: string[];
  summary?: string | null;
};

export const updateGroupDiscoverySettings = async ({
  groupId,
  visibility,
  discoverable,
  joinPolicy,
  category,
  tags,
  summary,
}: UpdateGroupDiscoverySettingsInput) => {
  if (!groupId) {
    throw new Error("Missing group id.");
  }

  const patch: Record<string, unknown> = {
    updatedAtMs: Date.now(),
    updatedAt: serverTimestamp(),
  };

  if (visibility) {
    patch.visibility = visibility;
  }

  if (typeof discoverable === "boolean") {
    patch.discoverable = discoverable;
  }

  if (joinPolicy) {
    patch.joinPolicy = normalizeGroupJoinPolicy(joinPolicy);
  }

  if (category !== undefined) {
    patch.category =
      category == null ? null : normalizeGroupDiscoveryCategory(category);
  }

  if (tags !== undefined) {
    patch.tags = normalizeGroupDiscoveryTags(tags);
  }

  if (summary !== undefined) {
    patch.summary = summary?.trim() || null;
  }

  await updateDoc(doc(db, "groups", groupId), patch);
};

export const blockUserFromGroup = async ({
  groupId,
  uid,
  blockedByUid,
  blockedByEmail = null,
  blockedByDisplayName = null,
  blockedUserEmail = null,
  blockedUserDisplayName = null,
  reason = null,
  adminNote = null,
}: {
  groupId: string;
  uid: string;

  blockedByUid: string;

  blockedByEmail?: string | null;
  blockedByDisplayName?: string | null;

  blockedUserEmail?: string | null;
  blockedUserDisplayName?: string | null;

  reason?: string | null;
  adminNote?: string | null;
}) => {
  if (!groupId) throw new Error("Missing group id.");
  if (!uid) throw new Error("Missing user id.");
  if (!blockedByUid) throw new Error("Missing actor id.");

  const nowMs = Date.now();

const blockedRef = doc(
    db,
    "groups",
    groupId,
    "blockedUsers",
    uid
  );

  await setDoc(blockedRef, {
    uid,

    blockedByUid,

    blockedByEmail,
    blockedByDisplayName,

    blockedUserEmail,
    blockedUserDisplayName,

    reason: reason?.trim() || null,
    adminNote: adminNote?.trim() || null,

    createdAtMs: nowMs,
    updatedAtMs: nowMs,

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const removeGroupMember = async ({
  groupId,
  memberUid,
}: {
  groupId: string;
  memberUid: string;
}) => {
  if (!groupId) throw new Error("Missing group id.");
  if (!memberUid) throw new Error("Missing member id.");

  const nowMs = Date.now();

  const memberRef = doc(db, "groups", groupId, "members", memberUid);
  const membershipMirrorRef = doc(db, "groupMemberships", `${memberUid}_${groupId}`);

  await runTransaction(db, async (tx) => {
    const memberSnap = await tx.get(memberRef);

    if (!memberSnap.exists()) {
      throw new Error("Member not found.");
    }

    const memberData = memberSnap.data();

    if (memberData.role === "owner") {
      throw new Error("Group owner cannot be removed.");
    }

    tx.update(memberRef, {
      status: "removed",
      removedAtMs: nowMs,
      updatedAtMs: nowMs,
    });

    tx.update(membershipMirrorRef, {
      status: "removed",
      removedAtMs: nowMs,
      updatedAtMs: nowMs,
    });
    createGroupActivityTx(tx, {
  groupId,
  type: "member_removed",
  actorUid: auth.currentUser?.uid ?? "",
  actorName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? null,
  message: `removed ${memberData.displayName ?? memberData.email ?? "a member"}`,
  targetUid: memberUid,
  targetEmail: memberData.email ?? null,
  createdAtMs: nowMs,
});
createGroupAdminLogTx(tx, {
  groupId,
  action: "member_removed",
  actorUid: auth.currentUser?.uid ?? "",
  actorName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? null,
  actorEmail: auth.currentUser?.email ?? null,
  targetUid: memberUid,
  targetEmail: memberData.email ?? null,
  targetName: memberData.displayName ?? null,
  message: `Removed ${memberData.displayName ?? memberData.email ?? "a member"} from the group.`,
  metadata: {
    previousRole: memberData.role ?? null,
  },
  createdAtMs: nowMs,
});
  });
};

export const leaveGroup = async ({
  groupId,
  uid,
}: {
  groupId: string;
  uid: string;
}) => {
  if (!groupId) throw new Error("Missing group id.");
  if (!uid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  const memberRef = doc(db, "groups", groupId, "members", uid);
  const membershipMirrorRef = doc(db, "groupMemberships", `${uid}_${groupId}`);

  const [conversationSnap, dmSnap] = await Promise.all([
    getDocs(
      query(
        collection(db, "groupConversations"),
        where("groupId", "==", groupId),
        where("memberUids", "array-contains", uid)
      )
    ),
    getDocs(
      query(
        collection(db, "groupDms"),
        where("groupId", "==", groupId),
        where("participantUids", "array-contains", uid)
      )
    ),
  ]);

  await runTransaction(db, async (tx) => {
    const memberSnap = await tx.get(memberRef);

    if (!memberSnap.exists()) {
      throw new Error("Member not found.");
    }

    const memberData = memberSnap.data();

    if (memberData.role === "owner") {
      throw new Error(
        "Group owners cannot leave until ownership transfer is supported."
      );
    }

    if (memberData.status !== "active") {
      throw new Error("You are not an active member of this group.");
    }

    conversationSnap.docs.forEach((docSnap) => {
      tx.update(docSnap.ref, {
        memberUids: arrayRemove(uid),
        [`memberMap.${uid}`]: false,
        [`lastReadByUid.${uid}`]: null,
        lastLeftByUid: uid,
        lastLeftAtMs: nowMs,
        updatedAtMs: nowMs,
        updatedAt: serverTimestamp(),
      });
    });

    dmSnap.docs.forEach((docSnap) => {
      tx.update(docSnap.ref, {
        participantUids: arrayRemove(uid),
        [`participantMap.${uid}`]: false,
        [`lastReadByUid.${uid}`]: null,
        lastLeftByUid: uid,
        lastLeftAtMs: nowMs,
        updatedAtMs: nowMs,
        updatedAt: serverTimestamp(),
      });
    });

    tx.update(memberRef, {
      status: "removed",
      removedAtMs: nowMs,
      leftAtMs: nowMs,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });

    tx.set(
      membershipMirrorRef,
      {
        uid,
        groupId,
        status: "removed",
        removedAtMs: nowMs,
        leftAtMs: nowMs,
        updatedAtMs: nowMs,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    createGroupActivityTx(tx, {
      groupId,
      type: "member_left",
      actorUid: uid,
      actorName:
        memberData.displayName ??
        memberData.email ??
        auth.currentUser?.displayName ??
        auth.currentUser?.email ??
        null,
      message: `${
        memberData.displayName ?? memberData.email ?? "A member"
      } left the group`,
      targetUid: uid,
      targetEmail: memberData.email ?? null,
      createdAtMs: nowMs,
    });
  });
};

export const unblockUserFromGroup = async ({
  groupId,
  uid,
  unblockedByUid,
  unblockedByName = null,
  unblockedByEmail = null,
}: {
  groupId: string;
  uid: string;
  unblockedByUid: string;
  unblockedByName?: string | null;
  unblockedByEmail?: string | null;
}) => {
  if (!groupId) throw new Error("Missing group id.");
  if (!uid) throw new Error("Missing user id.");
  if (!unblockedByUid) throw new Error("Missing actor id.");

  const nowMs = Date.now();

  const blockedRef = doc(db, "groups", groupId, "blockedUsers", uid);

  await runTransaction(db, async (tx) => {
    const blockedSnap = await tx.get(blockedRef);

    if (!blockedSnap.exists()) {
      throw new Error("Blocked user not found.");
    }

    const blockedData = blockedSnap.data();

    tx.delete(blockedRef);

    createGroupAdminLogTx(tx, {
      groupId,
      action: "user_unblocked",
      actorUid: unblockedByUid,
      actorName: unblockedByName,
      actorEmail: unblockedByEmail,
      targetUid: uid,
      targetEmail: blockedData.blockedUserEmail ?? null,
      targetName: blockedData.blockedUserDisplayName ?? null,
      message: `Unblocked ${
        blockedData.blockedUserDisplayName ??
        blockedData.blockedUserEmail ??
        "a user"
      }.`,
      metadata: {
        previousReason: blockedData.reason ?? null,
        originallyBlockedByUid: blockedData.blockedByUid ?? null,
      },
      createdAtMs: nowMs,
    });
  });
};

export const updateGroupMemberRole = async ({
  groupId,
  memberUid,
  role,
}: {
  groupId: string;
  memberUid: string;
  role: AssignableGroupRole;
}) => {
  if (!groupId) throw new Error("Missing group id.");
  if (!memberUid) throw new Error("Missing member id.");

 if (!isAssignableGroupRole(role)) {
  throw new Error("Invalid role.");
}
  const nowMs = Date.now();

  const memberRef = doc(db, "groups", groupId, "members", memberUid);
  const membershipMirrorRef = doc(db, "groupMemberships", `${memberUid}_${groupId}`);

  await runTransaction(db, async (tx) => {
    const memberSnap = await tx.get(memberRef);

    if (!memberSnap.exists()) {
      throw new Error("Member not found.");
    }

    const memberData = memberSnap.data();

    if (memberData.role === "owner") {
      throw new Error("Group owner role cannot be changed here.");
    }

    tx.update(memberRef, {
      role,
      updatedAtMs: nowMs,
    });

    tx.update(membershipMirrorRef, {
      role,
      updatedAtMs: nowMs,
    });
    createGroupActivityTx(tx, {
  groupId,
  type: "member_role_changed",
  actorUid: auth.currentUser?.uid ?? "",
  actorName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? null,
  message: `changed ${memberData.displayName ?? memberData.email ?? "a member"} to ${role}`,
  targetUid: memberUid,
  targetEmail: memberData.email ?? null,
  createdAtMs: nowMs,
});
createGroupAdminLogTx(tx, {
  groupId,
  action: "member_role_changed",
  actorUid: auth.currentUser?.uid ?? "",
  actorName: auth.currentUser?.displayName ?? auth.currentUser?.email ?? null,
  actorEmail: auth.currentUser?.email ?? null,
  targetUid: memberUid,
  targetEmail: memberData.email ?? null,
  targetName: memberData.displayName ?? null,
  message: `Changed ${memberData.displayName ?? memberData.email ?? "a member"} from ${memberData.role ?? "unknown"} to ${role}.`,
  metadata: {
    previousRole: memberData.role ?? null,
    nextRole: role,
  },
  createdAtMs: nowMs,
});
  });
};

export const requestToJoinGroup = async ({
  groupId,
  uid,
  email = null,
  displayName = null,
  message = null,
}: {
  groupId: string;
  uid: string;
  email?: string | null;
  displayName?: string | null;
  message?: string | null;
}) => {
  if (!groupId) throw new Error("Missing group id.");
  if (!uid) throw new Error("Missing user id.");
  

  const nowMs = Date.now();
  const trimmedMessage = message?.trim() || null;

  const requestRef = doc(db, "groups", groupId, "joinRequests", uid);
  const existingSnap = await getDoc(requestRef);
  const isExistingRequest = existingSnap.exists();

  const groupSnap = await getDoc(doc(db, "groups", groupId));

const groupData = groupSnap.exists()
  ? groupSnap.data()
  : null;

  await setDoc(
    requestRef,
    {
      groupId,
      uid,
      email,
      groupName: groupData?.name ?? null,
      displayName,
      status: "pending",
      message: trimmedMessage,

      createdAtMs: isExistingRequest
        ? existingSnap.data().createdAtMs ?? nowMs
        : nowMs,

      updatedAtMs: nowMs,

      ...(isExistingRequest ? {} : { createdAt: serverTimestamp() }),

      updatedAt: serverTimestamp(),

      reviewedByUid: null,
      reviewedByName: null,
      reviewedAtMs: null,
    },
    { merge: true }
  );

  try {
    await createJoinRequestInboxItems({
      groupId,
      requestUid: uid,
      requesterName: displayName ?? email ?? null,
      requesterEmail: email,
    });
  } catch (err) {
    console.log("[Groups] join request inbox items failed", err);
  }
};

export const subscribeMyPendingJoinRequests = (
  uid: string,
  onNext: (requests: GroupJoinRequestDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!uid) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collectionGroup(db, "joinRequests"),
    where("uid", "==", uid),
    where("status", "==", "pending"),
    orderBy("createdAtMs", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const requests = snap.docs.map((docSnap) => {
        const parentGroupRef = docSnap.ref.parent.parent;
        const groupId = parentGroupRef?.id ?? "";

        return mapGroupJoinRequestDoc(docSnap.id, groupId, docSnap.data());
      });

      onNext(requests);
    },
    (err) => {
      console.log("[Groups] subscribeMyPendingJoinRequests failed", err);
      onError?.(err);
    }
  );
};

export const subscribeMyJoinRequestForGroup = (
  groupId: string,
  uid: string,
  onNext: (request: GroupJoinRequestDoc | null) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!groupId || !uid) {
    onNext(null);
    return () => {};
  }

  const ref = doc(db, "groups", groupId, "joinRequests", uid);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onNext(null);
        return;
      }

      onNext(mapGroupJoinRequestDoc(snap.id, groupId, snap.data()));
    },
    (err) => {
      console.log("[Groups] subscribeMyJoinRequestForGroup failed", err);
      onError?.(err);
    }
  );
};

export const cancelJoinRequest = async ({
  groupId,
  uid,
}: {
  groupId: string;
  uid: string;
}) => {
  if (!groupId) throw new Error("Missing group id.");
  if (!uid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  await updateDoc(doc(db, "groups", groupId, "joinRequests", uid), {
    status: "cancelled",
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
};

export const subscribePendingJoinRequests = (
  groupId: string,
  onNext: (requests: GroupJoinRequestDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!groupId) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collection(db, "groups", groupId, "joinRequests"),
    where("status", "==", "pending"),
    orderBy("createdAtMs", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const requests = snap.docs.map((docSnap) =>
        mapGroupJoinRequestDoc(docSnap.id, groupId, docSnap.data())
      );

      onNext(requests);
    },
    (err) => {
      console.log("[Groups] subscribePendingJoinRequests failed", err);
      onError?.(err);
    }
  );
};

export const approveJoinRequest = async ({
  groupId,
  requestUid,
  reviewedByUid,
  reviewedByName = null,
}: {
  groupId: string;
  requestUid: string;
  reviewedByUid: string;
  reviewedByName?: string | null;
}) => {
  if (!groupId) throw new Error("Missing group id.");
  if (!requestUid) throw new Error("Missing request user id.");
  if (!reviewedByUid) throw new Error("Missing reviewer id.");

  const nowMs = Date.now();

  const groupRef = doc(db, "groups", groupId);
  const requestRef = doc(db, "groups", groupId, "joinRequests", requestUid);
  const memberRef = doc(db, "groups", groupId, "members", requestUid);
  const membershipMirrorRef = doc(db, "groupMemberships", `${requestUid}_${groupId}`);

  await runTransaction(db, async (tx) => {
    const groupSnap = await tx.get(groupRef);
    const requestSnap = await tx.get(requestRef);
    const memberSnap = await tx.get(memberRef);

    if (!groupSnap.exists()) {
      throw new Error("Group not found.");
    }

    if (!requestSnap.exists()) {
      throw new Error("Join request not found.");
    }

    const groupData = groupSnap.data();
    const requestData = requestSnap.data();

    const blockedRef = doc(
  db,
  "groups",
  groupId,
  "blockedUsers",
  requestUid
);

const blockedSnap = await tx.get(blockedRef);

if (blockedSnap.exists()) {
  throw new Error("This user is blocked from the group.");
}

    if (requestData.status !== "pending") {
      throw new Error("This join request is no longer pending.");
    }

    if (groupData.joinPolicy !== "request") {
      throw new Error("This group is not using request-to-join.");
    }

    if (memberSnap.exists() && memberSnap.data().status === "active") {
      throw new Error("This user is already a group member.");
    }

    const groupName =
      typeof groupData.name === "string" && groupData.name.trim()
        ? groupData.name.trim()
        : "Untitled group";

    const email =
      typeof requestData.email === "string" ? requestData.email : null;

    const displayName =
      typeof requestData.displayName === "string"
        ? requestData.displayName
        : null;

    tx.set(
      memberRef,
      {
        uid: requestUid,
        email,
        displayName,
        role: "member",
        status: "active",
        joinedAtMs: nowMs,
        joinedAt: serverTimestamp(),
        invitedByUid: null,
        joinSource: "request_approved",
        approvedByUid: reviewedByUid,
      },
      { merge: true }
    );

    tx.set(
      membershipMirrorRef,
      {
        groupId,
        groupName,
        uid: requestUid,
        email,
        displayName,
        role: "member",
        status: "active",
        joinedAtMs: nowMs,
        joinedAt: serverTimestamp(),
        invitedByUid: null,
        joinSource: "request_approved",
        approvedByUid: reviewedByUid,
      },
      { merge: true }
    );

    tx.update(groupRef, {
  memberCount: increment(1),
  lastApprovedJoinUid: requestUid,
  lastActivityAtMs: nowMs,
  updatedAtMs: nowMs,
  updatedAt: serverTimestamp(),
});

   tx.update(requestRef, {
  status: "approved",
  reviewedByUid,
  reviewedByName,
  reviewedAtMs: nowMs,
  updatedAtMs: nowMs,
  updatedAt: serverTimestamp(),
});
  });

  try {
    await createGroupActivity({
      groupId,
      type: "invite_accepted",
      actorUid: requestUid,
      actorName: reviewedByName ?? null,
      message: `approved a join request`,
      targetUid: requestUid,
    });
  } catch (err) {
    console.log("[Groups] approve join request activity failed", err);
  }
};

export const declineJoinRequest = async ({
  groupId,
  requestUid,
  reviewedByUid,
  reviewedByName = null,
}: {
  groupId: string;
  requestUid: string;
  reviewedByUid: string;
  reviewedByName?: string | null;
}) => {
  if (!groupId) throw new Error("Missing group id.");
  if (!requestUid) throw new Error("Missing request user id.");
  if (!reviewedByUid) throw new Error("Missing reviewer id.");

  const nowMs = Date.now();

  const requestRef = doc(db, "groups", groupId, "joinRequests", requestUid);

  await updateDoc(requestRef, {
    status: "declined",
    reviewedByUid,
    reviewedByName,
    reviewedAtMs: nowMs,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
};

export const joinOpenGroup = async ({
  groupId,
  uid,
  email = null,
  displayName = null,
  groupName = null,
}: {
  groupId: string;
  uid: string;
  email?: string | null;
  displayName?: string | null;
  groupName?: string | null;
}) => {
  if (!groupId) throw new Error("Missing group id.");
  if (!uid) throw new Error("Missing user id.");

    const blocked = await isUserBlockedFromGroup({
    groupId,
    uid,
  });

  if (blocked) {
    throw new Error("You can no longer join this group.");
  }

  const nowMs = Date.now();

  const groupRef = doc(db, "groups", groupId);
  const memberRef = doc(db, "groups", groupId, "members", uid);
  const membershipMirrorRef = doc(db, "groupMemberships", `${uid}_${groupId}`);

  await runTransaction(db, async (tx) => {
    const groupSnap = await tx.get(groupRef);
    const memberSnap = await tx.get(memberRef);

    if (!groupSnap.exists()) {
      throw new Error("Group not found.");
    }

    const groupData = groupSnap.data();

    if (groupData.visibility !== "searchable") {
      throw new Error("This group is not open for discovery joining.");
    }

    if (groupData.discoverable !== true) {
      throw new Error("This group is not open for discovery joining.");
    }

    if (groupData.isHiddenFromDiscovery === true) {
      throw new Error("This group is not available.");
    }

    if (groupData.joinPolicy !== "open") {
      throw new Error("This group does not allow open joining.");
    }

    if (memberSnap.exists() && memberSnap.data().status === "active") {
      throw new Error("You are already a member of this group.");
    }

    const resolvedGroupName =
      typeof groupData.name === "string" && groupData.name.trim()
        ? groupData.name.trim()
        : groupName ?? "Untitled group";

    tx.set(
      memberRef,
      {
        uid,
        email,
        displayName,
        role: "member",
        status: "active",
        joinedAtMs: nowMs,
        joinedAt: serverTimestamp(),
        invitedByUid: null,
        joinSource: "open_discovery",
      },
      { merge: true }
    );

    tx.set(
      membershipMirrorRef,
      {
        groupId,
        groupName: resolvedGroupName,
        uid,
        email,
        displayName,
        role: "member",
        status: "active",
        joinedAtMs: nowMs,
        joinedAt: serverTimestamp(),
        invitedByUid: null,
        joinSource: "open_discovery",
      },
      { merge: true }
    );

    tx.update(groupRef, {
      memberCount: increment(1),
      lastActivityAtMs: nowMs,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });


  
    });

  try {
    await createGroupActivity({
      groupId,
      type: "invite_accepted",
      actorUid: uid,
      actorName: displayName ?? email ?? null,
      message: `joined ${groupName ?? "the group"}`,
      targetUid: uid,
      targetEmail: email ?? null,
    });
  } catch (err) {
    console.log("[Groups] open join activity failed", err);
  }
};

export const createGroupInvite = async ({
  groupId,
  invitedEmail,
  invitedByUid,
  invitedByName = null,
  role = "member",
}: {
  groupId: string;
  invitedEmail: string;
  invitedByUid: string;
  invitedByName?: string | null;
  role?: AssignableGroupRole;
}) => {
  const normalizedEmail = normalizeInviteEmail(invitedEmail);

  if (!groupId) throw new Error("Missing group id.");
  if (!invitedByUid) throw new Error("Missing inviter id.");
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("Enter a valid email address.");
  }
 if (!isAssignableGroupRole(role)) {
  throw new Error("Invalid invite role.");
}

  const groupRef = doc(db, "groups", groupId);
  const groupSnap = await getDoc(groupRef);

  if (!groupSnap.exists()) {
    throw new Error("Group not found.");
  }

  const groupData = groupSnap.data();
  const groupName =
    typeof groupData.name === "string" && groupData.name.trim()
      ? groupData.name.trim()
      : "Untitled group";

  const nowMs = Date.now();
  const expiresAtMs = nowMs + 14 * 24 * 60 * 60 * 1000;

 const inviteRef = await addDoc(collection(db, "groups", groupId, "invites"), {
  groupId,
  groupName,
  invitedEmail: normalizedEmail,
  invitedByUid,
  invitedByName,
  role,
  status: "pending",
  createdAtMs: nowMs,
  expiresAtMs,
  createdAt: serverTimestamp(),
});

  const mirrorRef = doc(
    db,
    "userGroupInvites",
    `${emailToDocSafeId(normalizedEmail)}_${inviteRef.id}`
  );

await setDoc(mirrorRef, {
  inviteId: inviteRef.id,
  groupId,
  groupName,
  invitedEmail: normalizedEmail,
  invitedByUid,
  invitedByName,
  role,
  status: "pending",
  createdAtMs: nowMs,
  expiresAtMs,
  createdAt: serverTimestamp(),
});

await runTransaction(db, async (tx) => {
  createGroupActivityTx(tx, {
    groupId,
    type: "invite_created",
    actorUid: invitedByUid,
    actorName: invitedByName,
    message: `invited ${normalizedEmail} as ${role}`,
    targetEmail: normalizedEmail,
    createdAtMs: nowMs,
  });

  createGroupAdminLogTx(tx, {
    groupId,
    action: "invite_created",
    actorUid: invitedByUid,
    actorName: invitedByName,
    actorEmail: null,
    targetUid: null,
    targetEmail: normalizedEmail,
    targetName: null,
    message: `Created invite for ${normalizedEmail} as ${role}.`,
    metadata: {
      inviteId: inviteRef.id,
      invitedRole: role,
      expiresAtMs,
    },
    createdAtMs: nowMs,
  });
});



return inviteRef.id;
};

export const acceptGroupInvite = async ({
  invite,
  uid,
  email,
  displayName = null,
}: {
  invite: GroupInviteDoc;
  uid: string;
  email?: string | null;
  displayName?: string | null;
}) => {
  if (!uid) throw new Error("Missing user id.");
  if (!email) throw new Error("Your account does not have an email address.");

  const normalizedEmail = normalizeInviteEmail(email);

  if (normalizeInviteEmail(invite.invitedEmail) !== normalizedEmail) {
    throw new Error("This invite is not for your account email.");
  }

  const blocked = await isUserBlockedFromGroup({
  groupId: invite.groupId,
  uid,
});

if (blocked) {
  throw new Error(
    "You can no longer join this group."
  );
}

  const nowMs = Date.now();

  const groupInviteRef = doc(
    db,
    "groups",
    invite.groupId,
    "invites",
    invite.id
  );

  const mirrorRef = doc(
    db,
    "userGroupInvites",
    `${emailToDocSafeId(normalizedEmail)}_${invite.id}`
  );

  const memberRef = doc(db, "groups", invite.groupId, "members", uid);
  const membershipMirrorRef = doc(
    db,
    "groupMemberships",
    `${uid}_${invite.groupId}`
  );

  await runTransaction(db, async (tx) => {
    const inviteSnap = await tx.get(groupInviteRef);
    const mirrorSnap = await tx.get(mirrorRef);

    if (!inviteSnap.exists()) {
      throw new Error("Invite not found.");
    }

    if (!mirrorSnap.exists()) {
      throw new Error("Invite mirror not found.");
    }

    const inviteData = inviteSnap.data();

    if (inviteData.status !== "pending") {
      throw new Error("Invite is no longer pending.");
    }

    if (normalizeInviteEmail(inviteData.invitedEmail ?? "") !== normalizedEmail) {
      throw new Error("Invite email does not match your account.");
    }

tx.set(
  memberRef,
  {
    uid,
    email: normalizedEmail,
    displayName,
    role: invite.role ?? "member",
    status: "active",
    joinedAtMs: nowMs,
    joinedAt: serverTimestamp(),
    invitedByUid: invite.invitedByUid,
    inviteId: invite.id,
  },
  { merge: true }
);

tx.set(
  membershipMirrorRef,
  {
    groupId: invite.groupId,
    groupName: invite.groupName,
    uid,
    email: normalizedEmail,
    displayName,
    role: invite.role ?? "member",
    status: "active",
    joinedAtMs: nowMs,
    joinedAt: serverTimestamp(),
    invitedByUid: invite.invitedByUid,
    inviteId: invite.id,
  },
  { merge: true }
);

    tx.update(groupInviteRef, {
      status: "accepted",
      acceptedAtMs: nowMs,
      acceptedByUid: uid,
      updatedAtMs: nowMs,
    });

    tx.update(mirrorRef, {
      status: "accepted",
      acceptedAtMs: nowMs,
      acceptedByUid: uid,
      updatedAtMs: nowMs,
    });
    
  });
  await createGroupActivity({
  groupId: invite.groupId,
  type: "invite_accepted",
  actorUid: uid,
    actorName: displayName ?? normalizedEmail,
  message: `joined ${invite.groupName}`,
  targetUid: uid,
  targetEmail: normalizedEmail,
});
};

export const declineGroupInvite = async ({
  invite,
  email,
  displayName = null,
}: {
  invite: GroupInviteDoc;
  email?: string | null;
  displayName?: string | null;
}) => {
  if (!email) throw new Error("Your account does not have an email address.");

  const normalizedEmail = normalizeInviteEmail(email);

  if (normalizeInviteEmail(invite.invitedEmail) !== normalizedEmail) {
    throw new Error("This invite is not for your account email.");
  }

  const nowMs = Date.now();

  const groupInviteRef = doc(
    db,
    "groups",
    invite.groupId,
    "invites",
    invite.id
  );

  const mirrorRef = doc(
    db,
    "userGroupInvites",
    `${emailToDocSafeId(normalizedEmail)}_${invite.id}`
  );

  await runTransaction(db, async (tx) => {
    const inviteSnap = await tx.get(groupInviteRef);
    const mirrorSnap = await tx.get(mirrorRef);

    if (!inviteSnap.exists()) {
      throw new Error("Invite not found.");
    }

    if (!mirrorSnap.exists()) {
      throw new Error("Invite mirror not found.");
    }

    const inviteData = inviteSnap.data();

    if (inviteData.status !== "pending") {
      throw new Error("Invite is no longer pending.");
    }

    if (normalizeInviteEmail(inviteData.invitedEmail ?? "") !== normalizedEmail) {
      throw new Error("Invite email does not match your account.");
    }

    tx.update(groupInviteRef, {
      status: "declined",
      declinedAtMs: nowMs,
      updatedAtMs: nowMs,
    });

    tx.update(mirrorRef, {
      status: "declined",
      declinedAtMs: nowMs,
      updatedAtMs: nowMs,
    });
  });
};

export const subscribeGroupInvites = (
  groupId: string,
  onNext: (invites: GroupInviteDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(db, "groups", groupId, "invites"),
    where("status", "==", "pending")
  );

  return onSnapshot(
    q,
    (snap) => {
      const invites: GroupInviteDoc[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();

        invites.push({
          id: docSnap.id,
          groupId: data.groupId ?? groupId,
          groupName: data.groupName ?? "Untitled group",
          invitedEmail: data.invitedEmail ?? "",
          invitedByUid: data.invitedByUid ?? "",
          invitedByName: data.invitedByName ?? null,
          role: data.role ?? "member",
          status: data.status ?? "pending",
          createdAtMs: data.createdAtMs ?? 0,
          expiresAtMs: data.expiresAtMs ?? null,
        });
      });

      invites.sort((a, b) => b.createdAtMs - a.createdAtMs);
      onNext(invites);
    },
    (err) => {
      console.log("[Groups] subscribeGroupInvites failed", err);
      onError?.(err);
    }
  );
};
export const subscribeMyPendingGroupInvites = (
  email: string,
  onNext: (invites: GroupInviteDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const normalizedEmail = normalizeInviteEmail(email);

  const q = query(
    collection(db, "userGroupInvites"),
    where("invitedEmail", "==", normalizedEmail),
    where("status", "==", "pending")
  );

  return onSnapshot(
    q,
    (snap) => {
      const invites: GroupInviteDoc[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();

        invites.push({
          id: data.inviteId ?? docSnap.id,
          groupId: data.groupId,
          groupName: data.groupName ?? "Untitled group",
          invitedEmail: data.invitedEmail ?? normalizedEmail,
          invitedByUid: data.invitedByUid ?? "",
          invitedByName: data.invitedByName ?? null,
          role: data.role ?? "member",
          status: data.status ?? "pending",
          createdAtMs: data.createdAtMs ?? 0,
          expiresAtMs: data.expiresAtMs ?? null,
        });
      });

      invites.sort((a, b) => b.createdAtMs - a.createdAtMs);
      onNext(invites);
    },
    (err) => {
      console.log("[Groups] subscribeMyPendingGroupInvites failed", err);
      onError?.(err);
    }
  );
};
export const shareGoalToGroup = async ({
  goalId,
  groupId,
  ownerUserId,
  sharedByUid,
  sharedByName = null,
}: {
  goalId: string;
  groupId: string;
  ownerUserId: string;
  sharedByUid: string;
  sharedByName?: string | null;
}) => {
  if (!goalId) throw new Error("Missing goal id.");
  if (!groupId) throw new Error("Missing group id.");
  if (!ownerUserId) throw new Error("Missing goal owner id.");
  if (!sharedByUid) throw new Error("Missing sharing user id.");

  const nowMs = Date.now();

  const goalRef = doc(db, "goals", goalId);
  const sharedGoalRef = doc(db, "groups", groupId, "sharedGoals", goalId);

  await runTransaction(db, async (tx) => {
    const goalSnap = await tx.get(goalRef);

    if (!goalSnap.exists()) {
      throw new Error("Goal not found.");
    }

    const goalData = goalSnap.data();

    if (goalData.userId !== ownerUserId) {
      throw new Error("Goal owner mismatch.");
    }

    tx.update(goalRef, {
      visibility: "group_shared",
      sharedGroupIds: arrayUnion(groupId),
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });

    tx.set(
  sharedGoalRef,
  {
    goalId,
    groupId,
    ownerUserId,
    sharedByUid,
    goalTitle:
      typeof goalData.title === "string" && goalData.title.trim()
        ? goalData.title.trim()
        : "Untitled goal",
    goalDescription:
      typeof goalData.description === "string" && goalData.description.trim()
        ? goalData.description.trim()
        : null,
        goalStatus:
  typeof goalData.status === "string" ? goalData.status : "active",
metricType:
  typeof goalData.metricType === "string" ? goalData.metricType : "none",
metricUnit:
  typeof goalData.metricUnit === "string" ? goalData.metricUnit : null,
metricTargetValue:
  typeof goalData.metricTargetValue === "number"
    ? goalData.metricTargetValue
    : null,
currentMetricValue:
  typeof goalData.currentMetricValue === "number"
    ? goalData.currentMetricValue
    : null,
progressPercentage:
  typeof goalData.progressPercentage === "number"
    ? goalData.progressPercentage
    : 0,
    status: "active",
    sharedAtMs: nowMs,
    updatedAtMs: nowMs,
    sharedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  },
  { merge: true }
);
const goalTitle =
  typeof goalData.title === "string" && goalData.title.trim()
    ? goalData.title.trim()
    : "Untitled goal";

createGroupActivityTx(tx, {
  groupId,
  type: "goal_shared",
  actorUid: sharedByUid,
  actorName: sharedByName,
  message: `shared "${goalTitle}"`,
  goalId,
  goalTitle,
  createdAtMs: nowMs,
});
  });
};

export const createGroupTask = async (params: {
  groupId: string;
  title: string;
  description?: string | null;
  priority?: GroupTaskPriority | null;
  dueAtMs?: number | null;

  createdByUid: string;
  createdByName?: string | null;
  createdByEmail?: string | null;

  linkedGoalId?: string | null;
  linkedGoalTitle?: string | null;
  linkedSubtaskId?: string | null;
  linkedSubtaskTitle?: string | null;

}) => {
  const trimmedTitle = params.title.trim();
  const trimmedDescription = params.description?.trim() || null;

  if (!params.groupId) throw new Error("Missing group id.");
  if (!trimmedTitle) throw new Error("Task title is required.");
  if (!params.createdByUid) throw new Error("Missing creator id.");

  if (
    params.priority != null &&
    !["low", "medium", "high"].includes(params.priority)
  ) {
    throw new Error("Invalid task priority.");
  }

  const nowMs = Date.now();

  const taskRef = doc(collection(db, "groups", params.groupId, "tasks"));

  await setDoc(taskRef, {
    groupId: params.groupId,
    title: trimmedTitle,
    description: trimmedDescription,
    status: "unclaimed",
    priority: params.priority ?? null,

    createdByUid: params.createdByUid,
    createdByName: params.createdByName ?? null,
    createdByEmail: params.createdByEmail ?? null,

    claimedByUid: null,
    claimedByName: null,
    claimedByEmail: null,
    claimedAtMs: null,

    assignedToUid: null,
    assignedToName: null,
    assignedToEmail: null,
    assignedAtMs: null,

    dueAtMs:
      typeof params.dueAtMs === "number" ? params.dueAtMs : null,

    linkedGoalId: params.linkedGoalId ?? null,
    linkedGoalTitle: params.linkedGoalTitle ?? null,
    linkedSubtaskId: params.linkedSubtaskId ?? null,
    linkedSubtaskTitle: params.linkedSubtaskTitle ?? null,

    completedByUid: null,
    completedByName: null,
    completedAtMs: null,

    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await createGroupActivity({
    groupId: params.groupId,
    type: "note_created",
    actorUid: params.createdByUid,
    actorName: params.createdByName ?? params.createdByEmail ?? null,
    message: `added "${trimmedTitle}" to the shared task pool`,
    goalId: params.linkedGoalId ?? null,
    goalTitle: params.linkedGoalTitle ?? null,
    taskId: taskRef.id,
taskTitle: trimmedTitle,
  });

  return taskRef.id;
};

export const claimGroupTask = async (params: {
  groupId: string;
  taskId: string;
  claimedByUid: string;
  claimedByName?: string | null;
  claimedByEmail?: string | null;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.taskId) throw new Error("Missing task id.");
  if (!params.claimedByUid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  const taskRef = doc(
    db,
    "groups",
    params.groupId,
    "tasks",
    params.taskId
  );

  await runTransaction(db, async (tx) => {
    const taskSnap = await tx.get(taskRef);

    if (!taskSnap.exists()) {
      throw new Error("Task not found.");
    }

    const taskData = taskSnap.data();

    if (taskData.status !== "unclaimed") {
      throw new Error("This task has already been claimed.");
    }

    tx.update(taskRef, {
      status: "claimed",
      claimedByUid: params.claimedByUid,
      claimedByName: params.claimedByName ?? null,
      claimedByEmail: params.claimedByEmail ?? null,
      claimedAtMs: nowMs,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });

    createGroupActivityTx(tx, {
      groupId: params.groupId,
      type: "note_created",
      actorUid: params.claimedByUid,
      actorName:
        params.claimedByName ?? params.claimedByEmail ?? null,
      message: `claimed "${
        typeof taskData.title === "string" && taskData.title.trim()
          ? taskData.title.trim()
          : "a shared task"
      }" from the shared task pool`,
      createdAtMs: nowMs,
      taskId: params.taskId,
taskTitle:
  typeof taskData.title === "string" && taskData.title.trim()
    ? taskData.title.trim()
    : null,
    });
  });
};

export const releaseGroupTask = async (params: {
  groupId: string;
  taskId: string;
  releasedByUid: string;
  releasedByName?: string | null;
  releasedByEmail?: string | null;
  
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.taskId) throw new Error("Missing task id.");
  if (!params.releasedByUid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  const taskRef = doc(
    db,
    "groups",
    params.groupId,
    "tasks",
    params.taskId
  );

  await runTransaction(db, async (tx) => {
    const taskSnap = await tx.get(taskRef);

    if (!taskSnap.exists()) {
      throw new Error("Task not found.");
    }

    const taskData = taskSnap.data();

    if (
      taskData.status !== "claimed" &&
      taskData.status !== "in_progress"
    ) {
      throw new Error("Only claimed tasks can be released.");
    }

    if (
      taskData.claimedByUid &&
      taskData.claimedByUid !== params.releasedByUid
    ) {
      throw new Error("Only the person who claimed this task can release it.");
    }

    tx.update(taskRef, {
      status: "unclaimed",
      claimedByUid: null,
      claimedByName: null,
      claimedByEmail: null,
      claimedAtMs: null,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });

    createGroupActivityTx(tx, {
      groupId: params.groupId,
      type: "note_created",
      actorUid: params.releasedByUid,
      actorName:
        params.releasedByName ?? params.releasedByEmail ?? null,
      message: `released "${
        typeof taskData.title === "string" && taskData.title.trim()
          ? taskData.title.trim()
          : "a shared task"
      }" back to the shared task pool`,
      createdAtMs: nowMs,
      taskId: params.taskId,
taskTitle:
  typeof taskData.title === "string" && taskData.title.trim()
    ? taskData.title.trim()
    : null,
    });
  });
};

export const completeGroupTask = async (params: {
  groupId: string;
  taskId: string;
  completedByUid: string;
  completedByName?: string | null;
  completedByEmail?: string | null;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.taskId) throw new Error("Missing task id.");
  if (!params.completedByUid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  const taskRef = doc(
    db,
    "groups",
    params.groupId,
    "tasks",
    params.taskId
  );

  await runTransaction(db, async (tx) => {
    const taskSnap = await tx.get(taskRef);

    if (!taskSnap.exists()) {
      throw new Error("Task not found.");
    }

    const taskData = taskSnap.data();

    if (
      taskData.status !== "claimed" &&
      taskData.status !== "in_progress"
    ) {
      throw new Error("Only claimed tasks can be completed.");
    }

    if (
      taskData.claimedByUid &&
      taskData.claimedByUid !== params.completedByUid
    ) {
      throw new Error("Only the person who claimed this task can complete it.");
    }

    tx.update(taskRef, {
      status: "completed",
      completedByUid: params.completedByUid,
      completedByName:
        params.completedByName ?? params.completedByEmail ?? null,
      completedAtMs: nowMs,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });

    createGroupActivityTx(tx, {
      groupId: params.groupId,
      type: "subtask_completed",
      actorUid: params.completedByUid,
      actorName:
        params.completedByName ?? params.completedByEmail ?? null,
      message: `completed "${
        typeof taskData.title === "string" && taskData.title.trim()
          ? taskData.title.trim()
          : "a shared task"
      }" from the shared task pool`,
      createdAtMs: nowMs,
      taskId: params.taskId,
taskTitle:
  typeof taskData.title === "string" && taskData.title.trim()
    ? taskData.title.trim()
    : null,
    });
  });
};

export const reopenGroupTask = async (params: {
  groupId: string;
  taskId: string;
  reopenedByUid: string;
  reopenedByName?: string | null;
  reopenedByEmail?: string | null;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.taskId) throw new Error("Missing task id.");
  if (!params.reopenedByUid) throw new Error("Missing user id.");

  const nowMs = Date.now();

  const taskRef = doc(
    db,
    "groups",
    params.groupId,
    "tasks",
    params.taskId
  );

  await runTransaction(db, async (tx) => {
    const taskSnap = await tx.get(taskRef);

    if (!taskSnap.exists()) {
      throw new Error("Task not found.");
    }

    const taskData = taskSnap.data();

    if (taskData.status !== "completed") {
      throw new Error("Only completed tasks can be reopened.");
    }

    tx.update(taskRef, {
      status: "unclaimed",
      claimedByUid: null,
      claimedByName: null,
      claimedByEmail: null,
      claimedAtMs: null,
      completedByUid: null,
      completedByName: null,
      completedAtMs: null,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });

    createGroupActivityTx(tx, {
      groupId: params.groupId,
      type: "note_created",
      actorUid: params.reopenedByUid,
      actorName:
        params.reopenedByName ?? params.reopenedByEmail ?? null,
      message: `reopened "${
        typeof taskData.title === "string" && taskData.title.trim()
          ? taskData.title.trim()
          : "a shared task"
      }" in the shared task pool`,
      createdAtMs: nowMs,
      taskId: params.taskId,
taskTitle:
  typeof taskData.title === "string" && taskData.title.trim()
    ? taskData.title.trim()
    : null,
    });
  });
};

export const updateGroupTaskPlanning = async (params: {
  groupId: string;
  taskId: string;
  updatedByUid: string;
  updatedByName?: string | null;
  updatedByEmail?: string | null;
  priority?: GroupTaskPriority | null;
  dueAtMs?: number | null;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.taskId) throw new Error("Missing task id.");
  if (!params.updatedByUid) throw new Error("Missing user id.");

  if (
    params.priority != null &&
    !["low", "medium", "high"].includes(params.priority)
  ) {
    throw new Error("Invalid task priority.");
  }

  const nowMs = Date.now();
  const taskRef = doc(db, "groups", params.groupId, "tasks", params.taskId);

  await runTransaction(db, async (tx) => {
    const taskSnap = await tx.get(taskRef);

    if (!taskSnap.exists()) {
      throw new Error("Task not found.");
    }

    const taskData = taskSnap.data();
    const taskTitle =
      typeof taskData.title === "string" && taskData.title.trim()
        ? taskData.title.trim()
        : "a shared task";

    tx.update(taskRef, {
      priority: params.priority ?? null,
      dueAtMs: typeof params.dueAtMs === "number" ? params.dueAtMs : null,
      updatedAtMs: nowMs,
      updatedAt: serverTimestamp(),
    });

    createGroupActivityTx(tx, {
      groupId: params.groupId,
      type: "note_created",
      actorUid: params.updatedByUid,
      actorName: params.updatedByName ?? params.updatedByEmail ?? null,
      taskId: params.taskId,
      taskTitle,
      message: `updated planning for "${taskTitle}" in the shared task pool`,
      createdAtMs: nowMs,
    });
  });
};

export const subscribeGroupTasks = (
  groupId: string,
  onNext: (tasks: GroupTaskDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(db, "groups", groupId, "tasks"),
    orderBy("updatedAtMs", "desc")
  );

  return onSnapshot(
    q,
    (snap) => {
      const tasks: GroupTaskDoc[] = [];

      snap.forEach((docSnap) => {
        tasks.push(
          mapGroupTaskDoc(docSnap.id, groupId, docSnap.data())
        );
      });

      onNext(tasks);
    },
    (err) => {
      console.log("[Groups] subscribeGroupTasks failed", err);
      onError?.(err);
    }
  );
};

export const subscribeGroupTask = (
  groupId: string,
  taskId: string,
  onNext: (task: GroupTaskDoc | null) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!groupId || !taskId) {
    onNext(null);
    return () => {};
  }

  const ref = doc(db, "groups", groupId, "tasks", taskId);

  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onNext(null);
        return;
      }

      onNext(mapGroupTaskDoc(snap.id, groupId, snap.data()));
    },
    (err) => {
      console.log("[Groups] subscribeGroupTask failed", err);
      onError?.(err);
    }
  );
};

export const createGroupInboxItem = async (params: {
  uid: string;
  groupId: string;
  type: GroupInboxItemType;
  title: string;
  body?: string | null;
  goalId?: string | null;
    dmId?: string | null;
  goalTitle?: string | null;
  subtaskId?: string | null;
  subtaskTitle?: string | null;
  boardId?: string | null;
  boardTitle?: string | null;
  cardId?: string | null;
  cardTitle?: string | null;
  actorUid?: string | null;
  actorName?: string | null;
  idempotencyKey?: string | null;
  reportId?: string | null;
moderation?: boolean;
  groupKey?: string | null;
  joinRequest?: boolean;
joinRequestUid?: string | null;
relatedEntityType?: "goal" | "task" | "group" | "dm" | "bulletin" | "planning_board" | null;
relatedEntityId?: string | null;
}) => {
  if (!params.uid) throw new Error("Missing target user id.");
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.title.trim()) throw new Error("Missing inbox title.");

  const nowMs = Date.now();

 const ref = params.idempotencyKey
  ? doc(db, "users", params.uid, "groupInbox", params.idempotencyKey)
  : doc(collection(db, "users", params.uid, "groupInbox"));

  await setDoc(ref, {
    uid: params.uid,
    groupId: params.groupId,
    type: params.type,
    title: params.title.trim(),
    body: params.body ?? null,
    dmId: params.dmId ?? null,
    goalId: params.goalId ?? null,
    goalTitle: params.goalTitle ?? null,
    subtaskId: params.subtaskId ?? null,
    subtaskTitle: params.subtaskTitle ?? null,
    boardId: params.boardId ?? null,
    boardTitle: params.boardTitle ?? null,
    cardId: params.cardId ?? null,
    cardTitle: params.cardTitle ?? null,
    actorUid: params.actorUid ?? null,
    actorName: params.actorName ?? null,
    idempotencyKey: params.idempotencyKey ?? null,
    reportId: params.reportId ?? null,
moderation: params.moderation === true,
groupKey: params.groupKey ?? null,
relatedEntityType: params.relatedEntityType ?? null,
relatedEntityId: params.relatedEntityId ?? null,
readAtMs: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return ref.id;
};

export const subscribeMyGroupInbox = (
  uid: string,
  onNext: (items: GroupInboxItemDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  const q = query(
    collection(db, "users", uid, "groupInbox"),
    orderBy("createdAtMs", "desc"),
    limit(20)
  );

  return onSnapshot(
    q,
    (snap) => {
      onNext(
        snap.docs.map((docSnap) =>
          mapGroupInboxItemDoc(docSnap.id, docSnap.data())
        )
      );
    },
    (err) => {
      console.log("[Groups] subscribeMyGroupInbox failed", err);
      onError?.(err);
    }
  );
};

export const fetchMyGroupInboxPage = async (params: {
  uid: string;
  pageSize?: number;
  cursorCreatedAtMs?: number | null;
}): Promise<{
  items: GroupInboxItemDoc[];
  nextCursorCreatedAtMs: number | null;
  hasMore: boolean;
}> => {
  if (!params.uid) {
    return {
      items: [],
      nextCursorCreatedAtMs: null,
      hasMore: false,
    };
  }

  const pageSize = params.pageSize ?? 20;
  const fetchSize = pageSize + 1;

  const baseConstraints = [
    orderBy("createdAtMs", "desc"),
    ...(typeof params.cursorCreatedAtMs === "number"
      ? [startAfter(params.cursorCreatedAtMs)]
      : []),
    limit(fetchSize),
  ];

  const q = query(
    collection(db, "users", params.uid, "groupInbox"),
    ...baseConstraints
  );

  const snap = await getDocs(q);

  const docs = snap.docs.slice(0, pageSize);

  const items = docs.map((docSnap) =>
    mapGroupInboxItemDoc(docSnap.id, docSnap.data())
  );

  const lastItem = items[items.length - 1] ?? null;

  return {
    items,
    nextCursorCreatedAtMs: lastItem?.createdAtMs ?? null,
    hasMore: snap.docs.length > pageSize,
  };
};

export const markGroupInboxItemRead = async (params: {
  uid: string;
  itemId: string;
}) => {
  if (!params.uid) throw new Error("Missing user id.");
  if (!params.itemId) throw new Error("Missing inbox item id.");

  const nowMs = Date.now();

  await updateDoc(doc(db, "users", params.uid, "groupInbox", params.itemId), {
    readAtMs: nowMs,
    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
};

export const markAllGroupInboxItemsRead = async (params: {
  uid: string;
  items: GroupInboxItemDoc[];
}) => {
  if (!params.uid) throw new Error("Missing user id.");

  const unreadItems = params.items.filter((item) => !item.readAtMs);

  await Promise.all(
    unreadItems.map((item) =>
      markGroupInboxItemRead({
        uid: params.uid,
        itemId: item.id,
      })
    )
  );
};
export const createGroupReport = async ({
  groupId,
  targetType,
  targetId,
  goalId = null,
  taskId = null,
  commentId = null,
  activityId = null,
  bulletinId = null,
  reason,
    dmId = null,
  note = null,
   conversationId = null,
  reporterUid,
  targetAuthorUid = null,
targetAuthorName = null,
 targetPreviewTitle = null,
  targetPreviewBody = null,
  reporterName = null,
  reporterEmail = null,
}: Omit<
  GroupReportDoc,
  | "id"
  | "status"
  | "reviewedByUid"
  | "reviewedByName"
  | "reviewedAtMs"
  | "resolutionNote"
  | "createdAtMs"
  | "updatedAtMs"
>) => {
  if (!groupId) throw new Error("Missing group id.");
  if (!targetType) throw new Error("Missing report target type.");
  if (!targetId) throw new Error("Missing report target id.");
  if (!reason) throw new Error("Missing report reason.");
  if (!reporterUid) throw new Error("Missing reporter id.");

  const nowMs = Date.now();

 const reportPayload: Record<string, unknown> = {
  groupId,
  targetType,
  targetId,
  reason,
  status: "open",
  reporterUid,
  createdAtMs: nowMs,
  updatedAtMs: nowMs,
};

if (goalId) reportPayload.goalId = goalId;
if (taskId) reportPayload.taskId = taskId;
if (commentId) reportPayload.commentId = commentId;
if (activityId) reportPayload.activityId = activityId;
if (bulletinId) reportPayload.bulletinId = bulletinId;
if (dmId) reportPayload.dmId = dmId;
if (conversationId) reportPayload.conversationId = conversationId;

if (note?.trim()) reportPayload.note = note.trim();

if (reporterName) reportPayload.reporterName = reporterName;
if (reporterEmail) reportPayload.reporterEmail = reporterEmail;

if (targetAuthorUid) reportPayload.targetAuthorUid = targetAuthorUid;
if (targetAuthorName) reportPayload.targetAuthorName = targetAuthorName;

if (targetPreviewTitle) reportPayload.targetPreviewTitle = targetPreviewTitle;
if (targetPreviewBody) reportPayload.targetPreviewBody = targetPreviewBody;

const reportRef = await addDoc(
  collection(db, "groups", groupId, "reports"),
  reportPayload
);
   try {
    await createModerationInboxItems({
      groupId,
      reportId: reportRef.id,
      reporterUid,
      reporterName,
      reason,
      targetType,
    });
  } catch (err) {
    console.log("[Groups] moderation inbox items failed after report create", err);
  }

  return reportRef.id;

  
};
export const subscribeGroupReports = (
  groupId: string,
  onNext: (reports: GroupReportDoc[]) => void,
  onError?: (error: unknown) => void
): Unsubscribe => {
  if (!groupId) {
    onNext([]);
    return () => {};
  }

  const q = query(
    collection(db, "groups", groupId, "reports"),
    orderBy("createdAtMs", "desc"),
    limit(50)
  );

  return onSnapshot(
    q,
    (snap) => {
      const reports: GroupReportDoc[] = [];

      snap.forEach((docSnap) => {
        const data = docSnap.data();

        reports.push({
          id: docSnap.id,
          groupId: data.groupId ?? groupId,
          targetType: data.targetType ?? "activity",
          targetId: data.targetId ?? "",
          targetAuthorUid: data.targetAuthorUid ?? null,
targetAuthorName: data.targetAuthorName ?? null,
targetPreviewTitle: data.targetPreviewTitle ?? null,
targetPreviewBody: data.targetPreviewBody ?? null,
          goalId: data.goalId ?? null,
          taskId: data.taskId ?? null,
          commentId: data.commentId ?? null,
          activityId: data.activityId ?? null,
          reason: data.reason ?? "other",
          note: data.note ?? null,
          bulletinId: data.bulletinId ?? null,
           dmId: data.dmId ?? null,
          status: data.status ?? "open",
          reporterUid: data.reporterUid ?? "",
          reporterName: data.reporterName ?? null,
          reporterEmail: data.reporterEmail ?? null,
          reviewedByUid: data.reviewedByUid ?? null,
          reviewedByName: data.reviewedByName ?? null,
          reviewedAtMs: data.reviewedAtMs ?? null,
          resolutionNote: data.resolutionNote ?? null,
          moderatorNote: data.moderatorNote ?? null,
lastActionType: data.lastActionType ?? null,
          createdAtMs: data.createdAtMs ?? 0,
          updatedAtMs: data.updatedAtMs ?? 0,
        });
      });

      onNext(reports);
    },
    (err) => {
      console.log("[Groups] subscribeGroupReports failed", err);
      onError?.(err);
    }
  );
};
export const updateGroupReportStatus = async (params: {
  groupId: string;
  reportId: string;
  status: GroupReportStatus;
  reviewedByUid: string;
  reviewedByName?: string | null;
  resolutionNote?: string | null;
  moderatorNote?: string | null;
}) => {
  if (!params.groupId) throw new Error("Missing group id.");
  if (!params.reportId) throw new Error("Missing report id.");
  if (!params.reviewedByUid) throw new Error("Missing reviewer id.");

  const nowMs = Date.now();

  const reportRef = doc(
    db,
    "groups",
    params.groupId,
    "reports",
    params.reportId
  );

  await updateDoc(reportRef, {
    status: params.status,
    reviewedByUid: params.reviewedByUid,
    reviewedByName: params.reviewedByName ?? null,
    reviewedAtMs: nowMs,

    resolutionNote: params.resolutionNote ?? null,

    moderatorNote:
      params.moderatorNote?.trim()?.length
        ? params.moderatorNote.trim()
        : null,

    lastActionType:
      params.status === "reviewing"
        ? "reviewing"
        : params.status === "resolved"
        ? "resolved"
        : params.status === "dismissed"
        ? "dismissed"
        : null,

    updatedAtMs: nowMs,
    updatedAt: serverTimestamp(),
  });
};
