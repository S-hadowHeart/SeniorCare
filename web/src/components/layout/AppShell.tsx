import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { LogOut, Menu, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { useAuth } from "../../context/AuthContext";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { NotificationBell } from "./NotificationBell";
import { ThemeToggle } from "../ui/ThemeToggle";

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  /** Show a badge with the number of unread items. */
  badge?: number;
}

export function AppShell({
  navItems,
  children,
  title,
}: {
  navItems: NavItem[];
  children: ReactNode;
  title?: string;
}) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  return (
    <div className="min-h-dvh bg-ink-100">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      {/* ---------------------------------------------------------------- */}
      {/* Header                                                           */}
      {/* ---------------------------------------------------------------- */}
      <header className="sticky top-0 z-40 border-b border-ink-200 bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          <Link
            to={user?.role === "CAREGIVER" ? "/caregiver" : "/app"}
            className="flex items-center gap-2.5 font-bold text-ink-900"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-brand-700 text-white">
              <HeartPulseIcon />
            </span>
            <span className="text-lg">SeniorCare</span>
          </Link>

          {title ? (
            <span className="hidden truncate text-sm text-ink-500 sm:inline lg:hidden">{title}</span>
          ) : null}

          <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
            <ThemeToggle />
            <NotificationBell />

            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className="flex items-center gap-2 rounded-xl p-1.5 transition hover:bg-ink-100"
              >
                <Avatar name={user?.name ?? "?"} size="sm" />
                <span className="hidden max-w-[10rem] truncate text-sm font-medium text-ink-700 sm:inline">
                  {user?.name}
                </span>
              </button>

              {menuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-lg"
                >
                  <div className="border-b border-ink-200 px-4 py-3">
                    <p className="truncate text-sm font-semibold text-ink-900">{user?.name}</p>
                    <p className="truncate text-xs text-ink-500">{user?.email}</p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => void logout()}
                    className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-ink-700 transition hover:bg-ink-50"
                  >
                    <LogOut className="size-4" aria-hidden="true" />
                    Sign out
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl gap-8 px-4 pb-28 pt-6 sm:px-6 lg:pb-10">
        {/* ------------------------------------------------------------- */}
        {/* Sidebar (desktop)                                             */}
        {/* ------------------------------------------------------------- */}
        <nav aria-label="Main" className="hidden w-56 shrink-0 lg:block">
          <ul className="sticky top-24 space-y-1">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                      isActive
                        ? "bg-brand-700 text-white shadow-sm"
                        : "text-ink-700 hover:bg-surface hover:text-ink-900",
                    )
                  }
                >
                  {item.icon}
                  <span className="flex-1">{item.label}</span>
                  {item.badge ? (
                    <span className="rounded-full bg-danger-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
                      {item.badge > 99 ? "99+" : item.badge}
                    </span>
                  ) : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main-content" className="min-w-0 flex-1">
          {children}
        </main>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* Bottom navigation (mobile)                                     */}
      {/* ------------------------------------------------------------- */}
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-surface/95 backdrop-blur lg:hidden"
      >
        <ul className="flex">
          {navItems.slice(0, 5).map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-medium transition",
                    isActive ? "text-brand-700" : "text-ink-500",
                  )
                }
              >
                <span className="relative">
                  {item.icon}
                  {item.badge ? (
                    <span className="absolute -right-2 -top-1 rounded-full bg-danger-600 px-1 text-[10px] font-bold text-white">
                      {item.badge > 9 ? "9+" : item.badge}
                    </span>
                  ) : null}
                </span>
                <span className="max-w-full truncate">{item.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

/** Inline SVG keeps the bundle free of an icon dependency for the logo. */
function HeartPulseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden="true">
      <path
        d="M12 21s-7.5-4.7-9.4-9.1A5.2 5.2 0 0 1 12 5.6a5.2 5.2 0 0 1 9.4 6.3C19.5 16.3 12 21 12 21Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M3.8 12.5h3.3l1.4-2.6 2 4.6 1.7-3.2 1 1.2h3.1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Mobile header menu button (used by pages that need an extra action). */
export function MobileMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} aria-label="Open menu">
      <Menu className="size-5" aria-hidden="true" />
    </Button>
  );
}

export { X };
