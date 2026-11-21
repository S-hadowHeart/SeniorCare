import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Activity, Plus, Thermometer } from "lucide-react";
import { AppShell } from "../../components/layout/AppShell";
import { seniorNavItems } from "../../components/layout/navItems";
import { Button } from "../../components/ui/Button";
import { Card, CardBody, CardHeader } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { EmptyState, ErrorState, LoadingBlock } from "../../components/ui/Feedback";
import { Modal } from "../../components/ui/Modal";
import { SelectInput, TextArea, TextInput } from "../../components/ui/Form";
import { VitalTrendChart } from "../../components/charts/VitalTrendChart";
import { api, ApiError } from "../../lib/api";
import type { Vital, VitalSummary, VitalType } from "../../lib/types";
import { formatNumber, smartDateTime } from "../../lib/format";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";

const TYPES: Array<{ value: VitalType; label: string; unit: string; secondary?: string }> = [
  { value: "BLOOD_PRESSURE", label: "Blood pressure", unit: "mmHg", secondary: "Diastolic" },
  { value: "BLOOD_SUGAR", label: "Blood sugar", unit: "mg/dL" },
  { value: "HEART_RATE", label: "Heart rate", unit: "bpm" },
  { value: "TEMPERATURE", label: "Temperature", unit: "°C" },
  { value: "OXYGEN_SATURATION", label: "Oxygen saturation", unit: "%" },
  { value: "WEIGHT", label: "Weight", unit: "kg" },
];

const RANGES: Partial<Record<VitalType, { min: number; max: number }>> = {
  BLOOD_PRESSURE: { min: 90, max: 130 },
  BLOOD_SUGAR: { min: 70, max: 140 },
  HEART_RATE: { min: 60, max: 100 },
  TEMPERATURE: { min: 36.1, max: 37.2 },
  OXYGEN_SATURATION: { min: 95, max: 100 },
};

export default function VitalsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const elderId = user?.elderId ?? undefined;

  const [formOpen, setFormOpen] = useState(false);
  const [type, setType] = useState<VitalType>("BLOOD_PRESSURE");
  const [value, setValue] = useState("");
  const [value2, setValue2] = useState("");
  const [note, setNote] = useState("");
  const [days, setDays] = useState(30);

  const summary = useQuery({
    queryKey: ["vitals", elderId, "summary", days],
    queryFn: () => api.get<VitalSummary>(`/elders/${elderId}/vitals/summary?days=${days}`),
    enabled: Boolean(elderId),
  });

  const history = useQuery({
    queryKey: ["vitals", elderId, "list", days],
    queryFn: () =>
      api.get<{ items: Vital[]; total: number }>(
        `/elders/${elderId}/vitals?days=${days}&pageSize=50`,
      ),
    enabled: Boolean(elderId),
  });

  const create = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api.post<Vital>(`/elders/${elderId}/vitals`, payload),
    onSuccess: (vital) => {
      setFormOpen(false);
      setValue("");
      setValue2("");
      setNote("");

      if (vital.isCritical) {
        toast.error(
          "That reading is outside your usual range.",
          "Your care circle has been notified. If you feel unwell, contact your doctor.",
        );
      } else {
        toast.success("Reading saved.");
      }

      void queryClient.invalidateQueries({ queryKey: ["vitals"] });
      void queryClient.invalidateQueries({ queryKey: ["elders"] });
    },
    onError: (error) => {
      toast.error(
        "We could not save that reading.",
        error instanceof ApiError ? error.message : "Please try again.",
      );
    },
  });

  const activeType = TYPES.find((item) => item.value === type) ?? TYPES[0]!;

  const submit = () => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      toast.error("Enter a valid number.");
      return;
    }

    create.mutate({
      type,
      value: numeric,
      ...(activeType.secondary && value2 !== "" ? { value2: Number(value2) } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
  };

  return (
    <AppShell navItems={seniorNavItems}>
      <div className="space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900">Health readings</h1>
            <p className="mt-1 text-ink-600">
              Record your blood pressure, blood sugar, heart rate and temperature.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <SelectInput
              aria-label="Time range"
              value={String(days)}
              onChange={(event) => setDays(Number(event.target.value))}
              className="w-32 py-2"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </SelectInput>
            <Button
              size="md"
              leftIcon={<Plus className="size-4" aria-hidden="true" />}
              onClick={() => setFormOpen(true)}
            >
              Record
            </Button>
          </div>
        </header>

        {summary.isLoading ? (
          <LoadingBlock label="Loading readings…" />
        ) : summary.isError ? (
          <ErrorState onRetry={() => void summary.refetch()} />
        ) : (
          <>
            {summary.data && summary.data.criticalCount > 0 ? (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-xl border border-danger-100 bg-danger-50 p-4 text-sm text-danger-800"
              >
                <Thermometer className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
                <p>
                  <strong>
                    {summary.data.criticalCount} reading
                    {summary.data.criticalCount === 1 ? "" : "s"} outside your usual range
                  </strong>{" "}
                  in the last {days} days. Your care circle has been notified.
                </p>
              </div>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-2">
              {(summary.data?.series ?? []).map((series) => (
                <Card key={series.type}>
                  <CardHeader
                    title={series.label}
                    description={`${series.count} reading${series.count === 1 ? "" : "s"} · average ${formatNumber(series.average)} ${series.unit}`}
                    icon={<Activity className="size-5" aria-hidden="true" />}
                    action={
                      series.criticalCount > 0 ? (
                        <Badge tone="danger">{series.criticalCount} out of range</Badge>
                      ) : (
                        <Badge tone="success">In range</Badge>
                      )
                    }
                  />
                  <CardBody>
                    <VitalTrendChart
                      series={series}
                      normalRange={RANGES[series.type]}
                      height={220}
                    />
                  </CardBody>
                </Card>
              ))}
            </div>

            <Card>
              <CardHeader title="Recent readings" />
              <CardBody>
                {history.data && history.data.items.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[34rem] text-left text-sm">
                      <thead>
                        <tr className="border-b border-ink-200 text-xs uppercase tracking-wide text-ink-500">
                          <th scope="col" className="py-2 pr-4 font-semibold">Measurement</th>
                          <th scope="col" className="py-2 pr-4 font-semibold">Value</th>
                          <th scope="col" className="py-2 pr-4 font-semibold">Recorded</th>
                          <th scope="col" className="py-2 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-100">
                        {history.data.items.map((vital) => (
                          <tr key={vital.id}>
                            <td className="py-3 pr-4 font-medium text-ink-900">
                              {vital.type.replace(/_/g, " ").toLowerCase()}
                            </td>
                            <td className="tabular py-3 pr-4 text-ink-700">
                              {formatNumber(vital.value)}
                              {vital.value2 !== null ? ` / ${formatNumber(vital.value2)}` : ""} {vital.unit}
                            </td>
                            <td className="py-3 pr-4 text-ink-500">{smartDateTime(vital.measuredAt)}</td>
                            <td className="py-3">
                              {vital.isCritical ? (
                                <Badge tone="danger">Out of range</Badge>
                              ) : (
                                <Badge tone="success">In range</Badge>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Activity className="size-6" aria-hidden="true" />}
                    title="No readings yet"
                    description="Record your first reading to start building a picture of your health."
                    action={
                      <Button onClick={() => setFormOpen(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>
                        Record a reading
                      </Button>
                    }
                  />
                )}
              </CardBody>
            </Card>
          </>
        )}
      </div>

      {/* ------------------------------------------------------------- */}
      {/* Record reading dialog                                       */}
      {/* ------------------------------------------------------------- */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Record a reading"
        description="It only takes a few seconds."
        footer={
          <>
            <Button variant="outline" size="lg" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button size="lg" loading={create.isPending} onClick={submit}>
              Save reading
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <SelectInput
            label="Measurement"
            value={type}
            onChange={(event) => {
              setType(event.target.value as VitalType);
              setValue("");
              setValue2("");
            }}
          >
            {TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </SelectInput>

          <div className={activeType.secondary ? "grid gap-4 sm:grid-cols-2" : ""}>
            <TextInput
              label={activeType.secondary ? "Systolic (top number)" : `Value (${activeType.unit})`}
              type="number"
              inputMode="decimal"
              step="any"
              placeholder="120"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />

            {activeType.secondary ? (
              <TextInput
                label={`${activeType.secondary} (bottom number)`}
                type="number"
                inputMode="decimal"
                step="any"
                placeholder="80"
                value={value2}
                onChange={(event) => setValue2(event.target.value)}
              />
            ) : null}
          </div>

          <TextArea
            label="Note (optional)"
            placeholder="How were you feeling when you took this reading?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
          />
        </div>
      </Modal>
    </AppShell>
  );
}
