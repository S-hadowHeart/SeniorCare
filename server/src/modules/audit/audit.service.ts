import type { Prisma } from "../../generated/prisma/client.js";
import { childLogger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";

const log = childLogger("audit");

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append one audit row.
 *
 * Auditing must never turn a successful business operation into a 500, so a
 * write failure is logged with the action name and swallowed. The caller has
 * already committed its state change by this point.
 */
export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId ?? null,
        ipAddress: entry.ipAddress?.slice(0, 64) ?? null,
        userAgent: entry.userAgent?.slice(0, 300) ?? null,
        metadata: entry.metadata as never,
      },
    });
  } catch (error) {
    log.error({ err: error, action: entry.action }, "failed to write audit log");
  }
}

export interface AuditLogQuery {
  actorId?: string;
  action?: string;
  entity?: string;
  entityId?: string;
  from?: Date;
  to?: Date;
  /** Page size, clamped to 1–200. */
  limit?: number;
  /** `nextCursor` from the previous page. */
  cursor?: string;
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actor: { id: string; name: string; email: string } | null;
  action: string;
  entity: string;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Prisma.JsonValue | null;
  createdAt: Date;
}

export interface AuditLogPage {
  entries: AuditLogEntry[];
  nextCursor: string | null;
}

/**
 * Query the audit trail, newest first.
 *
 * All filters are optional and combine with AND. Cursor pagination is keyed by
 * the audit row id, so a caller can page without the duplicates and gaps that
 * offset pagination produces when new rows arrive between requests.
 */
export async function queryAuditLogs(query: AuditLogQuery = {}): Promise<AuditLogPage> {
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 200);

  const where: Prisma.AuditLogWhereInput = {};
  if (query.actorId) where.actorId = query.actorId;
  if (query.action) where.action = query.action;
  if (query.entity) where.entity = query.entity;
  if (query.entityId) where.entityId = query.entityId;

  const createdAt: { gte?: Date; lte?: Date } = {};
  if (query.from) createdAt.gte = query.from;
  if (query.to) createdAt.lte = query.to;
  if (createdAt.gte || createdAt.lte) where.createdAt = createdAt;

  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      actorId: true,
      actor: { select: { id: true, name: true, email: true } },
      action: true,
      entity: true,
      entityId: true,
      ipAddress: true,
      userAgent: true,
      metadata: true,
      createdAt: true,
    },
  });

  const hasMore = rows.length > limit;
  const entries = hasMore ? rows.slice(0, limit) : rows;

  return {
    entries,
    nextCursor: hasMore ? entries[entries.length - 1]?.id ?? null : null,
  };
}
