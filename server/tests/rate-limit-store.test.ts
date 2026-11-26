import { randomUUID } from "node:crypto";
import { createClient, type RedisClientType } from "redis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Options, Store } from "express-rate-limit";
import type { RedisReply } from "rate-limit-redis";
import {
  ResilientStore,
  closeRateLimitStore,
  createRedisRateLimitStore,
  createRedisSender,
  getRateLimitStore,
} from "../src/lib/rate-limit-store.js";

function fakeStore(overrides: Partial<Store> = {}): Store {
  return {
    init: vi.fn(),
    increment: vi.fn(async () => ({ totalHits: 1, resetTime: undefined })),
    decrement: vi.fn(async () => undefined),
    resetKey: vi.fn(async () => undefined),
    resetAll: vi.fn(async () => undefined),
    shutdown: vi.fn(async () => undefined),
    ...overrides,
  };
}

function fakeRedis() {
  const connect = vi.fn();
  const state = {
    isOpen: false,
    connect,
    sendCommand: vi.fn(async () => 1),
  };
  connect.mockImplementation(async () => {
    state.isOpen = true;
  });
  return {
    client: state as unknown as RedisClientType,
    connect,
    sendCommand: state.sendCommand,
  };
}

describe("ResilientStore", () => {
  it("uses the shared store while it is healthy", async () => {
    const primary = fakeStore({
      increment: vi.fn(async () => ({ totalHits: 2, resetTime: undefined })),
    });
    const fallback = fakeStore();
    const store = new ResilientStore(primary, fallback, "test:");

    await store.init({ windowMs: 60_000 } as Options);

    expect(primary.init).toHaveBeenCalled();
    expect(fallback.init).toHaveBeenCalled();
    expect(store.localKeys).toBe(false);
    expect((await store.increment("key")).totalHits).toBe(2);
    expect(fallback.increment).not.toHaveBeenCalled();
  });

  it("falls back to memory when an increment fails", async () => {
    const primary = fakeStore({
      increment: vi.fn(async () => {
        throw new Error("redis down");
      }),
    });
    const fallback = fakeStore({
      increment: vi.fn(async () => ({ totalHits: 7, resetTime: undefined })),
    });
    const store = new ResilientStore(primary, fallback, "test:");

    expect((await store.increment("key")).totalHits).toBe(7);
    expect(fallback.increment).toHaveBeenCalledWith("key");
  });

  it("falls back for decrement, resetKey and resetAll", async () => {
    const primary = fakeStore({
      decrement: vi.fn(async () => {
        throw new Error("redis down");
      }),
      resetKey: vi.fn(async () => {
        throw new Error("redis down");
      }),
      resetAll: vi.fn(async () => {
        throw new Error("redis down");
      }),
    });
    const fallback = fakeStore();
    const store = new ResilientStore(primary, fallback, "test:");

    await store.decrement("key");
    await store.resetKey("key");
    await store.resetAll();

    expect(fallback.decrement).toHaveBeenCalledWith("key");
    expect(fallback.resetKey).toHaveBeenCalledWith("key");
    expect(fallback.resetAll).toHaveBeenCalled();
  });

  it("still initialises the fallback when the primary init fails", async () => {
    const primary = fakeStore({
      init: vi.fn(() => {
        throw new Error("redis down");
      }),
    });
    const fallback = fakeStore();
    const store = new ResilientStore(primary, fallback, "test:");

    await expect(store.init({ windowMs: 60_000 } as Options)).resolves.toBeUndefined();
    expect(fallback.init).toHaveBeenCalled();
  });

  it("shuts both stores down", async () => {
    const primary = fakeStore();
    const fallback = fakeStore();
    const store = new ResilientStore(primary, fallback, "test:");

    await store.shutdown();

    expect(primary.shutdown).toHaveBeenCalled();
    expect(fallback.shutdown).toHaveBeenCalled();
  });
});

describe("createRedisSender", () => {
  it("connects lazily and reuses the open connection", async () => {
    const redis = fakeRedis();
    const send = createRedisSender(redis.client);

    await expect(send("INCR", "key")).resolves.toBe(1);
    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(redis.sendCommand).toHaveBeenCalledWith(["INCR", "key"]);

    await send("INCR", "key");
    expect(redis.connect).toHaveBeenCalledTimes(1);
  });

  it("backs off after a failed connection instead of retrying every request", async () => {
    const state = {
      isOpen: false,
      connect: vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
      sendCommand: vi.fn(async () => 1),
    };
    const send = createRedisSender(state as unknown as RedisClientType);

    await expect(send("PING")).rejects.toThrow("ECONNREFUSED");
    await expect(send("PING")).rejects.toThrow("reconnect backoff");
    expect(state.connect).toHaveBeenCalledTimes(1);
  });
});

describe("store selection", () => {
  it("uses the process-local default in tests", () => {
    expect(getRateLimitStore("global")).toBeUndefined();
  });

  it("closes cleanly when no Redis client was opened", async () => {
    await expect(closeRateLimitStore()).resolves.toBeUndefined();
  });
});

const redisUrl = process.env.REDIS_URL;
const describeRedis = redisUrl ? describe : describe.skip;

describeRedis("Redis rate-limit store", () => {
  let client!: RedisClientType;
  const prefix = `seniorcare:test:rl:${randomUUID()}:`;

  beforeAll(async () => {
    client = createClient({ url: redisUrl! });
    await client.connect();
  });

  afterAll(async () => {
    if (client?.isOpen) {
      await client.del(`${prefix}client`);
      await client.quit();
    }
  });

  it("shares counters through Redis and resets a key", async () => {
    const store = createRedisRateLimitStore(
      (...args) => client.sendCommand(args) as Promise<RedisReply>,
      prefix,
    );

    await store.init?.({ windowMs: 60_000 } as Options);

    expect((await store.increment("client")).totalHits).toBe(1);
    expect((await store.increment("client")).totalHits).toBe(2);

    await store.resetKey("client");
    expect((await store.increment("client")).totalHits).toBe(1);

    await store.shutdown?.();
  });
});
