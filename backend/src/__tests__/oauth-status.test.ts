import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../index';
import { storeTokens } from '../services/token.service';

const prisma = new PrismaClient();
const INSTANCE_ID = 'test-instance-status';

beforeAll(async () => {
  await storeTokens(INSTANCE_ID, {
    accessToken: 'access-xyz',
    refreshToken: 'refresh-xyz',
    expiresAt: new Date(Date.now() + 1800_000),
    portalId: '55555',
    portalName: 'My Portal',
  });
});

afterAll(async () => {
  await prisma.hubSpotToken.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.appInstallation.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.$disconnect();
});

describe('GET /api/oauth/status/:instanceId', () => {
  it('connected instance returns connected=true and portal name', async () => {
    const res = await request(app).get(`/api/oauth/status/${INSTANCE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.portalName).toBe('My Portal');
    expect(res.body.portalId).toBe('55555');
  });

  it('disconnected instance returns connected=false', async () => {
    const res = await request(app).get('/api/oauth/status/unknown-instance');
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);
  });
});

describe('DELETE /api/oauth/status/:instanceId', () => {
  it('disconnects HubSpot and returns connected=false', async () => {
    const res = await request(app).delete(`/api/oauth/status/${INSTANCE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(false);

    const check = await request(app).get(`/api/oauth/status/${INSTANCE_ID}`);
    expect(check.body.connected).toBe(false);
  });
});
