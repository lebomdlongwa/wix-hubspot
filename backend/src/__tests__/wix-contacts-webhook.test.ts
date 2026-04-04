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
const INSTANCE_ID = 'test-instance-wix-webhook';
const WIX_CONTACT_ID = 'wix-webhook-contact-001';
const APP_SECRET = 'test-app-secret';

const server = setupServer(
  http.post('https://api.hubapi.com/crm/v3/objects/contacts', () => {
    return HttpResponse.json({ id: 'hs-new-contact' }, { status: 201 });
  })
);

function makeSignature(body: object): string {
  return crypto
    .createHmac('sha256', APP_SECRET)
    .update(JSON.stringify(body))
    .digest('base64');
}

const validPayload = {
  instanceId: INSTANCE_ID,
  data: {
    id: WIX_CONTACT_ID,
    info: {
      name: { first: 'Test', last: 'User' },
      emails: [{ email: 'test@example.com' }],
    },
  },
};

beforeAll(async () => {
  server.listen();
  process.env.WIX_APP_SECRET = APP_SECRET;
  await storeTokens(INSTANCE_ID, {
    accessToken: 'access-webhook',
    refreshToken: 'refresh-webhook',
    expiresAt: new Date(Date.now() + 1800_000),
    portalId: '12345',
  });
  await prisma.fieldMapping.createMany({
    data: [
      { instanceId: INSTANCE_ID, wixField: 'info.emails[0].email', hubspotProperty: 'email', direction: 'BOTH', isActive: true },
    ],
  });
  // Clear any dedup key from previous runs
  await clearKey('wix-to-hs', INSTANCE_ID, WIX_CONTACT_ID);
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

describe('POST /webhooks/wix/contacts', () => {
  it('invalid signature → 401', async () => {
    const res = await request(app)
      .post('/webhooks/wix/contacts')
      .set('x-wix-signature', 'bad-signature')
      .send(validPayload);

    expect(res.status).toBe(401);
  });

  it('valid signature → syncs contact and returns ok', async () => {
    const sig = makeSignature(validPayload);
    const res = await request(app)
      .post('/webhooks/wix/contacts')
      .set('x-wix-signature', sig)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('duplicate event within TTL → skipped', async () => {
    // Send the same payload again — dedup should skip it
    const sig = makeSignature(validPayload);
    const res = await request(app)
      .post('/webhooks/wix/contacts')
      .set('x-wix-signature', sig)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('skipped');
  });
});
