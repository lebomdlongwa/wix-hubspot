import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { PrismaClient } from '@prisma/client';
import app from '../index';
import { storeTokens } from '../services/token.service';

const prisma = new PrismaClient();
const INSTANCE_ID = 'test-instance-forms';
const APP_SECRET = 'test-forms-secret';
const SUBMISSION_ID = 'sub-forms-001';

const server = setupServer(
  http.post('https://api.hubapi.com/crm/v3/objects/contacts', () => {
    return HttpResponse.json({ id: 'hs-form-contact-001' }, { status: 201 });
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
    submissionId: SUBMISSION_ID,
    submissions: {
      email: { value: 'formuser@example.com' },
      first_name: { value: 'Form' },
      last_name: { value: 'User' },
      utm_source: { value: 'facebook' },
      utm_medium: { value: 'ad' },
      utm_campaign: { value: 'launch' },
      utm_term: { value: null },
      utm_content: { value: null },
    },
  },
};

beforeAll(async () => {
  server.listen();
  process.env.WIX_APP_SECRET = APP_SECRET;
  await storeTokens(INSTANCE_ID, {
    accessToken: 'access-forms',
    refreshToken: 'refresh-forms',
    expiresAt: new Date(Date.now() + 1800_000),
    portalId: '12345',
  });
});

afterAll(async () => {
  server.close();
  await prisma.formSubmissionLog.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.hubSpotToken.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.appInstallation.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.$disconnect();
});

describe('POST /webhooks/wix/forms', () => {
  it('invalid signature → 401', async () => {
    const res = await request(app)
      .post('/webhooks/wix/forms')
      .set('x-wix-signature', 'bad-sig')
      .send(validPayload);

    expect(res.status).toBe(401);
  });

  it('valid submission → HubSpot contact upserted and FormSubmissionLog created', async () => {
    const sig = makeSignature(validPayload);
    const res = await request(app)
      .post('/webhooks/wix/forms')
      .set('x-wix-signature', sig)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.hubspotContactId).toBe('hs-form-contact-001');

    const log = await prisma.formSubmissionLog.findUnique({
      where: { wixSubmissionId: SUBMISSION_ID },
    });
    expect(log).not.toBeNull();
    expect(log!.utmSource).toBe('facebook');
    expect(log!.utmMedium).toBe('ad');
    expect(log!.utmCampaign).toBe('launch');
    expect(log!.utmTerm).toBeNull();
    expect(log!.hubspotContactId).toBe('hs-form-contact-001');
  });

  it('duplicate submissionId → skipped (idempotent)', async () => {
    const sig = makeSignature(validPayload);
    const res = await request(app)
      .post('/webhooks/wix/forms')
      .set('x-wix-signature', sig)
      .send(validPayload);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('skipped');
    expect(res.body.reason).toBe('duplicate submission');
  });

  it('missing email → 400', async () => {
    const noEmailPayload = {
      instanceId: INSTANCE_ID,
      data: {
        submissionId: 'sub-no-email',
        submissions: { first_name: { value: 'NoEmail' } },
      },
    };
    const sig = makeSignature(noEmailPayload);
    const res = await request(app)
      .post('/webhooks/wix/forms')
      .set('x-wix-signature', sig)
      .send(noEmailPayload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });
});
