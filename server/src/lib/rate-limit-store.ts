import { MemoryStore, type Options, type Store } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { createClient, type RedisClientType } from "redis";
import { env } from "../config/env.js";
import { childLogger } from "./logger.js";

const log = childLogger("rate-limit-store");

const KEY_PREFIX = "seniorcare:rl:";
const RECONNECT_COOLDOWN_MS = 30_000;

/**
 * A store that keeps the limiter available when the shared store is unhealthy.
 *
 * Redis gives every instance one set of counters. If a command fails — the
 * server is down, a network partition, a script error — the request is counted
 * in a process-local memory store instead. That degrades to per-instance
 * limits rather than turning a cache outage into an API outage (or blocking a
 * genuine SOS).
 */
export class ResilientStore implements Store {
  /** Keys live in Redis, so they are visible to every instance. */
  readonly localKeys = false;
  readonly prefix: string;

  readonly #primary: Store;
  readonly #fallback: Store;
  #lastErrorAt = 0;

  constructor(primary: Store, fallback: Store, prefix: string) {
    this.#primary = primary;
    this.#fallback = fallback;
    this.prefix = prefix;
  }

  async init(options: Options): Promise<void> {
    try {
      await this.#primary.init?.(options);
    } catch (error) {
      this.#report(error);
    }
    await this.#fallback.init?.(options);
  }

  async increment(key: string) {
    try {
      return await this.#primary.increment(key);
    } catch (error) {
      this.#report(error);
      return this.#fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await this.#primary.decrement(key);
    } catch (error) {
      this.#report(error);
      await this.#fallback.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    try {
      await this.#primary.resetKey(key);
    } catch (error) {
      this.#report(error);
      await this.#fallback.resetKey(key);
    }
  }

  async resetAll(): Promise<void> {
    try {
      await this.#primary.resetAll?.();
    } catch (error) {
      this.#report(error);
    }
    await this.#fallback.resetAll?.();
  }

  async shutdown(): Promise<void> {
    await this.#primary.shutdown?.();
    await this.#fallback.shutdown?.();
  }

  /** Log at most one failure per minute; an outage must not flood the logs. */
  #report(error: unknown): void {
    const now = Date.now();
    if (now - this.#lastErrorAt < 60_000) return;
    this.#lastErrorAt = now;
    log.warn({ err: error, prefix: this.prefix }, "rate-limit store failed; using the in-memory fallback");
  }
}

/**
 * Wrap a Redis client in a command sender that connects on first use.
 *
 * The API boots even when Redis is down. The first command attempts a
 * connection (bounded by the client's `connectTimeout`); failures are retried
 * at most once every 30 seconds, and every request in between is served by the
 * memory fallback instead of waiting on a dead socket.
 */
export function createRedisSender(
  client: RedisClientType,
): (...args: string[]) => Promise<RedisReply> {
  let connecting: Promise<void> | undefined;
  let retryAfter = 0;

  return async (...args: string[]): Promise<RedisReply> => {
    if (!client.isOpen) {
      if (Date.now() < retryAfter) {
        throw new Error("Redis rate-limit store is in reconnect backoff");
      }

      connecting ??= client
        .connect()
        .then(() => {
          retryAfter = 0;
        })
        .catch((error: unknown) => {
          retryAfter = Date.now() + RECONNECT_COOLDOWN_MS;
          throw error;
        })
        .finally(() => {
          connecting = undefined;
        });

      await connecting;
    }

    return (await client.sendCommand(args)) as RedisReply;
  };
}

/** Build the resilient Redis store for one limiter namespace. */
export function createRedisRateLimitStore(
  sendCommand: (...args: string[]) => Promise<RedisReply>,
  prefix: string,
): Store {
  return new ResilientStore(
    new RedisStore({ prefix, sendCommand }),
    new MemoryStore(),
    prefix,
  );
}

let sharedClient: RedisClientType | undefined;

/**
 * The store for one limiter, or `undefined` to let `express-rate-limit` use
 * its process-local default. Tests always take the default so that suites are
 * not rate limited (and do not require Redis).
 */
export function getRateLimitStore(scope: string): Store | undefined {
  if (!env.REDIS_URL || env.isTest) return undefined;

  if (!sharedClient) {
    sharedClient = createClient({
      url: env.REDIS_URL,
      socket: {
        connectTimeout: 2_000,
        // Reconnection is driven by `createRedisSender`, with a cooldown, so
        // that an outage cannot produce a reconnect storm.
        reconnectStrategy: () => false,
      },
    });
    sharedClient.on("error", (error) => {
      log.warn({ err: error }, "Redis rate-limit connection error");
    });
  }

  const prefix = `${KEY_PREFIX}${scope}:`;
  return createRedisRateLimitStore(createRedisSender(sharedClient), prefix);
}

/** Release the shared Redis connection during graceful shutdown. */
export async function closeRateLimitStore(): Promise<void> {
  const client = sharedClient;
  sharedClient = undefined;
  if (!client) return;

  try {
    if (client.isOpen) {
      await client.quit();
    } else {
      client.destroy();
    }
  } catch (error) {
    log.warn({ err: error }, "failed to close the Redis rate-limit client");
  }
}
