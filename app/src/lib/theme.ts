// KnotGate shared theme sync ("knotgate:theme" in localStorage).
//
// Syncs seamlessly across KnotGate tabs (/chat, /home, /memory) via the
// browser `storage` event, sets `data-theme="dark" | "light"` and `.dark` on
// `document.documentElement`, and notifies canvas renderers + React views.

import { useSyncExternalStore } from "react";

export type KnotGateTheme = "dark" | "light";
export const KNOTGATE_THEME_KEY = "knotgate:theme";

export interface ThemeStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function normalizeTheme(raw: unknown): KnotGateTheme {
  return raw === "light" ? "light" : "dark";
}

export function readStoredTheme(storage?: ThemeStorageLike | null): KnotGateTheme {
  try {
    const s = storage !== undefined ? storage : typeof window !== "undefined" ? window.localStorage : null;
    if (!s) return "dark";
    return normalizeTheme(s.getItem(KNOTGATE_THEME_KEY));
  } catch {
    return "dark";
  }
}

export function applyThemeToDocument(theme: KnotGateTheme, doc?: Document | null): void {
  const d = doc !== undefined ? doc : typeof document !== "undefined" ? document : null;
  if (!d?.documentElement) return;
  const root = d.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.style.colorScheme = theme;
}

let currentTheme: KnotGateTheme = readStoredTheme();
let initialized = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

export function getTheme(): KnotGateTheme {
  return currentTheme;
}

export function setTheme(next: KnotGateTheme, opts?: { persist?: boolean; storage?: ThemeStorageLike | null }): void {
  const normalized = normalizeTheme(next);
  const changed = normalized !== currentTheme;
  currentTheme = normalized;
  if (opts?.persist !== false) {
    try {
      const s =
        opts?.storage !== undefined ? opts.storage : typeof window !== "undefined" ? window.localStorage : null;
      s?.setItem(KNOTGATE_THEME_KEY, normalized);
    } catch {
      /* ignore private mode / quota errors */
    }
  }
  applyThemeToDocument(normalized);
  if (changed) notify();
}

export function toggleTheme(): KnotGateTheme {
  const next: KnotGateTheme = currentTheme === "dark" ? "light" : "dark";
  setTheme(next);
  return next;
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function initTheme(): KnotGateTheme {
  currentTheme = readStoredTheme();
  applyThemeToDocument(currentTheme);
  if (!initialized && typeof window !== "undefined") {
    initialized = true;
    window.addEventListener("storage", (ev: StorageEvent) => {
      if (ev.key === KNOTGATE_THEME_KEY || ev.key === null) {
        const synced = ev.newValue != null ? normalizeTheme(ev.newValue) : readStoredTheme();
        setTheme(synced, { persist: false });
      }
    });
  }
  return currentTheme;
}

export function useTheme(): {
  theme: KnotGateTheme;
  setTheme: (next: KnotGateTheme) => void;
  toggleTheme: () => KnotGateTheme;
} {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => "dark" as KnotGateTheme);
  return { theme, setTheme, toggleTheme };
}
