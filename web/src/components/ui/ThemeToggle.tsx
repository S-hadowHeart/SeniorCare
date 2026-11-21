import { Moon, Sun } from "lucide-react";
import { cn } from "../../lib/cn";
import { useTheme } from "../../context/ThemeContext";

/**
 * Light / dark switch.
 *
 * The icon shows the theme the *press* will switch to, and the accessible name
 * spells that out, so the control is unambiguous for screen-reader users.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={cn(
        "flex size-10 items-center justify-center rounded-xl text-ink-600 transition",
        "hover:bg-ink-100 hover:text-ink-900",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600",
        className,
      )}
    >
      {theme === "dark" ? (
        <Sun className="size-5" aria-hidden="true" />
      ) : (
        <Moon className="size-5" aria-hidden="true" />
      )}
    </button>
  );
}
