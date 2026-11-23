import { describe, expect, it } from "vitest";
import {
  addDays,
  endOfLocalDay,
  getLocalDateKey,
  getLocalDayOfWeek,
  getTimeZoneOffsetMs,
  getZonedParts,
  parseTimeOfDay,
  startOfLocalDay,
  zonedTimeToUtc,
} from "../src/lib/time.js";

const HOUR = 60 * 60 * 1000;

describe("wall-clock conversion", () => {
  it("decomposes an instant into the parts of a time zone", () => {
    const parts = getZonedParts(new Date("2026-11-23T12:34:56Z"), "Asia/Kolkata");

    expect(parts).toEqual({
      year: 2026,
      month: 11,
      day: 23,
      hour: 18,
      minute: 4,
      second: 56,
    });
  });

  it("computes the local date key across a midnight boundary", () => {
    expect(getLocalDateKey(new Date("2026-11-23T20:00:00Z"), "Asia/Kolkata")).toBe(
      "2026-11-24",
    );
    expect(getLocalDateKey(new Date("2026-11-23T20:00:00Z"), "UTC")).toBe("2026-11-23");
  });

  it("reports the offset that applies at the instant (DST aware)", () => {
    expect(getTimeZoneOffsetMs(new Date("2026-07-01T12:00:00Z"), "Europe/London")).toBe(HOUR);
    expect(getTimeZoneOffsetMs(new Date("2026-12-01T12:00:00Z"), "Europe/London")).toBe(0);
  });

  it("converts wall-clock time to the correct UTC instant in both seasons", () => {
    expect(
      zonedTimeToUtc(
        { year: 2026, month: 7, day: 1, hour: 8, minute: 0 },
        "Europe/London",
      ).toISOString(),
    ).toBe("2026-07-01T07:00:00.000Z");

    expect(
      zonedTimeToUtc(
        { year: 2026, month: 11, day: 23, hour: 8, minute: 0 },
        "Europe/London",
      ).toISOString(),
    ).toBe("2026-11-23T08:00:00.000Z");
  });
});

describe("local day boundaries", () => {
  it("is a 24-hour day in a zone without DST", () => {
    const instant = new Date("2026-11-23T12:00:00Z");
    const start = startOfLocalDay(instant, "Asia/Kolkata");
    const end = endOfLocalDay(instant, "Asia/Kolkata");

    expect(end.getTime() - start.getTime()).toBe(24 * HOUR);
  });

  it("is a 25-hour day when DST ends", () => {
    // Europe/London: clocks go back on 2026-10-25.
    const instant = new Date("2026-10-25T12:00:00Z");
    const start = startOfLocalDay(instant, "Europe/London");
    const end = endOfLocalDay(instant, "Europe/London");

    expect(start.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-26T00:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(25 * HOUR);
  });

  it("is a 23-hour day when DST starts", () => {
    // Europe/London: clocks go forward on 2026-03-29.
    const instant = new Date("2026-03-29T12:00:00Z");
    const start = startOfLocalDay(instant, "Europe/London");
    const end = endOfLocalDay(instant, "Europe/London");

    expect(start.toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-29T23:00:00.000Z");
    expect(end.getTime() - start.getTime()).toBe(23 * HOUR);
  });
});

describe("calendar helpers", () => {
  it("uses 0 = Sunday … 6 = Saturday", () => {
    expect(getLocalDayOfWeek(new Date("2026-11-01T12:00:00Z"), "UTC")).toBe(0);
    expect(getLocalDayOfWeek(new Date("2026-11-02T12:00:00Z"), "UTC")).toBe(1);
    expect(getLocalDayOfWeek(new Date("2026-11-07T12:00:00Z"), "UTC")).toBe(6);
  });

  it("parses valid HH:mm values", () => {
    expect(parseTimeOfDay("08:30")).toEqual({ hour: 8, minute: 30 });
    expect(parseTimeOfDay("8:05")).toEqual({ hour: 8, minute: 5 });
    expect(parseTimeOfDay("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseTimeOfDay(" 07:15 ")).toEqual({ hour: 7, minute: 15 });
  });

  it("rejects malformed times", () => {
    for (const value of ["24:00", "12:60", "08:5", "abc", "", "-1:00"]) {
      expect(parseTimeOfDay(value)).toBeNull();
    }
  });

  it("adds whole days across month and year boundaries", () => {
    expect(addDays({ year: 2026, month: 12, day: 31, hour: 8, minute: 0, second: 0 }, 1)).toEqual({
      year: 2027,
      month: 1,
      day: 1,
      hour: 8,
      minute: 0,
      second: 0,
    });

    expect(addDays({ year: 2028, month: 2, day: 28, hour: 0, minute: 0, second: 0 }, 1)).toEqual({
      year: 2028,
      month: 2,
      day: 29,
      hour: 0,
      minute: 0,
      second: 0,
    });
  });
});
