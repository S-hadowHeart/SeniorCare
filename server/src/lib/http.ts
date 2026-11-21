import type { Response } from "express";

/** Standard success envelope used by every endpoint of the API. */
export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
  requestId?: string;
}

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>): void {
  const body: ApiResponse<T> = { success: true, data };
  if (meta) body.meta = meta;
  res.status(200).json(body);
}

export function created<T>(res: Response, data: T): void {
  res.status(201).json({ success: true, data } satisfies ApiResponse<T>);
}

export function noContent(res: Response): void {
  res.status(204).send();
}

/**
 * Cursor-free pagination envelope. Offsets are fine for the data volumes in
 * this product (vitals per elder per week); the notifications feed uses a
 * keyset cursor because it can grow unbounded.
 */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export function paginated<T>(
  res: Response,
  items: T[],
  total: number,
  page: number,
  pageSize: number,
): void {
  res.status(200).json({
    success: true,
    data: {
      items,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    },
  } satisfies ApiResponse<Paginated<T>>);
}
