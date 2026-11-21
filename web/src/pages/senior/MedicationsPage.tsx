import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Clock, Pill, Plus, X } from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";
import { seniorNavItems } from "../../components/layout/navItems";
import { Button } from "../../components/ui/Button";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { EmptyState, ErrorState, LoadingBlock } from "../../components/ui/Feedback";
import { Modal } from "../../components/ui/Modal";
import { SelectInput, TextArea, TextInput } from "../../components/ui/Form";
import { DoseBar } from "../../components/charts/AdherenceDonut";
import { api, ApiError } from "../../lib/api";
import type { Medication, Schedule } from "../../lib/types";
import { formatClockTime } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function MedicationsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const elderId = user?.elderId ?? undefined;

  const [days, setDays] = useState(7);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [dosage, setDosage] = useState("");
  const [instructions, setInstructions] = useState("");
  const [scheduleType, setScheduleType] = useState<Medication["scheduleType"]>("DAILY");
  const [times, setTimes] = useState<string[]>(["08:00"]);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1]);

  const schedule = useQuery({
    queryKey: ["schedule", elderId, days],
    queryFn: () =>
      api.get<Schedule>(`/elders/${elderId}/medications/schedule?days=${days}&includePast=true`),
    enabled: Boolean(elderId),
  });

  const medications = useQuery({
    queryKey: ["medications", elderId],
    queryFn: () => api.get<Medication[]>(`/elders/${elderId}/medications`),
    enabled: Boolean(elderId),
  });

  const recordDose = useMutation({
    mutationFn: (payload: { medicationId: string; scheduledFor: string; status: "TAKEN" | "SKIPPED" }) =>
      api.post(
        `/elders/${elderId}/medications/${payload.medicationId}/doses`,
        { scheduledFor: payload.scheduledFor, status: payload.status },
      ),
    onSuccess: (_data, variables) => {
      toast.success(variables.status === "TAKEN" ? "Dose marked as taken." : "Dose marked as skipped.");
      void queryClient.invalidateQueries({ queryKey: ["schedule"] });
      void queryClient.invalidateQueries({ queryKey: ["elders"] });
    },
    onError: (error) => {
      toast.error(
        "We could not update that dose.",
        error instanceof ApiError ? error.message : "Please try again.",
      );
    },
  });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<Medication>(`/elders/${elderId}/medications`, payload),
    onSuccess: () => {
      setFormOpen(false);
      setName("");
      setDosage("");
      setInstructions("");
      toast.success("Medicine added to your schedule.");
      void queryClient.invalidateQueries({ queryKey: ["medications"] });
      void queryClient.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (error) => {
      const fieldMessage =
        error instanceof ApiError ? Object.values(error.fieldErrors)[0] : undefined;
      toast.error(
        "We could not add that medicine.",
        fieldMessage ?? (error instanceof ApiError ? error.message : "Please try again."),
      );
    },
  });

  const toggleTime = (time: string) => {
    setTimes((current) =>
      current.includes(time) ? current.filter((item) => item !== time) : [...current, time].sort(),
    );
  };

  const submit = () => {
    if (!name.trim() || !dosage.trim()) {
      toast.error("Enter the name and the dosage.");
      return;
    }

    create.mutate({
      name: name.trim(),
      dosage: dosage.trim(),
      instructions: instructions.trim() || null,
      scheduleType,
      times: scheduleType === "DAILY" || scheduleType === "WEEKLY" ? times : [],
      daysOfWeek: scheduleType === "WEEKLY" ? daysOfWeek : [],
      notifyCaregivers: true,
    });
  };

  const grouped = new Map<string, Schedule["doses"]>();
  for (const dose of schedule.data?.doses ?? []) {
    const key = new Date(dose.scheduledFor).toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
    const bucket = grouped.get(key);
    if (bucket) bucket.push(dose);
    else grouped.set(key, [dose]);
  }

  return (
    <AppShell navItems={seniorNavItems}>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">Medicines</h1>
            <p className="mt-1 text-ink-600">Your schedule and what you have taken.</p>
          </div>

          <div className="flex items-center gap-2">
            <SelectInput
              aria-label="Range"
              value={String(days)}
              onChange={(event) => setDays(Number(event.target.value))}
              className="w-36 py-2"
            >
              <option value="1">Today</option>
              <option value="7">Next 7 days</option>
              <option value="14">Next 14 days</option>
            </SelectInput>
            <Button
              leftIcon={<Plus className="size-4" aria-hidden="true" />}
              onClick={() => setFormOpen(true)}
            >
              Add
            </Button>
          </div>
        </header>

        {schedule.isLoading ? (
          <LoadingBlock label="Loading your schedule…" />
        ) : schedule.isError ? (
          <ErrorState onRetry={() => void schedule.refetch()} />
        ) : (
          <>
            {schedule.data ? (
              <Card>
                <CardHeader
                  title="How you are doing"
                  description={`${schedule.data.adherence.taken} taken · ${schedule.data.adherence.missed} missed · ${schedule.data.adherence.pending} still due`}
                  icon={<Pill className="size-5" aria-hidden="true" />}
                />
                <CardBody>
                  <DoseBar
                    taken={schedule.data.adherence.taken}
                    skipped={schedule.data.adherence.skipped}
                    missed={schedule.data.adherence.missed}
                    pending={schedule.data.adherence.pending}
                  />
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-500">
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-success-500" aria-hidden="true" /> Taken
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-ink-400" aria-hidden="true" /> Skipped
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-danger-500" aria-hidden="true" /> Missed
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-brand-200" aria-hidden="true" /> Due
                    </span>
                  </div>
                </CardBody>
              </Card>
            ) : null}

            {grouped.size === 0 ? (
              <Card>
                <CardBody>
                  <EmptyState
                    icon={<Pill className="size-6" aria-hidden="true" />}
                    title="No medicines scheduled"
                    description="Add a medicine and it will appear here with reminders."
                    action={
                      <Button onClick={() => setFormOpen(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>
                        Add a medicine
                      </Button>
                    }
                  />
                </CardBody>
              </Card>
            ) : (
              <div className="space-y-6">
                {Array.from(grouped.entries()).map(([day, doses]) => (
                  <Card key={day}>
                    <CardHeader title={day} description={`${doses.length} dose${doses.length === 1 ? "" : "s"}`} />
                    <CardBody>
                      <ul className="space-y-3">
                        {doses.map((dose) => {
                          const due = new Date(dose.scheduledFor);
                          const time = due.toLocaleTimeString("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                            hour12: false,
                          });

                          return (
                            <li
                              key={dose.key}
                              className={`flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center ${
                                dose.status === "TAKEN"
                                  ? "border-success-100 bg-success-50"
                                  : dose.status === "MISSED"
                                    ? "border-danger-100 bg-danger-50"
                                    : "border-ink-200 bg-surface"
                              }`}
                            >
                              <div className="flex min-w-0 flex-1 items-center gap-3">
                                <span className="tabular flex size-11 shrink-0 flex-col items-center justify-center rounded-lg bg-surface text-xs font-bold text-ink-700 ring-1 ring-ink-200">
                                  {time}
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-ink-900">
                                    {dose.medicationName}
                                  </p>
                                  <p className="truncate text-sm text-ink-500">{dose.dosage}</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-2">
                                {dose.status === "TAKEN" ? (
                                  <Badge tone="success">Taken</Badge>
                                ) : dose.status === "SKIPPED" ? (
                                  <Badge tone="neutral">Skipped</Badge>
                                ) : dose.status === "MISSED" ? (
                                  <Badge tone="danger">Missed</Badge>
                                ) : (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        recordDose.mutate({
                                          medicationId: dose.medicationId,
                                          scheduledFor: dose.scheduledFor,
                                          status: "SKIPPED",
                                        })
                                      }
                                      leftIcon={<X className="size-3.5" aria-hidden="true" />}
                                    >
                                      Skip
                                    </Button>
                                    <Button
                                      size="sm"
                                      loading={
                                        recordDose.isPending &&
                                        recordDose.variables?.scheduledFor === dose.scheduledFor
                                      }
                                      onClick={() =>
                                        recordDose.mutate({
                                          medicationId: dose.medicationId,
                                          scheduledFor: dose.scheduledFor,
                                          status: "TAKEN",
                                        })
                                      }
                                      leftIcon={<Check className="size-3.5" aria-hidden="true" />}
                                    >
                                      Taken
                                    </Button>
                                  </>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}

            {/* ---------------------------------------------------- */}
            {/* Medication list                                      */}
            {/* ---------------------------------------------------- */}
            <Card>
              <CardHeader
                title="All medicines"
                description={`${medications.data?.length ?? 0} on your record`}
                icon={<Clock className="size-5" aria-hidden="true" />}
              />
              <CardBody>
                {medications.data && medications.data.length > 0 ? (
                  <ul className="divide-y divide-ink-100">
                    {medications.data.map((medication) => (
                      <li key={medication.id} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
                        <div className="min-w-0">
                          <p className="font-medium text-ink-900">{medication.name}</p>
                          <p className="text-sm text-ink-500">{medication.dosage}</p>
                          {medication.instructions ? (
                            <p className="mt-0.5 text-xs text-ink-400">{medication.instructions}</p>
                          ) : null}
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-medium text-ink-700">
                            {medication.scheduleType === "AS_NEEDED"
                              ? "As needed"
                              : medication.scheduleType === "INTERVAL"
                                ? `Every ${medication.intervalMinutes} min`
                                : medication.times.map(formatClockTime).join(", ")}
                          </p>
                          {!medication.active ? (
                            <Badge tone="neutral" className="mt-1">Stopped</Badge>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No medicines on your record yet" />
                )}
              </CardBody>
            </Card>
          </>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* Add medicine dialog                                          */}
      {/* ------------------------------------------------------------- */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Add a medicine"
        description="You will get a reminder at the times you choose."
        footer={
          <>
            <Button variant="outline" size="lg" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button size="lg" loading={create.isPending} onClick={submit}>
              Add medicine
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <TextInput
            label="Name"
            placeholder="Amlodipine"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
          <TextInput
            label="Dose"
            placeholder="5 mg"
            value={dosage}
            onChange={(event) => setDosage(event.target.value)}
            required
          />
          <TextArea
            label="Instructions (optional)"
            placeholder="Take in the morning with water."
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />

          <SelectInput
            label="How often"
            value={scheduleType}
            onChange={(event) => setScheduleType(event.target.value as Medication["scheduleType"])}
          >
            <option value="DAILY">Every day</option>
            <option value="WEEKLY">Certain days of the week</option>
            <option value="AS_NEEDED">As needed (no reminders)</option>
          </SelectInput>

          {scheduleType === "DAILY" || scheduleType === "WEEKLY" ? (
            <>
              <fieldset>
                <legend className="label">Times</legend>
                <div className="flex flex-wrap gap-2">
                  {["06:00", "08:00", "12:00", "18:00", "20:00", "22:00"].map((time) => (
                    <button
                      key={time}
                      type="button"
                      onClick={() => toggleTime(time)}
                      aria-pressed={times.includes(time)}
                      className={`rounded-lg border-2 px-3 py-2 text-sm font-medium tabular transition ${
                        times.includes(time)
                          ? "border-brand-600 bg-brand-50 text-brand-800"
                          : "border-ink-200 text-ink-600 hover:border-ink-300"
                      }`}
                    >
                      {formatClockTime(time)}
                    </button>
                  ))}
                </div>
              </fieldset>

              {scheduleType === "WEEKLY" ? (
                <fieldset>
                  <legend className="label">Days of the week</legend>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((day, index) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() =>
                          setDaysOfWeek((current) =>
                            current.includes(index)
                              ? current.filter((item) => item !== index)
                              : [...current, index].sort(),
                          )
                        }
                        aria-pressed={daysOfWeek.includes(index)}
                        className={`rounded-lg border-2 px-3 py-2 text-sm font-medium transition ${
                          daysOfWeek.includes(index)
                            ? "border-brand-600 bg-brand-50 text-brand-800"
                            : "border-ink-200 text-ink-600 hover:border-ink-300"
                        }`}
                      >
                        {day.slice(0, 3)}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ) : null}
            </>
          ) : null}
        </div>
      </Modal>
    </AppShell>
  );
}
