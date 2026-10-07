import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useMemo, useState } from "react";
import { db } from "../services/firebase";
import {
  subscribeGroupCalendarEventsForRange,
  type GroupCalendarEventDoc,
} from "../services/groupCalendar";
import {
  safeGroupCalendarName,
  sortIntegratedGroupCalendarEvents,
} from "../services/groupCalendarIntegration";
import { subscribeMyGroupMemberships } from "../services/groups";

type ActiveGroup = { id: string; name: string };

export function useIntegratedGroupCalendarEvents(args: {
  uid: string | null;
  rangeStartMs: number;
  rangeEndMs: number;
  limitPerGroup: number;
}) {
  const [membershipGroupIds, setMembershipGroupIds] = useState<string[]>([]);
  const [membershipsReady, setMembershipsReady] = useState(false);
  const [membershipError, setMembershipError] = useState(false);
  const [groupsById, setGroupsById] = useState<Record<string, ActiveGroup | null>>({});
  const [groupsReadyById, setGroupsReadyById] = useState<Record<string, boolean>>({});
  const [eventsByGroupId, setEventsByGroupId] = useState<
    Record<string, GroupCalendarEventDoc[]>
  >({});
  const [eventsReadyByGroupId, setEventsReadyByGroupId] = useState<
    Record<string, boolean>
  >({});
  const [failedGroupIds, setFailedGroupIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMembershipGroupIds([]);
    setMembershipsReady(false);
    setMembershipError(false);
    if (!args.uid) {
      setMembershipsReady(true);
      return;
    }
    return subscribeMyGroupMemberships(
      args.uid,
      (memberships) => {
        const ids = Array.from(
          new Set(
            memberships
              .map((membership) =>
                typeof membership.groupId === "string"
                  ? membership.groupId.trim()
                  : ""
              )
              .filter(Boolean)
          )
        ).sort();
        setMembershipGroupIds(ids);
        setMembershipsReady(true);
      },
      () => {
        setMembershipError(true);
        setMembershipsReady(true);
      }
    );
  }, [args.uid]);

  const membershipKey = membershipGroupIds.join("|");

  useEffect(() => {
    setGroupsById({});
    setGroupsReadyById({});
    setFailedGroupIds(new Set());
    if (!membershipGroupIds.length) return;
    const unsubs = membershipGroupIds.map((groupId) =>
      onSnapshot(
        doc(db, "groups", groupId),
        (snapshot) => {
          setGroupsById((current) => ({
            ...current,
            [groupId]: snapshot.exists()
              ? {
                  id: groupId,
                  name: safeGroupCalendarName(snapshot.data().name),
                }
              : null,
          }));
          setGroupsReadyById((current) => ({ ...current, [groupId]: true }));
        },
        () => {
          setGroupsById((current) => ({ ...current, [groupId]: null }));
          setGroupsReadyById((current) => ({ ...current, [groupId]: true }));
          setFailedGroupIds((current) => new Set(current).add(groupId));
        }
      )
    );
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [membershipKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeGroups = useMemo(
    () =>
      membershipGroupIds
        .map((groupId) => groupsById[groupId])
        .filter((group): group is ActiveGroup => !!group),
    [groupsById, membershipGroupIds]
  );
  useEffect(() => {
    setEventsByGroupId({});
    setEventsReadyByGroupId({});
    if (!activeGroups.length) return;
    const unsubs = activeGroups.map((group) =>
      subscribeGroupCalendarEventsForRange(
        group.id,
        args.rangeStartMs,
        args.rangeEndMs,
        { limit: args.limitPerGroup },
        (events) => {
          setEventsByGroupId((current) => ({ ...current, [group.id]: events }));
          setEventsReadyByGroupId((current) => ({ ...current, [group.id]: true }));
          setFailedGroupIds((current) => {
            const next = new Set(current);
            next.delete(group.id);
            return next;
          });
        },
        () => {
          setEventsReadyByGroupId((current) => ({ ...current, [group.id]: true }));
          setFailedGroupIds((current) => new Set(current).add(group.id));
        }
      )
    );
    return () => unsubs.forEach((unsubscribe) => unsubscribe());
  }, [
    activeGroups,
    args.limitPerGroup,
    args.rangeEndMs,
    args.rangeStartMs,
  ]);

  const events = useMemo(
    () =>
      sortIntegratedGroupCalendarEvents(
        activeGroups.flatMap((group) =>
          (eventsByGroupId[group.id] ?? []).map((event) => ({
            source: "group" as const,
            groupId: group.id,
            groupName: group.name,
            event,
          }))
        )
      ),
    [activeGroups, eventsByGroupId]
  );
  const groupsReady =
    membershipsReady &&
    membershipGroupIds.every((groupId) => groupsReadyById[groupId]);
  const eventsReady =
    groupsReady &&
    activeGroups.every((group) => eventsReadyByGroupId[group.id]);

  return {
    events,
    activeGroupCount: activeGroups.length,
    loading: !eventsReady,
    partialError: membershipError || failedGroupIds.size > 0,
  };
}
