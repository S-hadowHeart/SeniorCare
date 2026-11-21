import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  MapPin,
  Pill,
  UserPlus,
  Users,
} from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";
import { caregiverNavItems } from "../../components/layout/navItems";
import { Button } from "../../components/ui/Button";
import { Card, CardBody, CardHeader, StatCard } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { EmptyState, ErrorState, LoadingBlock } from "../../components/ui/Feedback";
import { Avatar } from "../../components/ui/Avatar";
import { Sparkline } from "../../components/charts/VitalTrendChart";
import { api } from "../../lib/api";
import type { CareLinkInvitation, DashboardPayload, ElderSummary } from "../../lib/types";
import { ageFrom, relativeTime, smartDateTime } from "../../lib/format";
import { useToast } from "../../context/ToastContext";

export default function CaregiverDashboard() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<DashboardPayload>("/dashboard"),
  });

  const invitations = useQuery({
    queryKey: ["care-link-invitations"],
    queryFn: () => api.get<CareLinkInvitation[]>("/care-links/invitations"),
  });

  const acceptInvite = useMutation({
    mutationFn: (invitationId: string) =>
      api.patch(`/care-links/${invitationId}`, { status: "ACTIVE" }),
    onSuccess: () => {
      toast.success("Invitation accepted", "Their record is now on your dashboard.");
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["care-link-invitations"] });
    },
    onError: () => toast.error("We could not accept that invitation."),
  });

  const acknowledge = useMutation({
    mutationFn: (alertId: string) => api.post(`/sos/${alertId}/acknowledge`),
    onSuccess: () => {
      toast.success("Acknowledged", "Everyone in the care circle can see that help is on the way.");
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => toast.error("We could not acknowledge that alert."),
  });

  const resolve = useMutation({
    mutationFn: (alertId: string) => api.post(`/sos/${alertId}/resolve`, {}),
    onSuccess: () => {
      toast.success("Alert closed.");
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: () => toast.error("We could not close that alert."),
  });

  if (dashboard.isLoading) {
    return (
      <AppShell navItems={caregiverNavItems}>
        <LoadingBlock label="Loading the dashboard…" />
      </AppShell>
    );
  }

  if (dashboard.isError) {
    return (
      <AppShell navItems={caregiverNavItems}>
        <ErrorState
          title="We could not load the dashboard"
          description="Please check your connection and try again."
          onRetry={() => void dashboard.refetch()}
        />
      </AppShell>
    );
  }

  const data = dashboard.data;
  if (!data) return null;

  const activeAlerts = data.activeAlerts;
  const needsAttention = data.elders.filter(
    (elder) => !elder.checkIn.checkedInToday || elder.vitals.criticalCount24h > 0,
  );

  return (
    <AppShell navItems={caregiverNavItems}>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">Care dashboard</h1>
            <p className="mt-1 text-ink-600">
              Live status of everyone you are looking after.
            </p>
          </div>
          {data.unreadCount > 0 ? (
            <Link to="/notifications">
              <Button variant="outline" leftIcon={<AlertTriangle className="size-4" aria-hidden="true" />}>
                {data.unreadCount} new alert{data.unreadCount === 1 ? "" : "s"}
              </Button>
            </Link>
          ) : null}
        </header>

        {/* -------------------------------------------------------- */}
        {/* Pending invitations                                      */}
        {/* -------------------------------------------------------- */}
        {invitations.data && invitations.data.length > 0 ? (
          <section className="space-y-3">
            {invitations.data.map((invitation) => (
              <Card key={invitation.id} className="border-brand-200 bg-brand-50">
                <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-700 text-white">
                      <UserPlus className="size-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-900">
                        Invitation from {invitation.elder.displayName}
                      </p>
                      <p className="text-sm text-ink-600">
                        They would like you to follow their check-ins, readings and medicines.
                      </p>
                    </div>
                  </div>
                  <Button
                    size="lg"
                    loading={
                      acceptInvite.isPending && acceptInvite.variables === invitation.id
                    }
                    onClick={() => acceptInvite.mutate(invitation.id)}
                  >
                    Accept invitation
                  </Button>
                </CardBody>
              </Card>
            ))}
          </section>
        ) : null}

        {/* -------------------------------------------------------- */}
        {/* Active emergency alerts                                  */}
        {/* -------------------------------------------------------- */}
        {activeAlerts.length > 0 ? (
          <section className="space-y-4">
            {activeAlerts.map((alert) => (
              <Card key={alert.id} className="border-danger-200 bg-danger-50">
                <CardBody>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-danger-600 text-white">
                      <AlertTriangle className="size-6" aria-hidden="true" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-bold text-danger-900">
                          {alert.elderName} needs help
                        </h2>
                        <Badge tone={alert.status === "ACTIVE" ? "danger" : "warning"}>
                          {alert.status === "ACTIVE" ? "Active" : "Acknowledged"}
                        </Badge>
                      </div>

                      {alert.message ? (
                        <p className="mt-1.5 text-danger-800">“{alert.message}”</p>
                      ) : null}

                      <p className="mt-1.5 text-sm text-danger-700">
                        Raised {smartDateTime(alert.createdAt)}
                        {alert.acknowledgedAt
                          ? ` · acknowledged ${relativeTime(alert.acknowledgedAt)}`
                          : ""}
                      </p>

                      {alert.mapUrl ? (
                        <a
                          href={alert.mapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm font-semibold text-brand-800 shadow-sm ring-1 ring-danger-200 hover:bg-ink-50"
                        >
                          <MapPin className="size-4" aria-hidden="true" />
                          Open the location
                        </a>
                      ) : (
                        <p className="mt-3 text-sm font-medium text-danger-700">
                          No location was shared with this alert.
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
                      {alert.status === "ACTIVE" ? (
                        <Button
                          size="lg"
                          loading={acknowledge.isPending}
                          onClick={() => acknowledge.mutate(alert.id)}
                          leftIcon={<CheckCircle2 className="size-4" aria-hidden="true" />}
                        >
                          I am on it
                        </Button>
                      ) : null}
                      <Button
                        size="lg"
                        variant="outline"
                        loading={resolve.isPending}
                        onClick={() => resolve.mutate(alert.id)}
                      >
                        Mark resolved
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </section>
        ) : null}

        {/* -------------------------------------------------------- */}
        {/* Summary tiles                                           */}
        {/* -------------------------------------------------------- */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="People you follow"
            value={data.elders.length}
            icon={<Users className="size-4" aria-hidden="true" />}
          />
          <StatCard
            label="Checked in today"
            value={`${data.elders.filter((elder) => elder.checkIn.checkedInToday).length}/${data.elders.length}`}
            tone={needsAttention.length > 0 ? "warning" : "success"}
            icon={<CalendarCheck className="size-4" aria-hidden="true" />}
          />
          <StatCard
            label="Active alerts"
            value={activeAlerts.length}
            tone={activeAlerts.length > 0 ? "danger" : "success"}
            icon={<AlertTriangle className="size-4" aria-hidden="true" />}
          />
          <StatCard
            label="Unread notifications"
            value={data.unreadCount}
            icon={<Activity className="size-4" aria-hidden="true" />}
          />
        </section>

        {/* -------------------------------------------------------- */}
        {/* Elder cards                                             */}
        {/* -------------------------------------------------------- */}
        {data.elders.length === 0 ? (
          <Card>
            <CardBody>
              <EmptyState
                icon={<Users className="size-6" aria-hidden="true" />}
                title="You are not following anyone yet"
                description="When someone invites you to their care circle they will appear here."
              />
            </CardBody>
          </Card>
        ) : (
          <section className="grid gap-4 lg:grid-cols-2">
            {data.elders.map((elder) => (
              <ElderCard key={elder.elder.id} elder={elder} />
            ))}
          </section>
        )}

        {/* -------------------------------------------------------- */}
        {/* Recent notifications                                    */}
        {/* -------------------------------------------------------- */}
        <Card>
          <CardHeader
            title="Recent activity"
            description="The last few things that happened"
            action={
              <Link to="/notifications">
                <Button variant="ghost" size="sm">
                  See all
                </Button>
              </Link>
            }
          />
          <CardBody>
            {data.recentNotifications.length === 0 ? (
              <EmptyState title="Nothing has happened yet" />
            ) : (
              <ul className="divide-y divide-ink-100">
                {data.recentNotifications.slice(0, 8).map((notification) => (
                  <li key={notification.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                    <span
                      className={`mt-1 size-2 shrink-0 rounded-full ${
                        notification.readAt ? "bg-ink-300" : "bg-brand-600"
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink-900">{notification.title}</p>
                      <p className="mt-0.5 text-sm text-ink-500">{notification.body}</p>
                    </div>
                    <span className="shrink-0 text-xs text-ink-400">
                      {relativeTime(notification.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </AppShell>
  );
}

function ElderCard({ elder }: { elder: ElderSummary }) {
  const checkedIn = elder.checkIn.checkedInToday;
  const critical = elder.vitals.criticalCount24h > 0;

  const latestPressure = elder.vitals.latest.find((vital) => vital.type === "BLOOD_PRESSURE");
  const latestSugar = elder.vitals.latest.find((vital) => vital.type === "BLOOD_SUGAR");
  const sparkValues = elder.vitals.latest.map((vital) => vital.value);

  return (
    <Card className={critical ? "border-danger-200" : undefined}>
      <CardBody>
        <div className="flex items-start justify-between gap-4">
          <Link
            to={`/caregiver/${elder.elder.id}`}
            className="flex min-w-0 items-center gap-3 hover:opacity-80"
          >
            <Avatar name={elder.elder.displayName} src={elder.elder.photoUrl} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-ink-900">{elder.elder.displayName}</p>
              <p className="truncate text-sm text-ink-500">
                {ageFrom(elder.elder.dateOfBirth) ?? "Age not recorded"}
                {elder.elder.conditions.length > 0
                  ? ` · ${elder.elder.conditions.join(", ")}`
                  : ""}
              </p>
            </div>
          </Link>

          <Badge
            tone={critical ? "danger" : checkedIn ? "success" : "warning"}
            icon={checkedIn ? <CheckCircle2 className="size-3" aria-hidden="true" /> : undefined}
          >
            {critical ? "Needs attention" : checkedIn ? "Safe" : "No check-in"}
          </Badge>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Streak</dt>
            <dd className="tabular mt-1 text-lg font-bold text-ink-900">
              {elder.checkIn.streak} {elder.checkIn.streak === 1 ? "day" : "days"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Medicines</dt>
            <dd className="tabular mt-1 text-lg font-bold text-ink-900">
              {elder.medications.takenToday}/{elder.medications.dueToday}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">BP</dt>
            <dd className="tabular mt-1 text-lg font-bold text-ink-900">
              {latestPressure ? (
                <>
                  {latestPressure.value}
                  {latestPressure.value2 !== null ? (
                    <span className="text-ink-400">/{latestPressure.value2}</span>
                  ) : null}
                </>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-500">Sugar</dt>
            <dd className="tabular mt-1 text-lg font-bold text-ink-900">
              {latestSugar ? latestSugar.value : "—"}
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex items-center justify-between gap-4 border-t border-ink-100 pt-4">
          <div className="flex items-center gap-3 text-sm text-ink-500">
            {sparkValues.length > 1 ? (
              <Sparkline values={sparkValues} tone={critical ? "danger" : "brand"} />
            ) : null}
            <span className="flex items-center gap-1.5">
              <Pill className="size-3.5" aria-hidden="true" />
              {elder.medications.adherence7Days ?? 0}% adherence
            </span>
          </div>

          <Link to={`/caregiver/${elder.elder.id}`}>
            <Button size="sm" variant="outline">
              Open record
            </Button>
          </Link>
        </div>
      </CardBody>
    </Card>
  );
}
