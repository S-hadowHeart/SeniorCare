import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, BellRing, CheckCheck, Pill, ShieldAlert, Stethoscope } from "lucide-react";
import { AppShell } from "../components/layout/AppShell";
import { caregiverNavItems, seniorNavItems } from "../components/layout/navItems";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { EmptyState, ErrorState, LoadingBlock } from "../components/ui/Feedback";
import { api } from "../lib/api";
import type { AppNotification, NotificationType } from "../lib/types";
import { relativeTime, smartDateTime } from "../lib/format";
import { cn } from "../lib/cn";
import { useAuth } from "../context/AuthContext";

const TYPE_META: Record<
  NotificationType,
  { icon: typeof BellRing; tone: "danger" | "warning" | "info" | "brand" | "neutral"; label: string }
> = {
  SOS_TRIGGERED: { icon: AlertTriangle, tone: "danger", label: "Emergency" },
  SOS_ACKNOWLEDGED: { icon: ShieldAlert, tone: "info", label: "Acknowledged" },
  SOS_RESOLVED: { icon: CheckCheck, tone: "success" as never, label: "Resolved" },
  CHECK_IN_MISSED: { icon: BellRing, tone: "warning", label: "Missed check-in" },
  CHECK_IN_NEEDS_HELP: { icon: BellRing, tone: "warning", label: "Needs help" },
  VITALS_CRITICAL: { icon: Stethoscope, tone: "danger", label: "Critical reading" },
  MEDICATION_DUE: { icon: Pill, tone: "brand", label: "Medicine due" },
  MEDICATION_MISSED: { icon: Pill, tone: "warning", label: "Medicine missed" },
  CARE_LINK_INVITED: { icon: BellRing, tone: "info", label: "Care circle" },
  SYSTEM: { icon: BellRing, tone: "neutral", label: "System" },
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const navItems = user?.role === "SENIOR" ? seniorNavItems : caregiverNavItems;

  const notifications = useQuery({
    queryKey: ["notifications", "list", unreadOnly],
    queryFn: () =>
      api.get<AppNotification[]>(`/notifications?limit=100${unreadOnly ? "&unreadOnly=true" : ""}`),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post("/notifications/read-all"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const items = notifications.data ?? [];

  return (
    <AppShell navItems={navItems}>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">Notifications</h1>
            <p className="mt-1 text-ink-600">Everything that has happened in the care circle.</p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant={unreadOnly ? "primary" : "outline"}
              size="sm"
              onClick={() => setUnreadOnly((value) => !value)}
            >
              {unreadOnly ? "Showing unread" : "Show unread"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              loading={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
              leftIcon={<CheckCheck className="size-3.5" aria-hidden="true" />}
            >
              Mark all read
            </Button>
          </div>
        </header>

        <Card>
          <CardHeader title="Your alerts" description={`${items.length} notification${items.length === 1 ? "" : "s"}`} />
          <CardBody>
            {notifications.isLoading ? (
              <LoadingBlock label="Loading notifications…" />
            ) : notifications.isError ? (
              <ErrorState onRetry={() => void notifications.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<BellRing className="size-6" aria-hidden="true" />}
                title={unreadOnly ? "Nothing unread" : "No notifications yet"}
                description="Alerts about check-ins, readings, medicines and emergencies will appear here."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {items.map((notification) => {
                  const meta = TYPE_META[notification.type] ?? TYPE_META.SYSTEM;
                  const Icon = meta.icon;

                  return (
                    <li
                      key={notification.id}
                      className={cn(
                        "flex items-start gap-4 py-4 first:pt-0 last:pb-0",
                        !notification.readAt && "bg-brand-50/40 -mx-4 px-4 rounded-xl",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-10 shrink-0 items-center justify-center rounded-xl",
                          meta.tone === "danger"
                            ? "bg-danger-100 text-danger-700"
                            : meta.tone === "warning"
                              ? "bg-warning-100 text-warning-700"
                              : meta.tone === "brand"
                                ? "bg-brand-100 text-brand-800"
                                : meta.tone === "info"
                                  ? "bg-info-100 text-info-700"
                                  : "bg-ink-100 text-ink-600",
                        )}
                      >
                        <Icon className="size-5" aria-hidden="true" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-ink-900">{notification.title}</p>
                          <Badge tone="neutral">{meta.label}</Badge>
                          {!notification.readAt ? <Badge tone="brand">New</Badge> : null}
                        </div>
                        <p className="mt-1 text-sm text-ink-600">{notification.body}</p>
                        <p className="mt-1 text-xs text-ink-400" title={smartDateTime(notification.createdAt)}>
                          {relativeTime(notification.createdAt)}
                        </p>
                      </div>

                      {!notification.readAt ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={markRead.isPending}
                          onClick={() => markRead.mutate(notification.id)}
                        >
                          Mark read
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}
