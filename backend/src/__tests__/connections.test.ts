import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

describe('Phase 1 - Connection smoke tests', () => {
  it('connects to Postgres', async () => {
    const result = await prisma.$queryRaw<[{ result: number }]>`SELECT 1 + 1 AS result`;
    expect(result[0].result).toBe(2);
  });

  it('connects to Redis', async () => {
    const pong = await redis.ping();
    expect(pong).toBe('PONG');
  });
});

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});
