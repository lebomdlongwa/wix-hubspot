import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { PrismaClient } from '@prisma/client';
import app from '../index';

const prisma = new PrismaClient();
const INSTANCE_ID = 'test-instance-callback';

const server = setupServer(
  http.post('https://api.hubapi.com/oauth/v1/token', () => {
    return HttpResponse.json({
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expires_in: 1800,
    });
  }),
  http.get('https://api.hubapi.com/oauth/v1/access-tokens/:token', () => {
    return HttpResponse.json({
      hub_id: 99999,
      hub_domain: 'testportal.hubspot.com',
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(async () => {
  server.close();
  await prisma.hubSpotToken.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.appInstallation.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.$disconnect();
});

describe('GET /oauth/hubspot/callback', () => {
  it('valid code and instanceId → stores tokens and redirects', async () => {
    const res = await request(app)
      .get('/oauth/hubspot/callback')
      .query({ code: 'valid-code', state: INSTANCE_ID });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/oauth/hubspot/success');

    const stored = await prisma.hubSpotToken.findUnique({ where: { instanceId: INSTANCE_ID } });
    expect(stored).not.toBeNull();
    expect(stored!.accessToken).toBe('test-access-token');
    expect(stored!.portalId).toBe('99999');
  });

  it('missing code → 400', async () => {
    const res = await request(app)
      .get('/oauth/hubspot/callback')
      .query({ state: INSTANCE_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/code/i);
  });

  it('missing instanceId (state) → 400', async () => {
    const res = await request(app)
      .get('/oauth/hubspot/callback')
      .query({ code: 'some-code' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/instanceId/i);
  });

  it('HubSpot returns error → 400 with error message', async () => {
    server.use(
      http.post('https://api.hubapi.com/oauth/v1/token', () => {
        return HttpResponse.json({ message: 'Bad code' }, { status: 400 });
      })
    );

    const res = await request(app)
      .get('/oauth/hubspot/callback')
      .query({ code: 'bad-code', state: INSTANCE_ID });

    expect(res.status).toBe(400);
  });
});
