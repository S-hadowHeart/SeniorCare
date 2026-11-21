/**
 * Theme preference handling.
 *
 * The stored value is the user's *preference* ("light", "dark" or "system");
 * the resolved value is what is actually rendered. Keeping the two apart means
 * a user who chose "system" keeps following their OS when it changes during
 * the day.
 */
export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "sc-theme";

const DARK_THEME_COLOR = "#0a1220";
const LIGHT_THEME_COLOR = "#0f766e";

export function readStoredTheme(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Private mode / blocked storage — fall back to the OS setting.
  }
  return "system";
}

export function storeTheme(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Not fatal: the choice simply will not survive a reload.
  }
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

/** Apply the palette to the document (class, colour-scheme and browser chrome). */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference);
  const root = document.documentElement;

  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);

  return resolved;
}
