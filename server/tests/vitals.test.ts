import { describe, expect, it } from "vitest";
import {
  DEFAULT_VITAL_UNITS,
  VITAL_LABELS,
  evaluateVital,
} from "../src/lib/vitals.js";
import type { VitalType } from "../src/generated/prisma/enums.js";

type Severity = "normal" | "warning" | "critical";

interface ThresholdCase {
  type: VitalType;
  value: number;
  value2?: number;
  unit?: string;
  severity: Severity;
}

/**
 * A reading is classified as `normal`, `warning` or `critical`. These cases
 * pin the boundaries, because an off-by-one in a clinical threshold is the
 * difference between a quiet dashboard and a false emergency.
 */
const cases: ThresholdCase[] = [
  // Blood pressure — systolic / diastolic in mmHg.
  { type: "BLOOD_PRESSURE", value: 120, value2: 80, severity: "normal" },
  { type: "BLOOD_PRESSURE", value: 129, value2: 84, severity: "normal" },
  { type: "BLOOD_PRESSURE", value: 130, value2: 84, severity: "warning" },
  { type: "BLOOD_PRESSURE", value: 139, value2: 84, severity: "warning" },
  { type: "BLOOD_PRESSURE", value: 140, value2: 84, severity: "warning" },
  { type: "BLOOD_PRESSURE", value: 179, value2: 119, severity: "warning" },
  { type: "BLOOD_PRESSURE", value: 180, value2: 80, severity: "critical" },
  { type: "BLOOD_PRESSURE", value: 120, value2: 120, severity: "critical" },
  { type: "BLOOD_PRESSURE", value: 85, value2: 60, severity: "normal" },
  { type: "BLOOD_PRESSURE", value: 84, value2: 60, severity: "critical" },
  { type: "BLOOD_PRESSURE", value: 120, value2: 50, severity: "normal" },
  { type: "BLOOD_PRESSURE", value: 120, value2: 49, severity: "critical" },
  // A missing diastolic value must not be coerced to zero.
  { type: "BLOOD_PRESSURE", value: 120, severity: "normal" },
  { type: "BLOOD_PRESSURE", value: 140, severity: "warning" },
  { type: "BLOOD_PRESSURE", value: 180, severity: "critical" },
  { type: "BLOOD_PRESSURE", value: 84, severity: "critical" },

  // Heart rate — bpm.
  { type: "HEART_RATE", value: 60, severity: "normal" },
  { type: "HEART_RATE", value: 99, severity: "normal" },
  { type: "HEART_RATE", value: 100, severity: "warning" },
  { type: "HEART_RATE", value: 129, severity: "warning" },
  { type: "HEART_RATE", value: 130, severity: "critical" },
  { type: "HEART_RATE", value: 50, severity: "normal" },
  { type: "HEART_RATE", value: 49, severity: "warning" },
  { type: "HEART_RATE", value: 40, severity: "warning" },
  { type: "HEART_RATE", value: 39, severity: "critical" },

  // Temperature — degrees Celsius.
  { type: "TEMPERATURE", value: 36.1, severity: "normal" },
  { type: "TEMPERATURE", value: 37.2, severity: "normal" },
  { type: "TEMPERATURE", value: 36, severity: "warning" },
  { type: "TEMPERATURE", value: 38, severity: "warning" },
  { type: "TEMPERATURE", value: 39.4, severity: "warning" },
  { type: "TEMPERATURE", value: 39.5, severity: "critical" },
  { type: "TEMPERATURE", value: 35, severity: "warning" },
  { type: "TEMPERATURE", value: 34.9, severity: "critical" },

  // Oxygen saturation — percent.
  { type: "OXYGEN_SATURATION", value: 100, severity: "normal" },
  { type: "OXYGEN_SATURATION", value: 94, severity: "normal" },
  { type: "OXYGEN_SATURATION", value: 93.9, severity: "warning" },
  { type: "OXYGEN_SATURATION", value: 90, severity: "warning" },
  { type: "OXYGEN_SATURATION", value: 89.9, severity: "critical" },

  // Blood sugar — mg/dL.
  { type: "BLOOD_SUGAR", value: 100, severity: "normal" },
  { type: "BLOOD_SUGAR", value: 71, severity: "normal" },
  { type: "BLOOD_SUGAR", value: 70, severity: "warning" },
  { type: "BLOOD_SUGAR", value: 200, severity: "warning" },
  { type: "BLOOD_SUGAR", value: 300, severity: "critical" },
  { type: "BLOOD_SUGAR", value: 55, severity: "warning" },
  { type: "BLOOD_SUGAR", value: 54, severity: "critical" },

  // Blood sugar — mmol/L (unit-aware thresholds).
  { type: "BLOOD_SUGAR", value: 5.5, unit: "mmol/L", severity: "normal" },
  { type: "BLOOD_SUGAR", value: 4.1, unit: "mmol/L", severity: "normal" },
  { type: "BLOOD_SUGAR", value: 4, unit: "mmol/L", severity: "warning" },
  { type: "BLOOD_SUGAR", value: 11.1, unit: "mmol/L", severity: "warning" },
  { type: "BLOOD_SUGAR", value: 16.7, unit: "mmol/L", severity: "critical" },
  { type: "BLOOD_SUGAR", value: 3, unit: "mmol/L", severity: "critical" },

  // Weight is judged against a personal target, never a population range.
  { type: "WEIGHT", value: 42, severity: "normal" },
  { type: "WEIGHT", value: 180, severity: "normal" },
];

describe("evaluateVital", () => {
  it.each(cases)(
    "$type $value (unit: $unit) is $severity",
    ({ type, value, value2, unit, severity }) => {
      const result = evaluateVital(type, value, value2, unit);

      expect(result.severity).toBe(severity);
      expect(result.isCritical).toBe(severity === "critical");
      expect(result.normalRange).toEqual(expect.any(String));
      expect(result.unit).toEqual(expect.any(String));
    },
  );

  it("uses the default unit when the caller does not supply one", () => {
    expect(evaluateVital("HEART_RATE", 72).unit).toBe("bpm");
    expect(evaluateVital("TEMPERATURE", 36.5).unit).toBe("°C");
    expect(evaluateVital("BLOOD_PRESSURE", 120, 80).unit).toBe("mmHg");
  });

  it("respects an explicit unit", () => {
    expect(evaluateVital("HEART_RATE", 72, undefined, "beats/min").unit).toBe("beats/min");
  });

  it("returns a warning message only for out-of-range readings", () => {
    expect(evaluateVital("HEART_RATE", 72).warning).toBeUndefined();
    expect(evaluateVital("HEART_RATE", 110).warning).toEqual(expect.any(String));
    expect(evaluateVital("HEART_RATE", 150).warning).toEqual(expect.any(String));
  });

  it("classifies a missing diastolic value from the systolic value alone", () => {
    // Regression: a systolic-only reading used to be treated as 0/0 and
    // reported as critically low.
    const result = evaluateVital("BLOOD_PRESSURE", 122);
    expect(result.severity).toBe("normal");
    expect(result.isCritical).toBe(false);
  });
});

describe("vital metadata", () => {
  const types: VitalType[] = [
    "BLOOD_PRESSURE",
    "BLOOD_SUGAR",
    "HEART_RATE",
    "TEMPERATURE",
    "OXYGEN_SATURATION",
    "WEIGHT",
  ];

  it.each(types)("has a label and a default unit for %s", (type) => {
    expect(DEFAULT_VITAL_UNITS[type]).toEqual(expect.any(String));
    expect(VITAL_LABELS[type]).toEqual(expect.any(String));
  });
});
