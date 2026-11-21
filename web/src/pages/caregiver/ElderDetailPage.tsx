import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  HeartPulse,
  MapPin,
  Pill,
  ShieldAlert,
  Users,
} from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";
import { caregiverNavItems } from "../../components/layout/navItems";
import { Card, CardBody, CardHeader, StatCard } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { EmptyState, ErrorState, LoadingBlock } from "../../components/ui/Feedback";
import { Avatar } from "../../components/ui/Avatar";
import { VitalTrendChart } from "../../components/charts/VitalTrendChart";
import { DoseBar } from "../../components/charts/AdherenceDonut";
import { api } from "../../lib/api";
import type { CheckIn, ElderSummary, LocationPing, Schedule, VitalSummary } from "../../lib/types";
import { ageFrom, formatDateTime, relativeTime, smartDateTime } from "../../lib/format";

export default function ElderDetailPage() {
  const { elderId } = useParams<{ elderId: string }>();

  const summary = useQuery({
    queryKey: ["elders", elderId, "summary"],
    queryFn: () => api.get<ElderSummary>(`/elders/${elderId}/summary`),
    enabled: Boolean(elderId),
  });

  const vitals = useQuery({
    queryKey: ["vitals", elderId, "summary"],
    queryFn: () => api.get<VitalSummary>(`/elders/${elderId}/vitals/summary?days=30`),
    enabled: Boolean(elderId),
  });

  const schedule = useQuery({
    queryKey: ["schedule", elderId, "7"],
    queryFn: () => api.get<Schedule>(`/elders/${elderId}/medications/schedule?days=7`),
    enabled: Boolean(elderId),
  });

  const checkIns = useQuery({
    queryKey: ["checkins", elderId],
    queryFn: () => api.get<CheckIn[]>(`/elders/${elderId}/checkins?days=14`),
    enabled: Boolean(elderId),
  });

  const location = useQuery({
    queryKey: ["location", elderId],
    queryFn: () => api.get<LocationPing | null>(`/elders/${elderId}/locations/latest`),
    enabled: Boolean(elderId),
  });

  if (summary.isLoading) {
    return (
      <AppShell navItems={caregiverNavItems}>
        <LoadingBlock label="Loading the care record…" />
      </AppShell>
    );
  }

  if (summary.isError) {
    return (
      <AppShell navItems={caregiverNavItems}>
        <ErrorState
          title="We could not open this record"
          description="You may not have access, or the person may have been unlinked."
          onRetry={() => void summary.refetch()}
        />
      </AppShell>
    );
  }

  const data = summary.data;
  if (!data) return null;

  return (
    <AppShell navItems={caregiverNavItems}>
      <div className="space-y-6">
        <Link
          to="/caregiver"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-brand-700"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to the dashboard
        </Link>

        {/* -------------------------------------------------------- */}
        {/* Profile header                                           */}
        {/* -------------------------------------------------------- */}
        <Card>
          <CardBody className="flex flex-col gap-5 lg:flex-row lg:items-start">
            <Avatar name={data.elder.displayName} src={data.elder.photoUrl} size="xl" />

            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold tracking-tight text-ink-900">
                {data.elder.displayName}
              </h1>
              <p className="mt-1 text-ink-500">
                {ageFrom(data.elder.dateOfBirth) ?? "Age not recorded"}
                {data.elder.bloodType && data.elder.bloodType !== "UNKNOWN"
                  ? ` · blood type ${data.elder.bloodType}`
                  : ""}
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {data.elder.conditions.map((condition) => (
                  <Badge key={condition} tone="brand">
                    {condition}
                  </Badge>
                ))}
                {data.elder.allergies.map((allergy) => (
                  <Badge key={allergy} tone="warning">
                    {allergy}
                  </Badge>
                ))}
              </div>

              {data.elder.medicalNotes ? (
                <p className="mt-4 rounded-xl bg-ink-50 p-4 text-sm leading-relaxed text-ink-700">
                  {data.elder.medicalNotes}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 lg:w-56">
              <div
                className={`rounded-xl p-4 ${
                  data.checkIn.checkedInToday ? "bg-success-50" : "bg-warning-50"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                  Last check-in
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-lg font-bold text-ink-900">
                  {data.checkIn.checkedInToday ? (
                    <CheckCircle2 className="size-5 text-success-600" aria-hidden="true" />
                  ) : (
                    <ShieldAlert className="size-5 text-warning-600" aria-hidden="true" />
                  )}
                  {data.checkIn.latest ? relativeTime(data.checkIn.latest.createdAt) : "Never"}
                </p>
              </div>

              {location.data ? (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${location.data.latitude},${location.data.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-xl border border-ink-200 p-3 text-sm font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-700"
                >
                  <MapPin className="size-4 shrink-0 text-ink-400" aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block truncate">
                      {location.data.label ?? "Last known location"}
                    </span>
                    <span className="block text-xs text-ink-400">
                      {relativeTime(location.data.createdAt)}
                    </span>
                  </span>
                </a>
              ) : null}
            </div>
          </CardBody>
        </Card>

        {/* -------------------------------------------------------- */}
        {/* Stats                                                   */}
        {/* -------------------------------------------------------- */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Check-in streak"
            value={`${data.checkIn.streak} days`}
            hint={`${data.checkIn.missedLast7Days} missed in 7 days`}
            icon={<CalendarCheck className="size-4" aria-hidden="true" />}
            tone={data.checkIn.missedLast7Days > 0 ? "warning" : "success"}
          />
          <StatCard
            label="Medicines today"
            value={`${data.medications.takenToday}/${data.medications.dueToday}`}
            hint={`${data.medications.adherence7Days ?? 0}% adherence this week`}
            icon={<Pill className="size-4" aria-hidden="true" />}
          />
          <StatCard
            label="Critical readings (24 h)"
            value={data.vitals.criticalCount24h}
            tone={data.vitals.criticalCount24h > 0 ? "danger" : "success"}
            icon={<Activity className="size-4" aria-hidden="true" />}
          />
          <StatCard
            label="Care circle"
            value={data.caregivers.total}
            hint={data.caregivers.names.join(", ")}
            icon={<Users className="size-4" aria-hidden="true" />}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ---------------------------------------------------- */}
          {/* Charts                                                */}
          {/* ---------------------------------------------------- */}
          <div className="space-y-6">
            {(vitals.data?.series ?? []).map((series) => (
              <Card key={series.type}>
                <CardHeader
                  title={series.label}
                  description={`${series.count} reading${series.count === 1 ? "" : "s"} · average ${series.average} ${series.unit}`}
                  icon={<HeartPulse className="size-5" aria-hidden="true" />}
                  action={
                    series.criticalCount > 0 ? (
                      <Badge tone="danger">{series.criticalCount} out of range</Badge>
                    ) : undefined
                  }
                />
                <CardBody>
                  <VitalTrendChart series={series} height={200} />
                </CardBody>
              </Card>
            ))}
          </div>

          {/* ---------------------------------------------------- */}
          {/* Side column                                          */}
          {/* ---------------------------------------------------- */}
          <div className="space-y-6">
            <Card>
              <CardHeader title="Medication adherence" description="Last 7 days" />
              <CardBody>
                {schedule.data ? (
                  <>
                    <DoseBar
                      taken={schedule.data.adherence.taken}
                      skipped={schedule.data.adherence.skipped}
                      missed={schedule.data.adherence.missed}
                      pending={schedule.data.adherence.pending}
                    />
                    <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
                      {[
                        { label: "Taken", value: schedule.data.adherence.taken, tone: "text-success-700" },
                        { label: "Skipped", value: schedule.data.adherence.skipped, tone: "text-ink-600" },
                        { label: "Missed", value: schedule.data.adherence.missed, tone: "text-danger-700" },
                        { label: "Due", value: schedule.data.adherence.pending, tone: "text-brand-700" },
                      ].map((item) => (
                        <div key={item.label}>
                          <dd className={`tabular text-xl font-bold ${item.tone}`}>{item.value}</dd>
                          <dt className="text-xs text-ink-500">{item.label}</dt>
                        </div>
                      ))}
                    </dl>
                  </>
                ) : (
                  <EmptyState title="No medication data" />
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Check-in history" description="The last 14 days" />
              <CardBody>
                {checkIns.data && checkIns.data.length > 0 ? (
                  <ul className="space-y-2">
                    {checkIns.data.slice(0, 10).map((checkIn) => (
                      <li key={checkIn.id} className="flex items-center gap-3 text-sm">
                        <span
                          className={`size-2.5 shrink-0 rounded-full ${
                            checkIn.status === "SAFE"
                              ? "bg-success-500"
                              : checkIn.status === "NEEDS_HELP"
                                ? "bg-warning-500"
                                : "bg-danger-500"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="flex-1 text-ink-700">
                          {checkIn.status === "SAFE"
                            ? "Safe"
                            : checkIn.status === "NEEDS_HELP"
                              ? "Asked for help"
                              : "Missed"}
                          {checkIn.note ? ` — ${checkIn.note}` : ""}
                        </span>
                        <span className="shrink-0 text-xs text-ink-400">
                          {smartDateTime(checkIn.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No check-ins in the last two weeks" />
                )}
              </CardBody>
            </Card>
          </div>
        </div>

        <p className="text-xs text-ink-400">
          Record last updated {formatDateTime(new Date())}. All times are shown in the care
          recipient&rsquo;s local time.
        </p>
      </div>
    </AppShell>
  );
}
