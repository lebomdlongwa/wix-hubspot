import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { PrismaClient } from '@prisma/client';
import { isCorrelationIdFresh, syncHubSpotContactToWix } from '../services/sync.service';
import { storeTokens } from '../services/token.service';

const prisma = new PrismaClient();
const INSTANCE_ID = 'test-instance-loop';
const HS_CONTACT_ID = 'hs-loop-contact-001';
const WIX_CONTACT_ID = 'wix-loop-contact-001';

// Mock Wix update endpoint
const server = setupServer(
  http.patch(`https://www.wixapis.com/contacts/v4/contacts/${WIX_CONTACT_ID}`, () => {
    return HttpResponse.json({ contact: { id: WIX_CONTACT_ID } });
  })
);

beforeAll(async () => {
  server.listen();
  await storeTokens(INSTANCE_ID, {
    accessToken: 'access-loop',
    refreshToken: 'refresh-loop',
    expiresAt: new Date(Date.now() + 1800_000),
    portalId: '12345',
  });
  await prisma.fieldMapping.createMany({
    data: [
      { instanceId: INSTANCE_ID, wixField: 'info.emails[0].email', hubspotProperty: 'email', direction: 'BOTH', isActive: true },
      { instanceId: INSTANCE_ID, wixField: 'info.name.first', hubspotProperty: 'firstname', direction: 'HS_TO_WIX', isActive: true },
    ],
  });
  await prisma.contactIdMapping.create({
    data: {
      instanceId: INSTANCE_ID,
      wixContactId: WIX_CONTACT_ID,
      hubspotContactId: HS_CONTACT_ID,
      lastSyncedBy: 'HUBSPOT',
      lastSyncedAt: new Date(Date.now() - 60_000), // synced 1 minute ago
    },
  });
});

afterAll(async () => {
  server.close();
  await prisma.contactIdMapping.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.fieldMapping.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.syncLog.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.hubSpotToken.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.appInstallation.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.$disconnect();
});

describe('isCorrelationIdFresh', () => {
  it('returns true for a fresh wix_sync_ tag', () => {
    const tag = `wix_sync_${Date.now() - 30_000}`; // 30 seconds ago
    expect(isCorrelationIdFresh(tag)).toBe(true);
  });

  it('returns false for an old wix_sync_ tag (older than 5 min)', () => {
    const tag = `wix_sync_${Date.now() - 6 * 60 * 1000}`; // 6 minutes ago
    expect(isCorrelationIdFresh(tag)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isCorrelationIdFresh(undefined)).toBe(false);
  });

  it('returns false for unrelated string', () => {
    expect(isCorrelationIdFresh('some_other_value')).toBe(false);
  });
});

describe('syncHubSpotContactToWix — loop prevention', () => {
  it('skips sync when correlation ID is fresh', async () => {
    const freshTag = `wix_sync_${Date.now() - 10_000}`; // 10 seconds ago
    const result = await syncHubSpotContactToWix(INSTANCE_ID, HS_CONTACT_ID, {
      email: 'test@example.com',
      wix_sync_source: freshTag,
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('correlation_id');

    const log = await prisma.syncLog.findFirst({
      where: { instanceId: INSTANCE_ID, direction: 'HUBSPOT', status: 'SKIPPED', skipReason: { contains: 'Correlation' } },
    });
    expect(log).not.toBeNull();
  });

  it('syncs successfully when no correlation ID and mapping exists', async () => {
    const result = await syncHubSpotContactToWix(INSTANCE_ID, HS_CONTACT_ID, {
      email: 'updated@example.com',
      firstname: 'UpdatedName',
    });

    expect(result.skipped).toBe(false);

    const log = await prisma.syncLog.findFirst({
      where: { instanceId: INSTANCE_ID, direction: 'HUBSPOT', status: 'SUCCESS' },
    });
    expect(log).not.toBeNull();
  });

  it('skips when no Wix contact found for HubSpot contact', async () => {
    const result = await syncHubSpotContactToWix(INSTANCE_ID, 'unknown-hs-id', {
      email: 'nobody@example.com',
    });

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('no_wix_contact');
  });
});
