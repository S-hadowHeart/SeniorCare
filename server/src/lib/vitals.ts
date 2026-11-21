import type { VitalType } from "../generated/prisma/enums.js";

/**
 * Clinical reference ranges for the readings tracked by the app.
 *
 * The ranges are intentionally conservative and are used for two purposes:
 *  - flagging a reading as `warning` or `critical` so that caregivers are
 *    notified in the dashboard;
 *  - surfacing an informative hint next to the value in the UI.
 *
 * They are **not** a diagnosis. The copy shown to users always points to a
 * clinician for anything out of range.
 */

export type VitalSeverity = "normal" | "warning" | "critical";

export interface VitalEvaluation {
  severity: VitalSeverity;
  isCritical: boolean;
  warning?: string;
  normalRange: string;
  unit: string;
}

interface Rule {
  unit: string;
  normalRange: string;
  evaluate: (value: number, secondary?: number) => { severity: VitalSeverity; warning?: string };
}

const rules: Record<VitalType, Rule> = {
  BLOOD_PRESSURE: {
    unit: "mmHg",
    normalRange: "90–130 / 60–85 mmHg",
    evaluate: (systolic, diastolic) => {
      if (systolic >= 180 || (diastolic ?? 0) >= 120) {
        return {
          severity: "critical",
          warning: "Blood pressure is in the hypertensive crisis range. Seek medical help now.",
        };
      }
      if (systolic < 85 || (diastolic ?? 0) < 50) {
        return {
          severity: "critical",
          warning: "Blood pressure is dangerously low. Seek medical help now.",
        };
      }
      if (systolic >= 140 || (diastolic ?? 0) >= 90) {
        return {
          severity: "warning",
          warning: "Blood pressure is above the usual target range.",
        };
      }
      if (systolic >= 130 || (diastolic ?? 0) >= 85) {
        return {
          severity: "warning",
          warning: "Blood pressure is slightly above the usual target range.",
        };
      }
      return { severity: "normal" };
    },
  },

  BLOOD_SUGAR: {
    unit: "mg/dL",
    normalRange: "70–140 mg/dL (fasting)",
    evaluate: (value, secondary) => {
      // Support both mg/dL and mmol/L by interpreting the secondary "unit hint".
      const isMmol = secondary === 1;
      const criticalHigh = isMmol ? 16.7 : 300;
      const criticalLow = isMmol ? 3 : 54;
      const warningHigh = isMmol ? 11.1 : 200;
      const warningLow = isMmol ? 4 : 70;

      if (value >= criticalHigh) {
        return { severity: "critical", warning: "Blood sugar is dangerously high." };
      }
      if (value <= criticalLow) {
        return { severity: "critical", warning: "Blood sugar is dangerously low." };
      }
      if (value >= warningHigh) {
        return { severity: "warning", warning: "Blood sugar is above the target range." };
      }
      if (value <= warningLow) {
        return { severity: "warning", warning: "Blood sugar is below the target range." };
      }
      return { severity: "normal" };
    },
  },

  HEART_RATE: {
    unit: "bpm",
    normalRange: "60–100 bpm",
    evaluate: (value) => {
      if (value >= 130) {
        return { severity: "critical", warning: "Heart rate is very high. Seek medical advice." };
      }
      if (value < 40) {
        return { severity: "critical", warning: "Heart rate is very low. Seek medical advice." };
      }
      if (value >= 100) {
        return { severity: "warning", warning: "Heart rate is above the resting target." };
      }
      if (value < 50) {
        return { severity: "warning", warning: "Heart rate is below the resting target." };
      }
      return { severity: "normal" };
    },
  },

  TEMPERATURE: {
    unit: "°C",
    normalRange: "36.1–37.2 °C",
    evaluate: (value) => {
      if (value >= 39.5) {
        return { severity: "critical", warning: "High fever. Contact a clinician promptly." };
      }
      if (value < 35) {
        return { severity: "critical", warning: "Body temperature is dangerously low." };
      }
      if (value >= 38) {
        return { severity: "warning", warning: "Fever detected. Monitor closely." };
      }
      if (value < 36.1) {
        return { severity: "warning", warning: "Body temperature is slightly low." };
      }
      return { severity: "normal" };
    },
  },

  OXYGEN_SATURATION: {
    unit: "%",
    normalRange: "95–100 %",
    evaluate: (value) => {
      if (value < 90) {
        return { severity: "critical", warning: "Oxygen saturation is critically low." };
      }
      if (value < 94) {
        return { severity: "warning", warning: "Oxygen saturation is below the target range." };
      }
      return { severity: "normal" };
    },
  },

  WEIGHT: {
    unit: "kg",
    normalRange: "Personal target",
    evaluate: () => ({ severity: "normal" }),
  },
};

/**
 * Evaluate a reading against its reference range.
 *
 * `value2` carries the secondary measurement (diastolic pressure) and, for
 * blood sugar, a unit hint (`1` = mmol/L, `0` = mg/dL) supplied by the
 * caller.
 */
export function evaluateVital(
  type: VitalType,
  value: number,
  value2?: number,
  unit?: string,
): VitalEvaluation {
  const rule = rules[type];
  const isMmolSugar = type === "BLOOD_SUGAR" && unit?.toLowerCase().startsWith("mmol");
  const secondary = type === "BLOOD_PRESSURE" ? value2 : isMmolSugar ? 1 : undefined;
  const result = rule.evaluate(value, secondary);

  return {
    severity: result.severity,
    isCritical: result.severity === "critical",
    warning: result.warning,
    normalRange: rule.normalRange,
    unit: unit ?? rule.unit,
  };
}

/** Default unit for each vital type — used to pre-fill the UI. */
export const DEFAULT_VITAL_UNITS: Record<VitalType, string> = {
  BLOOD_PRESSURE: "mmHg",
  BLOOD_SUGAR: "mg/dL",
  HEART_RATE: "bpm",
  TEMPERATURE: "°C",
  OXYGEN_SATURATION: "%",
  WEIGHT: "kg",
};

/** Human readable label for a vital type. */
export const VITAL_LABELS: Record<VitalType, string> = {
  BLOOD_PRESSURE: "Blood pressure",
  BLOOD_SUGAR: "Blood sugar",
  HEART_RATE: "Heart rate",
  TEMPERATURE: "Temperature",
  OXYGEN_SATURATION: "Oxygen saturation",
  WEIGHT: "Weight",
};
