/** Joins class names, skipping falsy ones (stand-in for the devignerui `cn`). */
export function cn(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}
