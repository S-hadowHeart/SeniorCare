import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Bell, CheckCheck } from "lucide-react";
import { api } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import type { AppNotification } from "../../lib/types";
import { cn } from "../../lib/cn";

/**
 * Notification bell.
 *
 * The badge is kept live by the shared SSE connection: when a notification
 * arrives the React Query cache is invalidated, which re-fetches the unread
 * count.
 */
export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const unread = useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: () => api.get<{ unreadCount: number }>("/notifications/unread-count"),
    refetchInterval: 60_000,
    staleTime: 20_000,
  });

  const recent = useQuery({
    queryKey: ["notifications", "recent"],
    queryFn: () => api.get<AppNotification[]>("/notifications?limit=6"),
    enabled: open,
    staleTime: 10_000,
  });

  const count = unread.data?.unreadCount ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={count > 0 ? `Notifications, ${count} unread` : "Notifications"}
        aria-expanded={open}
        className="relative rounded-xl p-2.5 text-ink-600 transition hover:bg-ink-100 hover:text-ink-900"
      >
        <Bell className="size-5" aria-hidden="true" />
        {count > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[1.25rem] items-center justify-center rounded-full bg-danger-600 px-1 text-[11px] font-bold text-white">
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-ink-200 bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
              <p className="text-sm font-semibold text-ink-900">Notifications</p>
              {count > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    void api.post("/notifications/read-all").then(() => {
                      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
                    });
                  }}
                  className="flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-900"
                >
                  <CheckCheck className="size-3.5" aria-hidden="true" />
                  Mark all read
                </button>
              ) : null}
            </div>

            <ul className="max-h-80 divide-y divide-ink-100 overflow-y-auto">
              {recent.data && recent.data.length > 0 ? (
                recent.data.map((notification) => (
                  <li key={notification.id}>
                    <Link
                      to="/notifications"
                      onClick={() => setOpen(false)}
                      className={cn(
                        "block px-4 py-3 transition hover:bg-ink-50",
                        !notification.readAt && "bg-brand-50/60",
                      )}
                    >
                      <p className="text-sm font-medium text-ink-900">{notification.title}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-ink-500">{notification.body}</p>
                      <p className="mt-1 text-[11px] text-ink-400">
                        {relativeTime(notification.createdAt)}
                      </p>
                    </Link>
                  </li>
                ))
              ) : (
                <li className="px-4 py-8 text-center text-sm text-ink-500">
                  {recent.isLoading ? "Loading…" : "You are all caught up."}
                </li>
              )}
            </ul>

            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="block border-t border-ink-200 px-4 py-3 text-center text-sm font-semibold text-brand-700 hover:bg-ink-50"
            >
              View all notifications
            </Link>
          </div>
        </>
      ) : null}
    </div>
  );
}
