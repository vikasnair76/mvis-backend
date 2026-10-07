import * as Haptics from "expo-haptics";

async function runHaptic(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch {
    // Haptics are optional feedback and must never interrupt the user action.
  }
}

export function hapticSelection(): Promise<void> {
  return runHaptic(() =>
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  );
}

export function hapticSuccess(): Promise<void> {
  return runHaptic(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
  );
}

export function hapticWarning(): Promise<void> {
  return runHaptic(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
  );
}

export function hapticError(): Promise<void> {
  return runHaptic(() =>
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
  );
}
