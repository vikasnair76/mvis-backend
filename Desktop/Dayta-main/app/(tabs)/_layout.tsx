import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { router, Tabs } from "expo-router";
import { onAuthStateChanged } from "firebase/auth";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { auth } from "../../services/firebase";
import {
  subscribeMyGroupInbox,
  type GroupInboxItemDoc,
} from "../../services/groups";
import { useAppTheme } from "../../services/useAppTheme";
import { useCurrentAppTheme } from "../../services/useCurrentAppTheme";

function handleNotificationNavigation(data: Record<string, unknown>) {
  const type = data.type;
  const goalId = data.goalId;
  const subtaskId = data.subtaskId;
  const taskId = data.taskId;
  const groupId = data.groupId;
  if (
    type === "group_mention" &&
    typeof groupId === "string" &&
    groupId.length > 0
  ) {
    if (typeof taskId === "string" && taskId.length > 0) {
      router.push(`/group/${groupId}/task/${taskId}`);
      return;
    }

    if (typeof subtaskId === "string" && subtaskId.length > 0) {
      router.push(`/group/${groupId}/task/${subtaskId}`);
      return;
    }

    if (typeof goalId === "string" && goalId.length > 0) {
      router.push({
        pathname: "/goal/[id]",
        params: { id: goalId },
      });
      return;
    }

    router.push(`/group/${groupId}`);
    return;
  }

  if (
    type === "task_assigned" &&
    typeof goalId === "string" &&
    goalId.length > 0
  ) {
    router.push({
      pathname: "/goal/[id]",
      params: {
        id: goalId,
        highlightSubtaskId:
          typeof subtaskId === "string" ? subtaskId : "",
      },
    });
  }
}
export default function TabLayout() {
  const { themeId } = useCurrentAppTheme();
  const theme = useAppTheme(themeId);

  const tabScreenOptions = useMemo(
    () => ({
      headerShown: false,
      tabBarActiveTintColor: theme.colors.navIconActive,
      tabBarInactiveTintColor: theme.colors.navIconInactive,
      tabBarStyle: {
        backgroundColor: theme.colors.navBackground,
        borderTopColor: theme.colors.navBorder,
        borderTopWidth: 1,
        height: 76,
        paddingTop: 8,
        paddingBottom: 10,
      },
      tabBarLabelStyle: {
        fontSize: 11,
        fontWeight: "800" as const,
      },
      tabBarBadgeStyle: {
        backgroundColor: theme.colors.danger,
        color: theme.colors.primaryText,
        fontSize: 11,
        fontWeight: "900" as const,
      },
    }),
    [theme]
  );

  const renderTabIcon = (
  name: React.ComponentProps<typeof Ionicons>["name"]
) => {
  return ({
    color,
    size,
    focused,
  }: {
    color: string;
    size: number;
    focused: boolean;
  }) => (
    <View
      style={[
        {
          width: 44,
          height: 32,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
        },
        focused && {
          backgroundColor: theme.colors.badge,
          shadowColor: theme.colors.cardShadow,
          shadowOpacity: 0.35,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 0 },
          elevation: 4,
        },
      ]}
    >
      <Ionicons name={name} size={size} color={color} />
    </View>
  );
};

  const [unreadInboxCount, setUnreadInboxCount] = useState(0);

useEffect(() => {
  let inboxUnsub: (() => void) | null = null;

  const authUnsub = onAuthStateChanged(auth, (user) => {
    if (inboxUnsub) {
      inboxUnsub();
      inboxUnsub = null;
    }

    if (!user?.uid) {
      setUnreadInboxCount(0);
      return;
    }

    inboxUnsub = subscribeMyGroupInbox(
      user.uid,
      (items: GroupInboxItemDoc[]) => {
        setUnreadInboxCount(items.filter((item) => !item.readAtMs).length);
      },
      (err) => {
        console.log("[Tabs] inbox badge failed", err);
        setUnreadInboxCount(0);
      }
    );
  });

  return () => {
    if (inboxUnsub) inboxUnsub();
    authUnsub();
  };
}, []);
  useEffect(() => {
  const subscription =
    Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data ?? {};
handleNotificationNavigation(data);
    });

  return () => subscription.remove();
}, []);


  return (
    <Tabs screenOptions={tabScreenOptions}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: renderTabIcon("home"),
        }}
      />

      <Tabs.Screen
        name="goals"
        options={{
          title: "Goals",
          tabBarIcon: renderTabIcon("flag"),
        }}
      />
<Tabs.Screen
  name="today"
  options={{
    title: "Today",
    tabBarIcon: renderTabIcon("today"),
  }}
/>

<Tabs.Screen
  name="calendar"
  options={{
    title: "Calendar",
    tabBarIcon: renderTabIcon("calendar-outline"),
  }}
/>
<Tabs.Screen
  name="history"
  options={{
    title: "History",
    tabBarIcon: renderTabIcon("time-outline"),
  }}
/>
<Tabs.Screen
  name="groups"
  options={{
    title: "Groups",
    tabBarIcon: renderTabIcon("people-outline"),
  }}
/>
 <Tabs.Screen
  name="inbox"
  options={{
    title: "Inbox",
    tabBarBadge: unreadInboxCount > 0 ? unreadInboxCount : undefined,
    tabBarIcon: renderTabIcon("notifications-outline"),
  }}
/>
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: renderTabIcon("settings"),
        }}
      />
     
    </Tabs>

  );
}
