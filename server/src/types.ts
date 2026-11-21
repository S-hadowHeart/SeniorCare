import type { Role } from "./generated/prisma/enums.js";

/** Everything the request pipeline knows about the authenticated caller. */
export interface AuthContext {
  userId: string;
  role: Role;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id, echoed back through the `x-request-id` header. */
      requestId: string;
      /** Populated by the `authenticate` middleware. */
      auth?: AuthContext;
      /** Parsed & validated request payload. */
      validated: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
