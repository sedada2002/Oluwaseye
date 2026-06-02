import type { RedisClientType } from "redis";
import { randomUUID } from "node:crypto";
import type { DistributedLock, LockLease } from "./types.js";

export class RedisDistributedLock implements DistributedLock {
  private readonly redis: RedisClientType;

  public constructor(redis: RedisClientType) {
    this.redis = redis;
  }

  public async acquire(key: string, ttlMs: number): Promise<LockLease | null> {
    const token = randomUUID();
    const acquired = await this.redis.set(key, token, { NX: true, PX: ttlMs });
    if (acquired !== "OK") {
      return null;
    }
    return new RedisLockLease(this.redis, key, token);
  }
}

class RedisLockLease implements LockLease {
  public readonly key: string;
  private readonly redis: RedisClientType;
  private readonly token: string;

  public constructor(redis: RedisClientType, key: string, token: string) {
    this.redis = redis;
    this.key = key;
    this.token = token;
  }

  public async release(): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      end
      return 0
    `;
    await this.redis.eval(script, { keys: [this.key], arguments: [this.token] });
  }
}
