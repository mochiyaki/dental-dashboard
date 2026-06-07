import { createClient, type RedisClientType } from "redis";
import type { CacheConfig } from "./config.js";
import type { CacheEntry } from "./manager.js";

type SerializedCacheEntry = Omit<
  CacheEntry,
  "timestamp" | "expiresAt" | "lastAccessed"
> & {
  timestamp: string;
  expiresAt: string;
  lastAccessed: string;
};

export class RedisCacheStore {
  private client: RedisClientType | null = null;
  private connectPromise: Promise<RedisClientType | null> | null = null;
  private available = false;
  private failureLogged = false;

  constructor(private readonly config: CacheConfig["redis"]) {}

  isEnabled(): boolean {
    return this.config.enabled && Boolean(this.config.url);
  }

  isAvailable(): boolean {
    return this.available;
  }

  async get(key: string): Promise<CacheEntry | null> {
    const client = await this.getClient();
    if (!client) return null;

    const raw = await client.get(this.redisKey(key));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as SerializedCacheEntry;
      return {
        ...parsed,
        timestamp: new Date(parsed.timestamp),
        expiresAt: new Date(parsed.expiresAt),
        lastAccessed: new Date(parsed.lastAccessed),
      };
    } catch {
      await client.del(this.redisKey(key));
      return null;
    }
  }

  async set(key: string, entry: CacheEntry, ttlSeconds: number): Promise<void> {
    const client = await this.getClient();
    if (!client) return;

    await client.set(this.redisKey(key), JSON.stringify(entry), {
      EX: ttlSeconds,
    });
  }

  async invalidate(key: string): Promise<void> {
    const client = await this.getClient();
    if (!client) return;
    await client.del(this.redisKey(key));
  }

  async clear(): Promise<void> {
    const client = await this.getClient();
    if (!client) return;

    let cursor = 0;
    do {
      const reply = await client.scan(cursor, {
        MATCH: `${this.config.keyPrefix}*`,
        COUNT: 100,
      });
      cursor = reply.cursor;
      if (reply.keys.length > 0) {
        await client.del(reply.keys);
      }
    } while (cursor !== 0);
  }

  async close(): Promise<void> {
    if (!this.client) return;
    await this.client.quit();
    this.client = null;
    this.available = false;
  }

  private async getClient(): Promise<RedisClientType | null> {
    if (!this.isEnabled()) return null;
    if (this.client?.isOpen) return this.client;
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = this.connect();
    try {
      return await this.connectPromise;
    } finally {
      this.connectPromise = null;
    }
  }

  private async connect(): Promise<RedisClientType | null> {
    const client = createClient({
      url: this.config.url,
      socket: {
        connectTimeout: this.config.connectTimeoutMs,
      },
    });

    client.on("error", (error) => {
      this.available = false;
      if (!this.failureLogged) {
        this.failureLogged = true;
        console.error(
          `Redis cache unavailable; falling back to memory cache: ${error.message}`,
        );
      }
    });

    try {
      await client.connect();
      this.client = client as RedisClientType;
      this.available = true;
      this.failureLogged = false;
      return this.client;
    } catch (error: any) {
      this.available = false;
      if (!this.failureLogged) {
        this.failureLogged = true;
        console.error(
          `Redis cache unavailable; falling back to memory cache: ${error.message}`,
        );
      }
      return null;
    }
  }

  private redisKey(key: string): string {
    return `${this.config.keyPrefix}${key}`;
  }
}
