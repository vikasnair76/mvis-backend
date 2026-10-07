import { useEffect, useRef } from "react";
import { Animated } from "react-native";

const ENTRANCE_MS = 220;

/** Fade + slide-up once the screen has data (or knows it's signed out). */
export function useHomeEntrance(isReady: boolean) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    if (!isReady) return;

    opacity.setValue(0);
    translateY.setValue(10);

    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: ENTRANCE_MS, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: ENTRANCE_MS, useNativeDriver: true }),
    ]).start();
  }, [isReady, opacity, translateY]);

  return { opacity, translateY };
}
