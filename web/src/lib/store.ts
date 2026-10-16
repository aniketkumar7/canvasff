/** localStorage that never throws (private mode, blocked storage). Per-browser conveniences only. */
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

export type Recent = { id: string; name: string; created: number };

export const CURRENT = "canvasff-job";
export const RECENT = "canvasff-recent";

export function remember(r: Recent) {
  const list = store.get<Recent[]>(RECENT, []).filter((x) => x.id !== r.id);
  store.set(RECENT, [r, ...list].slice(0, 10));
}
