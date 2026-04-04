import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const TTL_SECONDS = 300; // 5 minutes

type SyncDirection = 'wix-to-hs' | 'hs-to-wix';

function buildKey(direction: SyncDirection, instanceId: string, contactId: string): string {
  return `dedup:${direction}:${instanceId}:${contactId}`;
}

/**
 * Returns true if this sync event was already seen (should be skipped).
 * Returns false and marks the key if it is new (should proceed).
 */
export async function checkAndMark(
  direction: SyncDirection,
  instanceId: string,
  contactId: string
): Promise<boolean> {
  const key = buildKey(direction, instanceId, contactId);
  // SET key 1 NX EX ttl — only sets if key does not exist
  const result = await redis.set(key, '1', 'EX', TTL_SECONDS, 'NX');
  // result is 'OK' if key was set (new), null if it already existed (duplicate)
  return result === null; // true = already seen = skip
}

/**
 * Clears the dedup key (used in tests or manual overrides).
 */
export async function clearKey(
  direction: SyncDirection,
  instanceId: string,
  contactId: string
): Promise<void> {
  const key = buildKey(direction, instanceId, contactId);
  await redis.del(key);
}

export { redis as dedupRedis };
