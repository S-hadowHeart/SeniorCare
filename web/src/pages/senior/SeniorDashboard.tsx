import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Activity,
  CalendarCheck,
  CheckCircle2,
  ClipboardList,
  HeartPulse,
  Phone,
  Pill,
  ShieldAlert,
  Users,
} from "lucide-react";
import { AppShell, type NavItem } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/Button";
import { Card, CardBody, CardHeader, StatCard } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { EmptyState, ErrorState, LoadingBlock } from "../../components/ui/Feedback";
import { SosButton } from "../../components/SosButton";
import { AdherenceDonut } from "../../components/charts/AdherenceDonut";
import { api, ApiError } from "../../lib/api";
import type { ElderSummary, Schedule } from "../../lib/types";
import { formatClockTime, smartDateTime } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";

export default function SeniorDashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const elderId = user?.elderId ?? undefined;

  const summary = useQuery({
    queryKey: ["elders", elderId, "summary"],
    queryFn: () => api.get<ElderSummary>(`/elders/${elderId}/summary`),
    enabled: Boolean(elderId),
  });

  const schedule = useQuery({
    queryKey: ["schedule", elderId, "today"],
    queryFn: () => api.get<Schedule>(`/elders/${elderId}/medications/schedule?days=1&includePast=false`),
    enabled: Boolean(elderId),
  });

  const checkIn = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>(`/elders/${elderId}/checkins`, { status: "SAFE", mood: 5 }),
    onSuccess: () => {
      toast.success("Thank you — you are marked as safe.", "Your family can see that you are okay.");
      void queryClient.invalidateQueries({ queryKey: ["elders"] });
      void queryClient.invalidateQueries({ queryKey: ["checkins"] });
    },
    onError: (error) => {
      toast.error(
        "We could not record your check-in.",
        error instanceof ApiError ? error.message : "Please try again.",
      );
    },
  });

  const navItems: NavItem[] = [
    { to: "/app", label: "Today", icon: <CalendarCheck className="size-5" aria-hidden="true" /> },
    { to: "/app/check-in", label: "Check-ins", icon: <CheckCircle2 className="size-5" aria-hidden="true" /> },
    { to: "/app/health", label: "Health", icon: <Activity className="size-5" aria-hidden="true" /> },
    { to: "/app/medicines", label: "Medicines", icon: <Pill className="size-5" aria-hidden="true" /> },
    { to: "/app/contacts", label: "Contacts", icon: <Users className="size-5" aria-hidden="true" /> },
    { to: "/app/profile", label: "Profile", icon: <HeartPulse className="size-5" aria-hidden="true" /> },
  ];

  if (summary.isLoading) {
    return (
      <AppShell navItems={navItems}>
        <LoadingBlock label="Loading your day…" />
      </AppShell>
    );
  }

  if (summary.isError) {
    return (
      <AppShell navItems={navItems}>
        <ErrorState
          title="We could not load your dashboard"
          description="Please check your connection and try again."
          onRetry={() => void summary.refetch()}
        />
      </AppShell>
    );
  }

  const data = summary.data;
  if (!data) return null;

  const dueDoses = schedule.data?.doses ?? [];
  const takenCount = dueDoses.filter((dose) => dose.status === "TAKEN").length;
  const checkedIn = data.checkIn.checkedInToday;
  // A help request counts as a check-in, but it must not look like "safe".
  const needsHelp = checkedIn && data.checkIn.latest?.status === "NEEDS_HELP";

  return (
    <AppShell navItems={navItems}>
      <div className="space-y-6">
        {/* ---------------------------------------------------------- */}
        {/* Greeting + check-in                                         */}
        {/* ---------------------------------------------------------- */}
        <section className="overflow-hidden rounded-2xl bg-brand-700 text-white shadow-sm">
          <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-sm text-brand-100">
                {new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening"},
                {" "}
                {user?.name.split(" ")[0]}
              </p>

              {needsHelp ? (
                <>
                  <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold sm:text-3xl">
                    <ShieldAlert className="size-7" aria-hidden="true" />
                    Your family has been told
                  </h1>
                  <p className="mt-2 text-brand-100">
                    You asked for help
                    {data.checkIn.latest
                      ? ` at ${smartDateTime(data.checkIn.latest.createdAt).replace("Today at ", "")}`
                      : ""}
                    . Someone will contact you as soon as they can.
                  </p>
                  <Button
                    size="xl"
                    className="mt-5 bg-surface text-brand-800 hover:bg-brand-50"
                    loading={checkIn.isPending}
                    leftIcon={<CheckCircle2 className="size-6" aria-hidden="true" />}
                    onClick={() => checkIn.mutate()}
                  >
                    I am safe now
                  </Button>
                </>
              ) : checkedIn ? (
                <>
                  <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold sm:text-3xl">
                    <CheckCircle2 className="size-7" aria-hidden="true" />
                    You are marked as safe
                  </h1>
                  <p className="mt-2 text-brand-100">
                    {data.checkIn.latest
                      ? `Confirmed at ${smartDateTime(data.checkIn.latest.createdAt).replace("Today at ", "")}`
                      : "Confirmed today"}
                    {data.checkIn.streak > 1 ? ` · ${data.checkIn.streak} day streak` : ""}
                  </p>
                </>
              ) : (
                <>
                  <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Are you safe today?</h1>
                  <p className="mt-2 text-brand-100">
                    Let your family know that you are well with one tap.
                  </p>
                  <Button
                    size="xl"
                    className="mt-5 bg-surface text-brand-800 hover:bg-brand-50"
                    loading={checkIn.isPending}
                    leftIcon={<CheckCircle2 className="size-6" aria-hidden="true" />}
                    onClick={() => checkIn.mutate()}
                  >
                    Yes, I am safe
                  </Button>
                </>
              )}
            </div>

            <SosButton
              elderId={elderId}
              size="xl"
              className="w-full lg:w-72"
              captionClassName="text-white/75"
            />
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Stat tiles                                                  */}
        {/* ---------------------------------------------------------- */}
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Today's medicines"
            value={`${takenCount}/${dueDoses.length || data.medications.dueToday}`}
            hint={dueDoses.length === 0 ? "Nothing due right now" : "Taken so far"}
            icon={<Pill className="size-4" aria-hidden="true" />}
            tone={dueDoses.length > 0 && takenCount === dueDoses.length ? "success" : "default"}
          />
          <StatCard
            label="Adherence this week"
            value={data.medications.adherence7Days === null ? "—" : `${data.medications.adherence7Days}%`}
            hint="Of the doses that were due"
            icon={<ClipboardList className="size-4" aria-hidden="true" />}
            tone={
              data.medications.adherence7Days !== null && data.medications.adherence7Days >= 80
                ? "success"
                : "warning"
            }
          />
          <StatCard
            label="Check-in streak"
            value={`${data.checkIn.streak} ${data.checkIn.streak === 1 ? "day" : "days"}`}
            hint={
              data.checkIn.missedLast7Days > 0
                ? `${data.checkIn.missedLast7Days} missed in the last 7 days`
                : "No missed days this week"
            }
            icon={<CalendarCheck className="size-4" aria-hidden="true" />}
            tone={data.checkIn.missedLast7Days > 0 ? "warning" : "success"}
          />
          <StatCard
            label="People keeping an eye"
            value={data.caregivers.total}
            hint={
              data.caregivers.names.length > 0
                ? data.caregivers.names.join(", ")
                : "Add someone you trust"
            }
            icon={<Users className="size-4" aria-hidden="true" />}
          />
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* -------------------------------------------------------- */}
          {/* Today's medicines                                         */}
          {/* -------------------------------------------------------- */}
          <Card>
            <CardHeader
              title="Today's medicines"
              description="Tap a dose once you have taken it"
              icon={<Pill className="size-5" aria-hidden="true" />}
              action={
                <Link to="/app/medicines">
                  <Button variant="ghost" size="sm">
                    View all
                  </Button>
                </Link>
              }
            />
            <CardBody>
              {dueDoses.length === 0 ? (
                <EmptyState
                  icon={<Pill className="size-6" aria-hidden="true" />}
                  title="No medicines due right now"
                  description="Your next dose will appear here."
                />
              ) : (
                <div className="space-y-4">
                  <ul className="space-y-2">
                    {dueDoses.slice(0, 6).map((dose) => (
                      <li
                        key={dose.key}
                        className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium text-ink-900">{dose.medicationName}</p>
                          <p className="text-sm text-ink-500">
                            {dose.dosage} · {formatClockTime(
                              new Date(dose.scheduledFor).toLocaleTimeString("en-GB", {
                                hour: "2-digit",
                                minute: "2-digit",
                                hour12: false,
                              }),
                            )}
                          </p>
                        </div>
                        <Badge
                          tone={
                            dose.status === "TAKEN"
                              ? "success"
                              : dose.status === "MISSED"
                                ? "danger"
                                : dose.status === "SKIPPED"
                                  ? "neutral"
                                  : "brand"
                          }
                        >
                          {dose.status === "PENDING" ? "Due" : dose.status.toLowerCase()}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center gap-4 border-t border-ink-100 pt-4">
                    <AdherenceDonut taken={takenCount} total={dueDoses.length} size={72} />
                    <p className="text-sm text-ink-600">
                      {takenCount === dueDoses.length
                        ? "All done for today. Well done!"
                        : `${dueDoses.length - takenCount} still to take.`}
                    </p>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* -------------------------------------------------------- */}
          {/* Latest readings                                            */}
          {/* -------------------------------------------------------- */}
          <Card>
            <CardHeader
              title="Latest readings"
              description="Your most recent health measurements"
              icon={<Activity className="size-5" aria-hidden="true" />}
              action={
                <Link to="/app/health">
                  <Button variant="ghost" size="sm">
                    Record
                  </Button>
                </Link>
              }
            />
            <CardBody>
              {data.vitals.latest.length === 0 ? (
                <EmptyState
                  icon={<Activity className="size-6" aria-hidden="true" />}
                  title="No readings yet"
                  description="Record your blood pressure, blood sugar, heart rate or temperature."
                />
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {data.vitals.latest.map((vital) => (
                    <li
                      key={vital.id}
                      className={`rounded-xl border p-4 ${
                        vital.isCritical ? "border-danger-200 bg-danger-50" : "border-ink-200 bg-surface"
                      }`}
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                        {vital.type.replace(/_/g, " ").toLowerCase()}
                      </p>
                      <p className="tabular mt-1 text-xl font-bold text-ink-900">
                        {vital.value}
                        {vital.value2 !== null ? (
                          <span className="text-ink-400">/{vital.value2}</span>
                        ) : null}
                        <span className="ml-1 text-sm font-medium text-ink-500">{vital.unit}</span>
                      </p>
                      <p className="mt-1 text-xs text-ink-500">
                        {smartDateTime(vital.measuredAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Who is watching                                              */}
        {/* ---------------------------------------------------------- */}
        <Card>
          <CardHeader
            title="Your care circle"
            description="The people who are notified when you need help"
            icon={<Users className="size-5" aria-hidden="true" />}
            action={
              <Link to="/app/contacts">
                <Button variant="ghost" size="sm">
                  Manage
                </Button>
              </Link>
            }
          />
          <CardBody>
            {data.caregivers.names.length === 0 ? (
              <EmptyState
                icon={<Users className="size-6" aria-hidden="true" />}
                title="Nobody is watching yet"
                description="Add a family member or carer so that someone is notified if you need help."
              />
            ) : (
              <ul className="flex flex-wrap gap-2">
                {data.caregivers.names.map((name) => (
                  <li key={name}>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100 px-3 py-1.5 text-sm font-medium text-ink-700">
                      <Phone className="size-3.5 text-ink-400" aria-hidden="true" />
                      {name}
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
