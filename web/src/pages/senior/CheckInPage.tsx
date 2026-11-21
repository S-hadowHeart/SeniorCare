import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CheckCircle2, Frown, Meh, ShieldAlert, Smile } from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";
import { seniorNavItems } from "../../components/layout/navItems";
import { Button } from "../../components/ui/Button";
import { Card, CardBody, CardHeader, StatCard } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { EmptyState, ErrorState, LoadingBlock } from "../../components/ui/Feedback";
import { Modal } from "../../components/ui/Modal";
import { TextArea } from "../../components/ui/Form";
import { api, ApiError } from "../../lib/api";
import type { CheckIn } from "../../lib/types";
import { formatDateTime, relativeTime, smartDateTime } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { useState } from "react";

const MOODS = [
  { value: 1, label: "Very bad", icon: <Frown className="size-5" aria-hidden="true" /> },
  { value: 3, label: "Okay", icon: <Meh className="size-5" aria-hidden="true" /> },
  { value: 5, label: "Great", icon: <Smile className="size-5" aria-hidden="true" /> },
];

export default function CheckInPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const elderId = user?.elderId ?? undefined;

  const [needsHelpOpen, setNeedsHelpOpen] = useState(false);
  const [note, setNote] = useState("");
  const [mood, setMood] = useState<number | undefined>(undefined);

  const checkIns = useQuery({
    queryKey: ["checkins", elderId],
    queryFn: () => api.get<CheckIn[]>(`/elders/${elderId}/checkins?days=30`),
    enabled: Boolean(elderId),
  });

  const today = useQuery({
    queryKey: ["checkins", elderId, "today"],
    queryFn: () =>
      api.get<{ checkedInToday: boolean; checkIn: CheckIn | null }>(
        `/elders/${elderId}/checkins/today`,
      ),
    enabled: Boolean(elderId),
  });

  const submit = useMutation({
    mutationFn: (payload: { status: "SAFE" | "NEEDS_HELP"; mood?: number; note?: string }) =>
      api.post<CheckIn>(`/elders/${elderId}/checkins`, payload),
    onSuccess: (_data, variables) => {
      setNeedsHelpOpen(false);
      setNote("");
      setMood(undefined);
      toast.success(
        variables.status === "SAFE" ? "Thank you — you are marked as safe." : "Your family has been told.",
        variables.status === "SAFE"
          ? "Your care circle can see that you are okay."
          : "They will contact you as soon as they can.",
      );
      void queryClient.invalidateQueries({ queryKey: ["checkins"] });
      void queryClient.invalidateQueries({ queryKey: ["elders"] });
    },
    onError: (error) => {
      toast.error(
        "We could not save your check-in.",
        error instanceof ApiError ? error.message : "Please try again.",
      );
    },
  });

  const items = checkIns.data ?? [];
  const safeDays = items.filter((item) => item.status === "SAFE").length;
  const missedDays = items.filter((item) => item.status === "MISSED").length;
  const todayStatus = today.data?.checkIn?.status ?? null;
  const needsHelp = todayStatus === "NEEDS_HELP";

  return (
    <AppShell navItems={seniorNavItems}>
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight text-ink-900">Daily check-ins</h1>
          <p className="mt-1 text-ink-600">
            Confirm that you are safe each day so that your family knows you are okay.
          </p>
        </header>

        {/* ------------------------------------------------------- */}
        {/* Today's status                                         */}
        {/* ------------------------------------------------------- */}
        <Card>
          <CardBody className="flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
            <span
              className={`flex size-16 shrink-0 items-center justify-center rounded-2xl ${
                needsHelp
                  ? "bg-warning-100 text-warning-700"
                  : today.data?.checkedInToday
                    ? "bg-success-100 text-success-700"
                    : "bg-ink-100 text-ink-400"
              }`}
            >
              {needsHelp ? (
                <ShieldAlert className="size-8" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="size-8" aria-hidden="true" />
              )}
            </span>

            <div className="flex-1">
              <p className="text-lg font-semibold text-ink-900">
                {today.isLoading
                  ? "Checking your status…"
                  : today.isError
                    ? "We could not check your status"
                    : needsHelp
                      ? "Your family has been told you need help"
                      : today.data?.checkedInToday
                        ? "You are marked as safe today"
                        : "You have not checked in yet"}
              </p>
              <p className="mt-1 text-sm text-ink-500">
                {needsHelp
                  ? `You asked for help ${relativeTime(today.data?.checkIn?.createdAt)}. Someone will contact you as soon as they can.`
                  : today.data?.checkIn
                    ? `Last confirmed ${smartDateTime(today.data.checkIn.createdAt)}`
                    : today.isLoading
                      ? "One moment."
                      : today.isError
                        ? "Please check your connection and try again."
                        : "Tap the button below to let your family know you are well."}
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="lg"
                loading={submit.isPending}
                onClick={() => submit.mutate({ status: "SAFE" })}
                leftIcon={<CheckCircle2 className="size-5" aria-hidden="true" />}
              >
                I am safe
              </Button>
              <Button size="lg" variant="outline" onClick={() => setNeedsHelpOpen(true)}>
                I need help
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* ------------------------------------------------------- */}
        {/* Stats                                                  */}
        {/* ------------------------------------------------------- */}
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Checked in (30 days)" value={safeDays} tone="success" icon={<CalendarCheck className="size-4" aria-hidden="true" />} />
          <StatCard label="Missed" value={missedDays} tone={missedDays > 0 ? "warning" : "default"} icon={<Frown className="size-4" aria-hidden="true" />} />
          <StatCard
            label="Most recent"
            value={items[0] ? smartDateTime(items[0].createdAt) : "—"}
            icon={<CheckCircle2 className="size-4" aria-hidden="true" />}
          />
        </div>

        {/* ------------------------------------------------------- */}
        {/* History                                                */}
        {/* ------------------------------------------------------- */}
        <Card>
          <CardHeader title="Check-in history" description="The last 30 days" />
          <CardBody>
            {checkIns.isLoading ? (
              <LoadingBlock label="Loading history…" />
            ) : checkIns.isError ? (
              <ErrorState onRetry={() => void checkIns.refetch()} />
            ) : items.length === 0 ? (
              <EmptyState
                icon={<CalendarCheck className="size-6" aria-hidden="true" />}
                title="No check-ins yet"
                description="Your history will appear here once you confirm you are safe."
              />
            ) : (
              <ul className="divide-y divide-ink-100">
                {items.map((item) => (
                  <li key={item.id} className="flex items-start gap-4 py-3 first:pt-0 last:pb-0">
                    <span
                      className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full ${
                        item.status === "SAFE"
                          ? "bg-success-100 text-success-700"
                          : item.status === "NEEDS_HELP"
                            ? "bg-warning-100 text-warning-700"
                            : "bg-danger-100 text-danger-700"
                      }`}
                    >
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-ink-900">
                          {item.status === "SAFE"
                            ? "Safe"
                            : item.status === "NEEDS_HELP"
                              ? "Asked for help"
                              : "No check-in"}
                        </p>
                        {item.mood ? <Badge tone="neutral">Mood {item.mood}/5</Badge> : null}
                        {item.autoEscalated ? <Badge tone="warning">Automatic</Badge> : null}
                      </div>
                      {item.note ? (
                        <p className="mt-0.5 text-sm text-ink-600">“{item.note}”</p>
                      ) : null}
                      <p className="mt-0.5 text-xs text-ink-400">{formatDateTime(item.createdAt)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {/* ----------------------------------------------------------- */}
      {/* "I need help" dialog                                      */}
      {/* ----------------------------------------------------------- */}
      <Modal
        open={needsHelpOpen}
        onClose={() => setNeedsHelpOpen(false)}
        title="Tell your family you need help"
        description="Everyone in your care circle will be notified straight away."
        footer={
          <>
            <Button variant="outline" size="lg" onClick={() => setNeedsHelpOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="lg"
              loading={submit.isPending}
              onClick={() =>
                submit.mutate({
                  status: "NEEDS_HELP",
                  ...(mood ? { mood } : {}),
                  ...(note.trim() ? { note: note.trim() } : {}),
                })
              }
            >
              Send to my family
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <fieldset>
            <legend className="label">How are you feeling?</legend>
            <div className="flex gap-2">
              {MOODS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setMood(option.value)}
                  aria-pressed={mood === option.value}
                  className={`flex flex-1 flex-col items-center gap-1 rounded-xl border-2 p-3 text-sm font-medium transition ${
                    mood === option.value
                      ? "border-brand-600 bg-brand-50 text-brand-800"
                      : "border-ink-200 text-ink-600 hover:border-ink-300"
                  }`}
                >
                  {option.icon}
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <TextArea
            label="What is happening?"
            placeholder="For example: I have fallen and cannot get up."
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            rows={4}
          />
        </div>
      </Modal>
    </AppShell>
  );
}
