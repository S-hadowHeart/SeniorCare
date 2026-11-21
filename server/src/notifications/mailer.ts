import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../config/env.js";
import { childLogger } from "../lib/logger.js";

const log = childLogger("mailer");

/**
 * Outbound e-mail transport.
 *
 * In production a real SMTP (or SES / SendGrid via SMTP) endpoint is used.
 * In development the transport falls back to Nodemailer's `jsonTransport`,
 * which serialises the message instead of sending it — the full pipeline
 * (templates, recipients, persistence, retries) is therefore exercised
 * end-to-end even without a mail server, and the payload is logged so that
 * developers can inspect exactly what would have been sent.
 */
const transport: Transporter = env.MAIL_ENABLED
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
      pool: true,
      maxConnections: 5,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : nodemailer.createTransport({ jsonTransport: true });

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface MailResult {
  delivered: boolean;
  messageId?: string;
  error?: string;
}

export async function sendMail(message: MailMessage): Promise<MailResult> {
  try {
    const info = await transport.sendMail({
      from: env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      replyTo: message.replyTo,
    });

    if (!env.MAIL_ENABLED) {
      log.info(
        { to: message.to, subject: message.subject, messageId: info.messageId },
        "[mail:dev] e-mail not sent (MAIL_ENABLED=false) — payload follows",
      );
    } else {
      log.info({ to: message.to, subject: message.subject, messageId: info.messageId }, "e-mail sent");
    }

    return { delivered: true, messageId: String(info.messageId) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown transport error";
    log.error({ err: error, to: message.to, subject: message.subject }, "e-mail delivery failed");
    return { delivered: false, error: reason };
  }
}

/** Verify that the SMTP endpoint accepts connections (startup check). */
export async function verifyMailTransport(): Promise<boolean> {
  if (!env.MAIL_ENABLED) return false;
  try {
    await transport.verify();
    return true;
  } catch (error) {
    log.error({ err: error }, "SMTP verification failed");
    return false;
  }
}
