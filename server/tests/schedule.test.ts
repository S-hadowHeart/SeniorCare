import { describe, expect, it } from "vitest";
import {
  dosesForLocalDay,
  expandDoses,
  type SchedulableMedication,
} from "../src/lib/schedule.js";

const START = new Date("2026-01-01T00:00:00Z");

function medication(overrides: Partial<SchedulableMedication> = {}): SchedulableMedication {
  return {
    id: "med-1",
    name: "Amlodipine",
    dosage: "5 mg",
    scheduleType: "DAILY",
    times: ["08:00", "20:00"],
    daysOfWeek: [],
    intervalMinutes: null,
    startDate: START,
    endDate: null,
    active: true,
    ...overrides,
  };
}

const iso = (doses: ReturnType<typeof expandDoses>): string[] =>
  doses.map((dose) => dose.scheduledFor.toISOString());

describe("expandDoses — daily schedules", () => {
  it("expands every local time in the window", () => {
    const doses = expandDoses(
      medication(),
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-02T23:59:59Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual([
      "2026-11-01T08:00:00.000Z",
      "2026-11-01T20:00:00.000Z",
      "2026-11-02T08:00:00.000Z",
      "2026-11-02T20:00:00.000Z",
    ]);
  });

  it("excludes doses outside the requested window", () => {
    const doses = expandDoses(
      medication(),
      new Date("2026-11-01T09:00:00Z"),
      new Date("2026-11-01T21:00:00Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual(["2026-11-01T20:00:00.000Z"]);
  });

  it("respects the start and end dates", () => {
    const doses = expandDoses(
      medication({
        startDate: new Date("2026-11-02T00:00:00Z"),
        endDate: new Date("2026-11-02T10:00:00Z"),
      }),
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-03T23:59:59Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual(["2026-11-02T08:00:00.000Z"]);
  });

  it("sorts chronologically and ignores malformed times", () => {
    const doses = expandDoses(
      medication({ times: ["20:00", "25:00", "08:00", "08:60"] }),
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-01T23:59:59Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual([
      "2026-11-01T08:00:00.000Z",
      "2026-11-01T20:00:00.000Z",
    ]);
  });

  it("returns nothing for inactive or as-needed medication", () => {
    const from = new Date("2026-11-01T00:00:00Z");
    const to = new Date("2026-11-02T00:00:00Z");

    expect(expandDoses(medication({ active: false }), from, to, "UTC")).toEqual([]);
    expect(expandDoses(medication({ scheduleType: "AS_NEEDED" }), from, to, "UTC")).toEqual([]);
  });

  it("returns nothing when the window is empty or inverted", () => {
    const instant = new Date("2026-11-01T00:00:00Z");
    const later = new Date("2026-11-02T00:00:00Z");

    expect(expandDoses(medication(), instant, instant, "UTC")).toEqual([]);
    expect(expandDoses(medication(), later, instant, "UTC")).toEqual([]);
  });
});

describe("expandDoses — weekly schedules", () => {
  it("only emits doses on the selected weekday", () => {
    // 2026-11-02 is a Monday.
    const doses = expandDoses(
      medication({ scheduleType: "WEEKLY", times: ["09:00"], daysOfWeek: [1] }),
      new Date("2026-11-02T00:00:00Z"),
      new Date("2026-11-09T00:00:00Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual(["2026-11-02T09:00:00.000Z"]);
  });

  it("emits one dose per selected weekday across a full week", () => {
    const doses = expandDoses(
      medication({ scheduleType: "WEEKLY", times: ["09:00"], daysOfWeek: [1] }),
      new Date("2026-11-02T00:00:00Z"),
      new Date("2026-11-09T23:59:59Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual([
      "2026-11-02T09:00:00.000Z",
      "2026-11-09T09:00:00.000Z",
    ]);
  });

  it("treats an empty weekday list as every day", () => {
    const doses = expandDoses(
      medication({ scheduleType: "WEEKLY", times: ["09:00"], daysOfWeek: [] }),
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-01T23:59:59Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual(["2026-11-01T09:00:00.000Z"]);
  });

  it("uses Sunday = 0", () => {
    // 2026-11-01 is a Sunday.
    const doses = expandDoses(
      medication({ scheduleType: "WEEKLY", times: ["10:00"], daysOfWeek: [0] }),
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-02T00:00:00Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual(["2026-11-01T10:00:00.000Z"]);
  });
});

describe("expandDoses — interval schedules", () => {
  it("anchors the interval on the start date", () => {
    const doses = expandDoses(
      medication({
        scheduleType: "INTERVAL",
        times: [],
        intervalMinutes: 240,
        startDate: new Date("2026-11-01T08:00:00Z"),
      }),
      new Date("2026-11-01T08:00:00Z"),
      new Date("2026-11-01T20:00:00Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual([
      "2026-11-01T08:00:00.000Z",
      "2026-11-01T12:00:00.000Z",
      "2026-11-01T16:00:00.000Z",
      "2026-11-01T20:00:00.000Z",
    ]);
  });

  it("starts at the first interval boundary inside the window", () => {
    const doses = expandDoses(
      medication({
        scheduleType: "INTERVAL",
        times: [],
        intervalMinutes: 240,
        startDate: new Date("2026-11-01T08:00:00Z"),
      }),
      new Date("2026-11-01T09:00:00Z"),
      new Date("2026-11-01T20:00:00Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual([
      "2026-11-01T12:00:00.000Z",
      "2026-11-01T16:00:00.000Z",
      "2026-11-01T20:00:00.000Z",
    ]);
  });

  it("stops at the end date", () => {
    const doses = expandDoses(
      medication({
        scheduleType: "INTERVAL",
        times: [],
        intervalMinutes: 240,
        startDate: new Date("2026-11-01T08:00:00Z"),
        endDate: new Date("2026-11-01T17:00:00Z"),
      }),
      new Date("2026-11-01T08:00:00Z"),
      new Date("2026-11-01T23:59:59Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual([
      "2026-11-01T08:00:00.000Z",
      "2026-11-01T12:00:00.000Z",
      "2026-11-01T16:00:00.000Z",
    ]);
  });

  it("defaults to a 60 minute interval", () => {
    const doses = expandDoses(
      medication({
        scheduleType: "INTERVAL",
        times: [],
        intervalMinutes: null,
        startDate: new Date("2026-11-01T08:00:00Z"),
      }),
      new Date("2026-11-01T08:00:00Z"),
      new Date("2026-11-01T11:00:00Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual([
      "2026-11-01T08:00:00.000Z",
      "2026-11-01T09:00:00.000Z",
      "2026-11-01T10:00:00.000Z",
      "2026-11-01T11:00:00.000Z",
    ]);
  });
});

describe("expandDoses — time zones and DST", () => {
  it("keeps the local wall-clock time across the end of DST", () => {
    // Europe/London: clocks go back on 2026-10-25.
    const doses = expandDoses(
      medication({ times: ["08:00"] }),
      new Date("2026-10-24T00:00:00Z"),
      new Date("2026-10-26T00:00:00Z"),
      "Europe/London",
    );

    expect(iso(doses)).toEqual([
      "2026-10-24T07:00:00.000Z",
      "2026-10-25T08:00:00.000Z",
    ]);
  });

  it("keeps the local wall-clock time across the start of DST", () => {
    // Europe/London: clocks go forward on 2026-03-29.
    const doses = expandDoses(
      medication({ times: ["08:00"] }),
      new Date("2026-03-28T00:00:00Z"),
      new Date("2026-03-30T00:00:00Z"),
      "Europe/London",
    );

    expect(iso(doses)).toEqual([
      "2026-03-28T08:00:00.000Z",
      "2026-03-29T07:00:00.000Z",
    ]);
  });
});

describe("dosesForLocalDay", () => {
  it("returns only the doses that belong to the requested local day", () => {
    const doses = dosesForLocalDay(
      medication(),
      new Date("2026-11-01T12:00:00Z"),
      "UTC",
    );

    expect(iso(doses)).toEqual([
      "2026-11-01T08:00:00.000Z",
      "2026-11-01T20:00:00.000Z",
    ]);
  });
});
