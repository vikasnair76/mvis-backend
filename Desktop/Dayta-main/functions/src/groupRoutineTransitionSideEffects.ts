import { createHash } from "node:crypto";
import {
  FieldValue,
  Firestore,
  type DocumentData,
} from "firebase-admin/firestore";

export type OccurrenceTransitionType =
  | "occurrence_completed"
  | "occurrence_skipped"
  | "occurrence_reopened";
export type ParticipantTransitionType =
  | "participant_manager_corrected"
  | "participant_excused";

export type OccurrenceTransition = {
  type: OccurrenceTransitionType;
  groupId: string;
  routineId: string;
  occurrenceId: string;
  fromStatus: string;
  toStatus: string;
  revision: number;
  actorUid: string;
};
export type ParticipantManagerTransition = {
  type: ParticipantTransitionType;
  groupId: string;
  routineId: string;
  occurrenceId: string;
  participantUid: string;
  fromStatus: string;
  toStatus: string;
  revision: number;
  actorUid: string;
};
export type RoutineTransition =
  | OccurrenceTransition
  | ParticipantManagerTransition;

const executionStatuses = new Set([
  "scheduled",
  "in_progress",
  "completed",
  "skipped",
]);
const participantStatuses = new Set([
  "pending",
  "completed",
  "skipped",
  "excused",
]);

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function revision(value: unknown) {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}
function hash(parts: unknown[]) {
  return createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, 40);
}

export function classifyRoutineOccurrenceTransition(
  occurrenceId: string,
  before: DocumentData | undefined,
  after: DocumentData | undefined
): OccurrenceTransition | null {
  if (!before || !after || after.status === "cancelled") return null;
  const fromStatus = text(before.executionStatus) ?? "scheduled";
  const toStatus = text(after.executionStatus) ?? "scheduled";
  if (
    fromStatus === toStatus ||
    !executionStatuses.has(fromStatus) ||
    !executionStatuses.has(toStatus)
  ) {
    return null;
  }
  const nextRevision = revision(after.executionRevision);
  const previousRevision =
    Number.isInteger(before.executionRevision) &&
    Number(before.executionRevision) >= 0
      ? Number(before.executionRevision)
      : 0;
  if (nextRevision == null || nextRevision !== previousRevision + 1) return null;
  let type: OccurrenceTransitionType | null = null;
  if (toStatus === "completed") type = "occurrence_completed";
  else if (toStatus === "skipped") type = "occurrence_skipped";
  else if (
    (fromStatus === "completed" || fromStatus === "skipped") &&
    (toStatus === "scheduled" || toStatus === "in_progress")
  ) {
    type = "occurrence_reopened";
  }
  const groupId = text(after.groupId);
  const routineId = text(after.routineId);
  const actorUid = text(after.executionUpdatedByUid);
  return type && groupId && routineId && actorUid
    ? {
        type,
        groupId,
        routineId,
        occurrenceId,
        fromStatus,
        toStatus,
        revision: nextRevision,
        actorUid,
      }
    : null;
}

export function classifyRoutineParticipantManagerTransition(
  occurrenceId: string,
  participantUid: string,
  before: DocumentData | undefined,
  after: DocumentData | undefined
): ParticipantManagerTransition | null {
  if (!before || !after) return null;
  const fromStatus = text(before.status);
  const toStatus = text(after.status);
  const actorUid = text(after.updatedByUid);
  if (
    !fromStatus ||
    !toStatus ||
    fromStatus === toStatus ||
    !participantStatuses.has(fromStatus) ||
    !participantStatuses.has(toStatus) ||
    !actorUid ||
    actorUid === participantUid
  ) {
    return null;
  }
  const nextRevision = revision(after.statusRevision);
  const previousRevision =
    Number.isInteger(before.statusRevision) && Number(before.statusRevision) >= 0
      ? Number(before.statusRevision)
      : 0;
  const groupId = text(after.groupId);
  const routineId = text(after.routineId);
  if (
    nextRevision == null ||
    nextRevision !== previousRevision + 1 ||
    !groupId ||
    !routineId
  ) {
    return null;
  }
  return {
    type:
      toStatus === "excused"
        ? "participant_excused"
        : "participant_manager_corrected",
    groupId,
    routineId,
    occurrenceId,
    participantUid,
    fromStatus,
    toStatus,
    revision: nextRevision,
    actorUid,
  };
}

export function getRoutineTransitionEventId(transition: RoutineTransition) {
  return `rte_${hash([
    transition.occurrenceId,
    transition.type,
    transition.revision,
    transition.actorUid,
    "participantUid" in transition ? transition.participantUid : null,
    transition.fromStatus,
    transition.toStatus,
  ])}`;
}
export function getRoutineActivityId(eventId: string) {
  return `routineActivity_${eventId}`;
}
export function getRoutineInboxId(eventId: string, uid: string) {
  return `routineInbox_${hash([eventId, uid])}`;
}
export function getRoutineAdminLogId(eventId: string) {
  return `routineAdmin_${eventId}`;
}
export function getRoutinePushRequestId(eventId: string, uid: string) {
  return `routinePush_${hash([eventId, uid])}`;
}
export function getRoutineOccurrenceDeepLink(
  groupId: string,
  occurrenceId: string
) {
  return `/group/${encodeURIComponent(
    groupId
  )}/routine-occurrence/${encodeURIComponent(occurrenceId)}`;
}

export function getRoutineTransitionCopy(transition: RoutineTransition) {
  switch (transition.type) {
    case "occurrence_completed":
      return {
        title: "Routine completed",
        body: "A group routine occurrence was completed.",
      };
    case "occurrence_skipped":
      return {
        title: "Routine skipped",
        body: "A group routine occurrence was marked skipped.",
      };
    case "occurrence_reopened":
      return {
        title: "Routine reopened",
        body: "Your routine check-in needs attention again.",
      };
    case "participant_excused":
      return {
        title: "Routine check-in updated",
        body: "You were marked excused for this occurrence.",
      };
    default:
      return transition.toStatus === "pending"
        ? {
            title: "Routine check-in reopened",
            body: "Your check-in was reset to pending.",
          }
        : {
            title: "Routine check-in updated",
            body: "A manager updated your check-in status.",
          };
  }
}

type PreferenceData = {
  muted?: unknown;
  categories?: { activity?: unknown };
};
export function allowsRoutineNotification(
  preference: PreferenceData | undefined
) {
  if (preference?.muted === true) return false;
  return preference?.categories?.activity !== false;
}

function isActiveNonViewerMember(data: DocumentData | undefined) {
  return !!data && data.status === "active" && data.role !== "viewer";
}
function isManager(
  actorUid: string,
  member: DocumentData | undefined,
  routine: DocumentData
) {
  return (
    isActiveNonViewerMember(member) &&
    (["owner", "admin", "moderator"].includes(member?.role) ||
      (member?.role === "member" && routine.createdByUid === actorUid))
  );
}

export type ProcessRoutineTransitionResult = {
  eventId: string;
  status: "processed" | "duplicate" | "skipped";
  activityWritten: boolean;
  adminLogWritten: boolean;
  inboxRecipientCount: number;
  pushRequestCount: number;
  reasonCode?: string;
};

export async function processRoutineTransition(
  firestore: Firestore,
  transition: RoutineTransition,
  options?: { nowMs?: number }
): Promise<ProcessRoutineTransitionResult> {
  const nowMs = options?.nowMs ?? Date.now();
  const eventId = getRoutineTransitionEventId(transition);
  const ledgerRef = firestore.collection("routineTransitionEvents").doc(eventId);
  return firestore.runTransaction(async (transaction) => {
    const existingLedger = await transaction.get(ledgerRef);
    if (existingLedger.exists && existingLedger.data()?.status === "processed") {
      return {
        eventId,
        status: "duplicate",
        activityWritten: existingLedger.data()?.activityWritten === true,
        adminLogWritten: existingLedger.data()?.adminLogWritten === true,
        inboxRecipientCount:
          Number(existingLedger.data()?.inboxRecipientCount) || 0,
        pushRequestCount:
          Number(existingLedger.data()?.pushRequestCount) || 0,
      };
    }
    const occurrenceRef = firestore
      .collection("groupRoutineOccurrences")
      .doc(transition.occurrenceId);
    const routineRef = firestore
      .collection("groupRoutines")
      .doc(transition.routineId);
    const groupRef = firestore.collection("groups").doc(transition.groupId);
    const [occurrenceSnapshot, routineSnapshot, groupSnapshot] =
      await Promise.all([
        transaction.get(occurrenceRef),
        transaction.get(routineRef),
        transaction.get(groupRef),
      ]);
    if (
      !occurrenceSnapshot.exists ||
      !routineSnapshot.exists ||
      !groupSnapshot.exists
    ) {
      const reasonCode = !groupSnapshot.exists
        ? "missing_group"
        : !routineSnapshot.exists
          ? "missing_routine"
          : "missing_occurrence";
      transaction.set(ledgerRef, {
        id: eventId,
        ...transition,
        status: "skipped",
        reasonCode,
        sourceEventId: null,
        activityWritten: false,
        adminLogWritten: false,
        inboxRecipientCount: 0,
        pushRequestCount: 0,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        eventId,
        status: "skipped",
        reasonCode,
        activityWritten: false,
        adminLogWritten: false,
        inboxRecipientCount: 0,
        pushRequestCount: 0,
      };
    }
    const occurrence = occurrenceSnapshot.data()!;
    const routine = routineSnapshot.data()!;
    let participantRevisionIsCurrent = true;
    if ("participantUid" in transition) {
      const participantSnapshot = await transaction.get(
        occurrenceRef.collection("participants").doc(transition.participantUid)
      );
      const participantRevision = Number(
        participantSnapshot.data()?.statusRevision ?? 0
      );
      participantRevisionIsCurrent =
        participantSnapshot.exists &&
        participantRevision >= transition.revision &&
        (participantRevision !== transition.revision ||
          participantSnapshot.data()?.status === transition.toStatus);
    }
    if (
      occurrence.groupId !== transition.groupId ||
      occurrence.routineId !== transition.routineId ||
      ("participantUid" in transition
        ? !participantRevisionIsCurrent
        : Number(occurrence.executionRevision ?? 0) < transition.revision ||
          (Number(occurrence.executionRevision ?? 0) === transition.revision &&
            occurrence.executionStatus !== transition.toStatus))
    ) {
      const reasonCode = "stale_or_mismatched_context";
      transaction.set(ledgerRef, {
        id: eventId,
        ...transition,
        status: "skipped",
        reasonCode,
        activityWritten: false,
        adminLogWritten: false,
        inboxRecipientCount: 0,
        pushRequestCount: 0,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        eventId,
        status: "skipped",
        reasonCode,
        activityWritten: false,
        adminLogWritten: false,
        inboxRecipientCount: 0,
        pushRequestCount: 0,
      };
    }

    const actorMemberRef = firestore
      .collection("groups")
      .doc(transition.groupId)
      .collection("members")
      .doc(transition.actorUid);
    const actorMemberSnapshot = await transaction.get(actorMemberRef);
    if (
      transition.type.startsWith("participant_") &&
      !isManager(transition.actorUid, actorMemberSnapshot.data(), routine)
    ) {
      const reasonCode = "actor_unauthorized";
      transaction.set(ledgerRef, {
        id: eventId,
        ...transition,
        status: "skipped",
        reasonCode,
        activityWritten: false,
        adminLogWritten: false,
        inboxRecipientCount: 0,
        pushRequestCount: 0,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return {
        eventId,
        status: "skipped",
        reasonCode,
        activityWritten: false,
        adminLogWritten: false,
        inboxRecipientCount: 0,
        pushRequestCount: 0,
      };
    }

    const recipientUids =
      transition.type === "occurrence_reopened"
        ? Array.isArray(occurrence.participantUids)
          ? occurrence.participantUids
          : []
        : transition.type === "occurrence_completed" ||
            transition.type === "occurrence_skipped"
          ? [routine.createdByUid]
        : ["participantUid" in transition ? transition.participantUid : ""];
    const uniqueRecipientUids = Array.from(
      new Set(
        recipientUids.filter(
          (uid): uid is string =>
            typeof uid === "string" && !!uid && uid !== transition.actorUid
        )
      )
    ).slice(0, 50);
    const recipientContexts = await Promise.all(
      uniqueRecipientUids.map(async (uid) => {
        const [member, preference] = await Promise.all([
          transaction.get(
            firestore
              .collection("groups")
              .doc(transition.groupId)
              .collection("members")
              .doc(uid)
          ),
          transaction.get(
            firestore
              .collection("users")
              .doc(uid)
              .collection("groupNotificationPreferences")
              .doc(transition.groupId)
          ),
        ]);
        return { uid, member: member.data(), preference: preference.data() };
      })
    );
    const eligibleRecipients = recipientContexts.filter(
      ({ member, preference }) =>
        isActiveNonViewerMember(member) &&
        allowsRoutineNotification(preference)
    );
    const copy = getRoutineTransitionCopy(transition);
    const deepLink = getRoutineOccurrenceDeepLink(
      transition.groupId,
      transition.occurrenceId
    );
    let activityWritten = false;
    let adminLogWritten = false;
    if (transition.type.startsWith("occurrence_")) {
      transaction.set(
        firestore
          .collection("groups")
          .doc(transition.groupId)
          .collection("activity")
          .doc(getRoutineActivityId(eventId)),
        {
          groupId: transition.groupId,
          type: transition.type,
          actorUid: transition.actorUid,
          actorName: null,
          actorEmail: null,
          message: copy.body,
          routineId: transition.routineId,
          occurrenceId: transition.occurrenceId,
          deepLink,
          transitionEventId: eventId,
          createdAtMs: nowMs,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: false }
      );
      activityWritten = true;
    } else {
      transaction.set(
        firestore
          .collection("groups")
          .doc(transition.groupId)
          .collection("adminLogs")
          .doc(getRoutineAdminLogId(eventId)),
        {
          groupId: transition.groupId,
          action:
            transition.type === "participant_excused"
              ? "routine_participant_excused"
              : "routine_participant_status_corrected",
          actorUid: transition.actorUid,
          actorName: null,
          actorEmail: null,
          targetUid:
            "participantUid" in transition ? transition.participantUid : null,
          targetEmail: null,
          targetName: null,
          message:
            transition.type === "participant_excused"
              ? "A routine participant was marked excused."
              : "A routine participant status was corrected.",
          metadata: {
            routineId: transition.routineId,
            occurrenceId: transition.occurrenceId,
            fromStatus: transition.fromStatus,
            toStatus: transition.toStatus,
            revision: transition.revision,
            deepLink,
            transitionEventId: eventId,
          },
          createdAtMs: nowMs,
          createdAt: FieldValue.serverTimestamp(),
        },
        { merge: false }
      );
      adminLogWritten = true;
    }

    let pushRequestCount = 0;
    for (const recipient of eligibleRecipients) {
      const inboxId = getRoutineInboxId(eventId, recipient.uid);
      transaction.set(
        firestore
          .collection("users")
          .doc(recipient.uid)
          .collection("groupInbox")
          .doc(inboxId),
        {
          uid: recipient.uid,
          groupId: transition.groupId,
          type: "activity",
          title: copy.title,
          body: copy.body,
          actorUid: transition.actorUid,
          actorName: null,
          readAtMs: null,
          createdAtMs: nowMs,
          updatedAtMs: nowMs,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          relatedEntityType: "routine_occurrence",
          relatedEntityId: transition.occurrenceId,
          idempotencyKey: inboxId,
          trustedRoutine: true,
          deepLink,
          transitionEventId: eventId,
        },
        { merge: false }
      );
      const shouldPush =
        transition.type === "occurrence_completed" ||
        transition.type === "occurrence_skipped" ||
        transition.type === "occurrence_reopened" ||
        (transition.type === "participant_manager_corrected" &&
          transition.toStatus === "pending");
      if (shouldPush) {
        const requestId = getRoutinePushRequestId(eventId, recipient.uid);
        transaction.set(
          firestore.collection("routineNotificationRequests").doc(requestId),
          {
            id: requestId,
            idempotencyKey: requestId,
            transitionEventId: eventId,
            groupId: transition.groupId,
            routineId: transition.routineId,
            occurrenceId: transition.occurrenceId,
            targetUid: recipient.uid,
            actorUid: transition.actorUid,
            type: transition.type,
            title: copy.title,
            body: copy.body,
            deepLink,
            status: "queued",
            attemptCount: 0,
            nextRetryAtMs: nowMs,
            leaseId: null,
            processingAtMs: null,
            createdAtMs: nowMs,
            updatedAtMs: nowMs,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: false }
        );
        pushRequestCount += 1;
      }
    }
    transaction.set(
      ledgerRef,
      {
        id: eventId,
        ...transition,
        status: "processed",
        reasonCode: null,
        activityWritten,
        adminLogWritten,
        inboxRecipientCount: eligibleRecipients.length,
        pushRequestCount,
        createdAtMs: existingLedger.data()?.createdAtMs ?? nowMs,
        updatedAtMs: nowMs,
        createdAt:
          existingLedger.data()?.createdAt ?? FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: false }
    );
    return {
      eventId,
      status: "processed",
      activityWritten,
      adminLogWritten,
      inboxRecipientCount: eligibleRecipients.length,
      pushRequestCount,
    };
  });
}
