import { env } from "../config/env.js";

/**
 * E-mail templates.
 *
 * The markup is intentionally table based with inline styles: that is the
 * only layout approach that survives Outlook, Gmail and Apple Mail without
 * a build step for a client-side CSS inliner.
 */

interface LayoutOptions {
  title: string;
  preheader: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  footerNote?: string;
}

function layout(options: LayoutOptions): string {
  const { title, preheader, bodyHtml, ctaLabel, ctaUrl, footerNote } = options;

  const button =
    ctaLabel && ctaUrl
      ? `<tr>
          <td style="padding:8px 32px 32px 32px;">
            <a href="${ctaUrl}"
               style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;
                      padding:12px 22px;border-radius:8px;font-weight:600;font-size:16px;">
              ${ctaLabel}
            </a>
          </td>
        </tr>`
      : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0"
                 style="width:600px;max-width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.12);">
            <tr>
              <td style="background:#0f766e;padding:20px 32px;color:#ffffff;font-size:20px;font-weight:700;">
                SeniorCare
              </td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px 32px;color:#0f172a;font-size:20px;font-weight:700;line-height:1.3;">
                ${title}
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 24px 32px;color:#334155;font-size:16px;line-height:1.6;">
                ${bodyHtml}
              </td>
            </tr>
            ${button}
            <tr>
              <td style="padding:16px 32px 28px 32px;color:#64748b;font-size:13px;line-height:1.5;border-top:1px solid #e2e8f0;">
                ${footerNote ?? `You are receiving this message because you are listed as a contact for someone using SeniorCare.`}
                <br />
                <a href="${env.WEB_APP_URL}" style="color:#0f766e;">Open SeniorCare</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export interface SosEmailInput {
  elderName: string;
  message?: string | null;
  locationUrl?: string | null;
  occurredAt: Date;
}

export function sosAlertEmail(input: SosEmailInput): { subject: string; html: string; text: string } {
  const subject = `SOS: ${input.elderName} needs help`;

  const bodyHtml = `
    <p><strong>${input.elderName}</strong> has triggered an emergency alert${
      input.occurredAt ? ` at ${input.occurredAt.toISOString()}` : ""
    }.</p>
    ${input.message ? `<p style="margin:16px 0;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:6px;">“${input.message}”</p>` : ""}
    ${
      input.locationUrl
        ? `<p style="margin:16px 0;">Their location was shared: <a href="${input.locationUrl}" style="color:#0f766e;">open in maps</a>.</p>`
        : `<p style="margin:16px 0;color:#b91c1c;">No location was available for this alert.</p>`
    }
    <p>Please contact them as soon as possible. If this is an emergency, call the local emergency number.</p>
  `;

  const text = [
    `SOS: ${input.elderName} needs help`,
    input.occurredAt ? `Time: ${input.occurredAt.toISOString()}` : "",
    input.message ? `Message: ${input.message}` : "",
    input.locationUrl ? `Location: ${input.locationUrl}` : "Location: unavailable",
    "Please contact them as soon as possible.",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject,
    html: layout({
      title: `🆘 Emergency alert — ${input.elderName}`,
      preheader: `${input.elderName} triggered an SOS alert.`,
      bodyHtml,
      ctaLabel: "Open the dashboard",
      ctaUrl: `${env.WEB_APP_URL}/caregiver`,
      footerNote: "This is an automated emergency notification from SeniorCare.",
    }),
    text,
  };
}

export interface MissedCheckInEmailInput {
  elderName: string;
  deadlineHour: number;
}

export function missedCheckInEmail(input: MissedCheckInEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `No safety check-in from ${input.elderName}`;

  const bodyHtml = `
    <p><strong>${input.elderName}</strong> has not confirmed that they are safe today.</p>
    <p>Daily check-ins are expected before ${String(input.deadlineHour).padStart(2, "0")}:00.
       If this was intentional there is nothing to do — otherwise please get in touch with them.</p>
  `;

  return {
    subject,
    html: layout({
      title: `No check-in from ${input.elderName}`,
      preheader: `${input.elderName} has not checked in today.`,
      bodyHtml,
      ctaLabel: "Open the dashboard",
      ctaUrl: `${env.WEB_APP_URL}/caregiver`,
    }),
    text: [
      `No safety check-in from ${input.elderName} today.`,
      `Daily check-ins are expected before ${String(input.deadlineHour).padStart(2, "0")}:00.`,
      "Please get in touch with them.",
    ].join("\n"),
  };
}

export interface NeedsHelpEmailInput {
  elderName: string;
  note?: string | null;
}

/**
 * A senior explicitly pressed "I need help". This must never reuse the
 * missed-check-in copy: telling a contact that someone "has not checked in"
 * when they have just asked for help sends the wrong message.
 */
export function needsHelpEmail(input: NeedsHelpEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `${input.elderName} asked for help`;

  const bodyHtml = `
    <p><strong>${input.elderName}</strong> has just confirmed their daily check-in and asked for help.</p>
    ${
      input.note
        ? `<p style="margin:16px 0;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:6px;">“${input.note}”</p>`
        : ""
    }
    <p>Please contact them as soon as possible. If this is an emergency, call the local emergency number.</p>
  `;

  return {
    subject,
    html: layout({
      title: `🆘 ${input.elderName} asked for help`,
      preheader: `${input.elderName} requested help during their daily check-in.`,
      bodyHtml,
      ctaLabel: "Open the dashboard",
      ctaUrl: `${env.WEB_APP_URL}/caregiver`,
      footerNote: "This is an automated safety notification from SeniorCare.",
    }),
    text: [
      `${input.elderName} asked for help during their daily check-in.`,
      input.note ? `Message: ${input.note}` : "",
      "Please contact them as soon as possible.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export interface MedicationEmailInput {
  elderName: string;
  medicationName: string;
  dosage: string;
  scheduledFor: Date;
}

export function medicationReminderEmail(input: MedicationEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Reminder: ${input.medicationName} for ${input.elderName}`;

  const bodyHtml = `
    <p><strong>${input.elderName}</strong> is due to take <strong>${input.medicationName}</strong> (${input.dosage}).</p>
    <p>Scheduled for ${input.scheduledFor.toISOString()}.</p>
  `;

  return {
    subject,
    html: layout({
      title: `Time for your medicine`,
      preheader: `${input.medicationName} is due now.`,
      bodyHtml,
      ctaLabel: "Mark as taken",
      ctaUrl: `${env.WEB_APP_URL}/medications`,
    }),
    text: `Reminder: ${input.elderName} should take ${input.medicationName} (${input.dosage}).`,
  };
}

export interface CriticalVitalsEmailInput {
  elderName: string;
  readingLabel: string;
  reading: string;
  warning: string;
}

export function criticalVitalsEmail(input: CriticalVitalsEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `Critical reading for ${input.elderName}: ${input.readingLabel}`;

  const bodyHtml = `
    <p><strong>${input.elderName}</strong> recorded a <strong>${input.readingLabel}</strong> of
       <strong>${input.reading}</strong> that is outside the expected range.</p>
    <p style="margin:16px 0;padding:12px 16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:6px;">
       ${input.warning}
    </p>
    <p>Please follow up with them and contact a clinician if the reading persists.</p>
  `;

  return {
    subject,
    html: layout({
      title: `Critical reading — ${input.elderName}`,
      preheader: `${input.readingLabel}: ${input.reading}`,
      bodyHtml,
      ctaLabel: "Open the dashboard",
      ctaUrl: `${env.WEB_APP_URL}/caregiver`,
    }),
    text: `Critical ${input.readingLabel} for ${input.elderName}: ${input.reading}. ${input.warning}`,
  };
}
