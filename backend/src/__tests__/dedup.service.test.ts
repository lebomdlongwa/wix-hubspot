import { describe, it, expect, afterAll } from 'vitest';
import { checkAndMark, clearKey, dedupRedis } from '../services/dedup.service';

const INSTANCE = 'test-instance-dedup';
const CONTACT = 'contact-abc';

afterAll(async () => {
  await clearKey('wix-to-hs', INSTANCE, CONTACT);
  dedupRedis.disconnect();
});

describe('dedup.service', () => {
  it('first call returns false (not seen — proceed)', async () => {
    await clearKey('wix-to-hs', INSTANCE, CONTACT); // ensure clean state
    const alreadySeen = await checkAndMark('wix-to-hs', INSTANCE, CONTACT);
    expect(alreadySeen).toBe(false);
  });

  it('second call within TTL returns true (already seen — skip)', async () => {
    const alreadySeen = await checkAndMark('wix-to-hs', INSTANCE, CONTACT);
    expect(alreadySeen).toBe(true);
  });

  it('different direction does not share the same key', async () => {
    const alreadySeen = await checkAndMark('hs-to-wix', INSTANCE, CONTACT);
    expect(alreadySeen).toBe(false);
    await clearKey('hs-to-wix', INSTANCE, CONTACT);
  });

  it('after clearKey the contact is treated as new again', async () => {
    await clearKey('wix-to-hs', INSTANCE, CONTACT);
    const alreadySeen = await checkAndMark('wix-to-hs', INSTANCE, CONTACT);
    expect(alreadySeen).toBe(false);
  });
});
