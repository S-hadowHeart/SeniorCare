import type { Notification, NotificationType } from "../generated/prisma/client.js";
import type { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../lib/prisma.js";
import { childLogger } from "../lib/logger.js";
import { realtimeBus } from "../realtime/bus.js";
import { sendMail } from "./mailer.js";

const log = childLogger("notifications");

export interface EmailPayload {
  subject: string;
  html: string;
  text: string;
}

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  elderId?: string | null;
  sosAlertId?: string | null;
  metadata?: Prisma.InputJsonValue;
  /** When present, an e-mail is delivered in addition to the in-app entry. */
  email?: EmailPayload;
}

export interface Recipient {
  userId: string;
  email: string | null;
  name: string;
}

/**
 * Create an in-app notification and (optionally) deliver an e-mail.
 *
 * The in-app row is written first so that the caregiver sees the alert in
 * the dashboard even if the SMTP endpoint is slow or unavailable. E-mail
 * delivery is asynchronous from the caller's point of view and its outcome is
 * recorded in a separate `EMAIL` channel row, which keeps the inbox free of
 * delivery noise while still providing an audit trail.
 */
export async function notify(input: NotifyInput): Promise<Notification> {
  const notification = await prisma.notification.create({
    data: {
      userId: input.userId,
      elderId: input.elderId ?? null,
      sosAlertId: input.sosAlertId ?? null,
      type: input.type,
      channel: "IN_APP",
      status: "SENT",
      title: input.title,
      body: input.body,
      metadata: input.metadata ?? undefined,
      sentAt: new Date(),
    },
  });

  realtimeBus.publish("notification.created", {
    userId: input.userId,
    notificationId: notification.id,
    type: input.type,
    title: notification.title,
    body: notification.body,
    elderId: notification.elderId,
    metadata:
      notification.metadata && typeof notification.metadata === "object"
        ? (notification.metadata as Record<string, unknown>)
        : {},
  });

  if (input.email) {
    await deliverEmail(input.userId, input.email, {
      elderId: input.elderId ?? null,
      sosAlertId: input.sosAlertId ?? null,
      type: input.type,
      parentNotificationId: notification.id,
    });
  }

  return notification;
}

/** Fan a notification out to several recipients. */
export async function notifyMany(inputs: NotifyInput[]): Promise<Notification[]> {
  const results: Notification[] = [];
  for (const input of inputs) {
    try {
      results.push(await notify(input));
    } catch (error) {
      log.error({ err: error, userId: input.userId, type: input.type }, "failed to create notification");
    }
  }
  return results;
}

interface DeliveryContext {
  elderId: string | null;
  sosAlertId: string | null;
  type: NotificationType;
  parentNotificationId: string;
}

async function deliverEmail(
  userId: string,
  email: EmailPayload,
  context: DeliveryContext,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user?.email) {
    log.warn({ userId }, "skipped e-mail: recipient has no e-mail address");
    return;
  }

  const delivery = await prisma.notification.create({
    data: {
      userId,
      elderId: context.elderId,
      sosAlertId: context.sosAlertId,
      type: context.type,
      channel: "EMAIL",
      status: "PENDING",
      title: email.subject,
      body: email.text,
      metadata: { parentNotificationId: context.parentNotificationId },
    },
  });

  const result = await sendMail({
    to: user.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  await prisma.notification.update({
    where: { id: delivery.id },
    data: result.delivered
      ? { status: "SENT", sentAt: new Date() }
      : { status: "FAILED", failureReason: result.error ?? "unknown error" },
  });
}

/**
 * Resolve the people who should be notified about an elder.
 *
 * Two groups are returned:
 *  - **caregivers** — users with an active care link (they have an account
 *    and therefore an in-app inbox);
 *  - **contacts** — family members, professional caregivers and doctors that
 *    were registered by the senior (they may only have an e-mail address).
 */
export async function resolveElderRecipients(
  elderId: string,
): Promise<{ caregivers: Recipient[]; contacts: Recipient[] }> {
  const [links, contacts] = await Promise.all([
    prisma.careLink.findMany({
      where: { elderId, status: "ACTIVE" },
      include: {
        caregiver: { select: { id: true, email: true, name: true } },
      },
    }),
    prisma.emergencyContact.findMany({
      where: { elderId, isActive: true },
      select: { name: true, email: true, phone: true },
    }),
  ]);

  const caregivers: Recipient[] = links
    .filter((link): link is typeof link & { caregiver: NonNullable<typeof link.caregiver> } =>
      link.caregiver !== null,
    )
    .map((link) => ({
      userId: link.caregiver.id,
      email: link.caregiver.email,
      name: link.caregiver.name,
    }));
  const contactRecipients: Recipient[] = contacts
    .filter((contact) => Boolean(contact.email))
    .map((contact) => ({
      userId: `contact:${contact.email}`,
      email: contact.email,
      name: contact.name,
    }));

  return { caregivers, contacts: contactRecipients };
}
