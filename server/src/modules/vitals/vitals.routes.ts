import { Router } from "express";
import { asyncHandler } from "../../lib/asyncHandler.js";
import { created, ok, paginated } from "../../lib/http.js";
import { getElderAccess } from "../../lib/access.js";
import { encryptNullable, decryptNullable } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { authenticate } from "../../middleware/authenticate.js";
import { validate, validatedBody, validatedParams, validatedQuery } from "../../middleware/validate.js";
import { toPrismaPage } from "../../lib/validation.js";
import { DEFAULT_VITAL_UNITS, VITAL_LABELS, evaluateVital } from "../../lib/vitals.js";
import { realtimeBus } from "../../realtime/bus.js";
import { notify, resolveElderRecipients } from "../../notifications/service.js";
import { sendMail } from "../../notifications/mailer.js";
import { criticalVitalsEmail } from "../../notifications/templates.js";
import {
  createVitalSchema,
  elderIdParamSchema,
  listVitalsQuerySchema,
  vitalSummaryQuerySchema,
  type CreateVitalInput,
  type ListVitalsQuery,
  type VitalSummaryQuery,
} from "./vitals.schemas.js";

export const vitalsRouter = Router({ mergeParams: true });

vitalsRouter.use(authenticate);

/** POST /api/v1/elders/:elderId/vitals — record a health reading. */
vitalsRouter.post(
  "/",
  validate({ params: elderIdParamSchema, body: createVitalSchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const input = validatedBody<CreateVitalInput>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const unit = input.unit?.trim() || DEFAULT_VITAL_UNITS[input.type];
    const evaluation = evaluateVital(input.type, input.value, input.value2 ?? undefined, unit);

    const vital = await prisma.vital.create({
      data: {
        elderId: elder.id,
        type: input.type,
        value: input.value,
        value2: input.value2 ?? null,
        unit,
        isCritical: evaluation.isCritical,
        warning: evaluation.warning ?? null,
        note: encryptNullable(input.note),
        measuredAt: input.measuredAt ?? new Date(),
      },
    });

    realtimeBus.publish("vital.created", {
      elderId: elder.id,
      elderName: elder.displayName,
      vitalId: vital.id,
      type: vital.type,
      value: vital.value,
      isCritical: vital.isCritical,
    });

    // A critical reading is escalated to the caregivers immediately.
    if (evaluation.isCritical) {
      const { caregivers, contacts } = await resolveElderRecipients(elder.id);
      const reading =
        input.type === "BLOOD_PRESSURE" && input.value2
          ? `${input.value}/${input.value2} ${unit}`
          : `${input.value} ${unit}`;

      await Promise.all(
        caregivers.map((recipient) =>
          notify({
            userId: recipient.userId,
            type: "VITALS_CRITICAL",
            elderId: elder.id,
            title: `Critical ${VITAL_LABELS[input.type].toLowerCase()} for ${elder.displayName}`,
            body: `${reading} — ${evaluation.warning ?? "outside the expected range"}`,
            metadata: { vitalId: vital.id, type: input.type, value: input.value },
          }),
        ),
      );

      const email = criticalVitalsEmail({
        elderName: elder.displayName,
        readingLabel: VITAL_LABELS[input.type],
        reading,
        warning: evaluation.warning ?? "This reading is outside the expected range.",
      });

      await Promise.all(
        contacts.map(async (contact) => {
          if (!contact.email) return;
          await sendMail({
            to: contact.email,
            subject: email.subject,
            html: email.html,
            text: email.text,
          });
        }),
      );
    }

    created(res, {
      ...vital,
      note: decryptNullable(vital.note),
      severity: evaluation.severity,
      normalRange: evaluation.normalRange,
    });
  }),
);

/** GET /api/v1/elders/:elderId/vitals — paginated history. */
vitalsRouter.get(
  "/",
  validate({ params: elderIdParamSchema, query: listVitalsQuerySchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const query = validatedQuery<ListVitalsQuery>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);
    const where = {
      elderId: elder.id,
      measuredAt: { gte: since },
      ...(query.type ? { type: query.type } : {}),
    };

    const [items, total] = await Promise.all([
      prisma.vital.findMany({
        where,
        orderBy: { measuredAt: "desc" },
        ...toPrismaPage({ page: query.page, pageSize: query.pageSize }),
        select: {
          id: true,
          type: true,
          value: true,
          value2: true,
          unit: true,
          isCritical: true,
          warning: true,
          note: true,
          measuredAt: true,
          createdAt: true,
        },
      }),
      prisma.vital.count({ where }),
    ]);

    paginated(
      res,
      items.map((vital) => ({ ...vital, note: decryptNullable(vital.note) })),
      total,
      query.page,
      query.pageSize,
    );
  }),
);

/**
 * GET /api/v1/elders/:elderId/vitals/summary
 *
 * Aggregated statistics used by the dashboard charts: average, minimum,
 * maximum and a simple linear trend.
 */
vitalsRouter.get(
  "/summary",
  validate({ params: elderIdParamSchema, query: vitalSummaryQuerySchema }),
  asyncHandler(async (req, res) => {
    const { elderId } = validatedParams<{ elderId: string }>(req);
    const query = validatedQuery<VitalSummaryQuery>(req);

    const { elder } = await getElderAccess(req.auth!, elderId, "view");

    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);
    const where = {
      elderId: elder.id,
      measuredAt: { gte: since },
      ...(query.type ? { type: query.type } : {}),
    };

    const [items, criticalCount] = await Promise.all([
      prisma.vital.findMany({
        where,
        orderBy: { measuredAt: "asc" },
        select: {
          id: true,
          type: true,
          value: true,
          value2: true,
          unit: true,
          isCritical: true,
          measuredAt: true,
        },
      }),
      prisma.vital.count({ where: { ...where, isCritical: true } }),
    ]);

    // Group by type so the client can render one chart per measurement.
    const grouped = new Map<string, typeof items>();
    for (const item of items) {
      const bucket = grouped.get(item.type);
      if (bucket) bucket.push(item);
      else grouped.set(item.type, [item]);
    }

    const series = Array.from(grouped.entries()).map(([type, values]) => {
      const numbers = values.map((vital) => vital.value);
      const average = numbers.reduce((sum, value) => sum + value, 0) / (numbers.length || 1);
      const first = numbers[0] ?? 0;
      const last = numbers[numbers.length - 1] ?? 0;

      return {
        type,
        label: VITAL_LABELS[type as keyof typeof VITAL_LABELS] ?? type,
        unit: values[0]?.unit ?? DEFAULT_VITAL_UNITS[type as keyof typeof DEFAULT_VITAL_UNITS],
        count: values.length,
        average: Number(average.toFixed(1)),
        min: Math.min(...numbers),
        max: Math.max(...numbers),
        first,
        last,
        trend: Number((last - first).toFixed(1)),
        criticalCount: values.filter((vital) => vital.isCritical).length,
        points: values.map((vital) => ({
          id: vital.id,
          value: vital.value,
          value2: vital.value2,
          measuredAt: vital.measuredAt,
          isCritical: vital.isCritical,
        })),
      };
    });

    ok(res, { days: query.days, criticalCount, series });
  }),
);
