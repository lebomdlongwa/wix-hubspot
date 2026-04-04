import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { PrismaClient } from '@prisma/client';
import app from '../index';
import { storeTokens } from '../services/token.service';
import { maskEmail, logger } from '../utils/logger';
import { clearKey } from '../services/dedup.service';

const prisma = new PrismaClient();
const INSTANCE_ID = 'test-instance-hardening';
const APP_SECRET = 'hardening-secret';

function makeSignature(body: object): string {
  return crypto.createHmac('sha256', APP_SECRET).update(JSON.stringify(body)).digest('base64');
}

// ─── Token refresh on 401 ─────────────────────────────────────────────────────

let callCount = 0;

const server = setupServer(
  // First call returns 401, second returns success after refresh
  http.post('https://api.hubapi.com/crm/v3/objects/contacts', () => {
    callCount++;
    if (callCount === 1) {
      return HttpResponse.json({ message: 'Expired token' }, { status: 401 });
    }
    return HttpResponse.json({ id: 'hs-refreshed-contact' }, { status: 201 });
  }),
  // Mock token refresh
  http.post('https://api.hubapi.com/oauth/v1/token', () => {
    return HttpResponse.json({
      access_token: 'refreshed-access-token',
      refresh_token: 'refreshed-refresh-token',
      expires_in: 1800,
    });
  })
);

beforeAll(async () => {
  server.listen();
  process.env.WIX_APP_SECRET = APP_SECRET;
  await storeTokens(INSTANCE_ID, {
    accessToken: 'expired-token',
    refreshToken: 'valid-refresh-token',
    expiresAt: new Date(Date.now() + 1800_000),
    portalId: '12345',
  });
  await prisma.fieldMapping.createMany({
    data: [
      { instanceId: INSTANCE_ID, wixField: 'info.emails[0].email', hubspotProperty: 'email', direction: 'BOTH', isActive: true },
    ],
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

describe('Token refresh on 401', () => {
  it('retries with refreshed token when HubSpot returns 401', async () => {
    callCount = 0;
    await clearKey('wix-to-hs', INSTANCE_ID, 'wix-hardening-001');
    const payload = {
      instanceId: INSTANCE_ID,
      data: {
        id: 'wix-hardening-001',
        info: { emails: [{ email: 'hardening@example.com' }] },
      },
    };
    const sig = makeSignature(payload);
    const res = await request(app)
      .post('/webhooks/wix/contacts')
      .set('x-wix-signature', sig)
      .send(payload);

    // Should succeed after refresh
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    // HubSpot was called twice: once with expired token (401), once after refresh
    expect(callCount).toBe(2);
  });
});

// ─── Zod validation ───────────────────────────────────────────────────────────

describe('Zod validation on webhook payloads', () => {
  it('wix-contacts webhook rejects payload missing data.id → 400', async () => {
    const badPayload = { instanceId: INSTANCE_ID, data: { info: {} } };
    const sig = makeSignature(badPayload);
    const res = await request(app)
      .post('/webhooks/wix/contacts')
      .set('x-wix-signature', sig)
      .send(badPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid payload');
  });

  it('wix-forms webhook rejects payload missing data.submissionId → 400', async () => {
    const badPayload = { instanceId: INSTANCE_ID, data: {} };
    const sig = makeSignature(badPayload);
    const res = await request(app)
      .post('/webhooks/wix/forms')
      .set('x-wix-signature', sig)
      .send(badPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid payload');
  });

  it('hubspot-contacts webhook rejects payload missing portalId → 400', async () => {
    const badPayload = [{ objectId: 12345, propertyName: 'email' }];
    const res = await request(app)
      .post('/webhooks/hubspot/contacts')
      .set('x-hubspot-signature-v3', 'valid-test-sig')
      .set('x-hubspot-request-timestamp', String(Date.now()))
      .send(badPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid payload');
  });
});

// ─── Logger PII masking ───────────────────────────────────────────────────────

describe('Logger PII masking', () => {
  it('maskEmail masks email correctly', () => {
    expect(maskEmail('jane@example.com')).toBe('j***@example.com');
    expect(maskEmail('bob@test.co.za')).toBe('b***@test.co.za');
  });

  it('logger does not throw when logging objects with sensitive fields', () => {
    expect(() =>
      logger.info('test', { accessToken: 'secret123', email: 'user@example.com' })
    ).not.toThrow();
  });

  it('logger redacts accessToken in output', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('test log', { accessToken: 'super-secret', name: 'Alice' });
    const output = spy.mock.calls[0].join(' ');
    expect(output).not.toContain('super-secret');
    expect(output).toContain('[REDACTED]');
    spy.mockRestore();
  });
});
