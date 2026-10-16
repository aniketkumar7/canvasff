import * as React from "react";
import { useReducedMotion } from "motion/react";

/** True when the viewer asked the OS for less motion. */
export function useReducedMotionPreference() {
  return useReducedMotion() ?? false;
}

/** Controlled when `value` is given, otherwise keeps its own state. */
export function useControllableState<T>({
  value,
  defaultValue,
  onValueChange,
}: {
  value?: T;
  defaultValue: T;
  onValueChange?: (value: T) => void;
}) {
  const [own, setOwn] = React.useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : own;
  const set = React.useCallback(
    (next: T) => {
      if (!controlled) setOwn(next);
      if (next !== current) onValueChange?.(next);
    },
    [controlled, current, onValueChange],
  );
  return [current, set] as const;
}
