import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Notifications from "expo-notifications";
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from "expo-web-browser";
import { useEffect } from "react";
import 'react-native-reanimated';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { recordPlannerNotificationOpened } from "../services/plannerSuggestions";

WebBrowser.maybeCompleteAuthSession();

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const router = useRouter();
  const colorScheme = useColorScheme();


  useEffect(() => {
  const handleNotificationResponse = (
    response: Notifications.NotificationResponse
  ) => {
    const data = response.notification.request.content.data ?? {};

    const goalId =
      typeof data.goalId === "string" && data.goalId.trim()
        ? data.goalId.trim()
        : null;

    const subtaskId =
      typeof data.subtaskId === "string" && data.subtaskId.trim()
        ? data.subtaskId.trim()
        : null;
    const boardId =
      typeof data.boardId === "string" && data.boardId.trim()
        ? data.boardId.trim()
        : null;
    const groupId =
      typeof data.groupId === "string" && data.groupId.trim()
        ? data.groupId.trim()
        : null;
    const occurrenceId =
      typeof data.occurrenceId === "string" && data.occurrenceId.trim()
        ? data.occurrenceId.trim()
        : null;
    const notificationType =
      typeof data.type === "string" ? data.type : null;
    const plannerGenerationRunId =
      typeof data.plannerGenerationRunId === "string" ?
        data.plannerGenerationRunId : null;

    if (notificationType === "planner_suggestion_batch") {
      router.push("/planner" as any);
      if (plannerGenerationRunId) {
        void recordPlannerNotificationOpened(plannerGenerationRunId)
          .catch(() => undefined);
      }
      return;
    }

    if (boardId) {
      router.push({
        pathname: "/board/[id]",
        params: { id: boardId },
      });
      return;
    }

    if (groupId && occurrenceId) {
      router.push(
        `/group/${groupId}/routine-occurrence/${occurrenceId}` as any
      );
      return;
    }

    if (goalId) {
      router.push({
        pathname: "/goal/[id]",
        params: {
          id: goalId,
          fromNotification: "true",
          subtaskId: subtaskId ?? "",
        },
      });

      return;
    }

    router.push("/today");
  };

  const subscription =
    Notifications.addNotificationResponseReceivedListener(
      handleNotificationResponse
    );

  return () => {
  subscription.remove();
};
}, [router]);


  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="planner/index" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </ThemeProvider>
  );
}
