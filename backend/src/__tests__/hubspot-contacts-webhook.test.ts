import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { PrismaClient } from '@prisma/client';
import app from '../index';
import { storeTokens } from '../services/token.service';
import { clearKey } from '../services/dedup.service';

const prisma = new PrismaClient();
const INSTANCE_ID = '99999'; // portalId used as instanceId from HubSpot events
const HS_CONTACT_ID = 12345;
const WIX_CONTACT_ID = 'wix-hs-webhook-contact';
const HS_SECRET = 'test-hs-client-secret';
const REQUEST_URI = 'https://example.ngrok.io/webhooks/hubspot/contacts';

const server = setupServer(
  http.patch(`https://www.wixapis.com/contacts/v4/contacts/${WIX_CONTACT_ID}`, () => {
    return HttpResponse.json({ contact: { id: WIX_CONTACT_ID } });
  })
);

function makeHubSpotSignature(body: object, timestamp: string): string {
  const rawBody = JSON.stringify(body);
  const message = `${HS_SECRET}${REQUEST_URI}${rawBody}${timestamp}`;
  return crypto.createHmac('sha256', HS_SECRET).update(message).digest('hex');
}

const validEvent = [{ portalId: parseInt(INSTANCE_ID), objectId: HS_CONTACT_ID, propertyName: 'firstname', propertyValue: 'Jane' }];

beforeAll(async () => {
  server.listen();
  process.env.HUBSPOT_CLIENT_SECRET = HS_SECRET;
  await storeTokens(INSTANCE_ID, {
    accessToken: 'access-hs-webhook',
    refreshToken: 'refresh-hs-webhook',
    expiresAt: new Date(Date.now() + 1800_000),
    portalId: INSTANCE_ID,
  });
  await prisma.fieldMapping.createMany({
    data: [
      { instanceId: INSTANCE_ID, wixField: 'info.name.first', hubspotProperty: 'firstname', direction: 'HS_TO_WIX', isActive: true },
    ],
  });
  await prisma.contactIdMapping.create({
    data: {
      instanceId: INSTANCE_ID,
      wixContactId: WIX_CONTACT_ID,
      hubspotContactId: String(HS_CONTACT_ID),
      lastSyncedBy: 'HUBSPOT',
      lastSyncedAt: new Date(Date.now() - 60_000),
    },
  });
  await clearKey('hs-to-wix', INSTANCE_ID, String(HS_CONTACT_ID));
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

describe('POST /webhooks/hubspot/contacts', () => {
  it('invalid signature → 401', async () => {
    const timestamp = String(Date.now());
    const res = await request(app)
      .post('/webhooks/hubspot/contacts')
      .set('x-hubspot-signature-v3', 'bad-signature')
      .set('x-hubspot-request-timestamp', timestamp)
      .send(validEvent);

    expect(res.status).toBe(401);
  });

  it('valid signature + no correlation ID → syncs and returns ok', async () => {
    await clearKey('hs-to-wix', INSTANCE_ID, String(HS_CONTACT_ID));
    const timestamp = String(Date.now());
    const sig = makeHubSpotSignature(validEvent, timestamp);

    const res = await request(app)
      .post('/webhooks/hubspot/contacts')
      .set('x-hubspot-signature-v3', sig)
      .set('x-hubspot-request-timestamp', timestamp)
      .send(validEvent);

    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe('ok');
  });

  it('correlation ID present → returns skipped', async () => {
    const freshTag = `wix_sync_${Date.now() - 5_000}`;
    const eventWithTag = [{ ...validEvent[0], properties: { wix_sync_source: freshTag } }];
    const timestamp = String(Date.now());
    const sig = makeHubSpotSignature(eventWithTag, timestamp);

    // Reset dedup so it doesn't interfere
    await clearKey('hs-to-wix', INSTANCE_ID, String(HS_CONTACT_ID));

    const res = await request(app)
      .post('/webhooks/hubspot/contacts')
      .set('x-hubspot-signature-v3', sig)
      .set('x-hubspot-request-timestamp', timestamp)
      .send(eventWithTag);

    expect(res.status).toBe(200);
    expect(res.body.results[0].status).toBe('skipped');
    expect(res.body.results[0].reason).toBe('correlation_id');
  });
});
