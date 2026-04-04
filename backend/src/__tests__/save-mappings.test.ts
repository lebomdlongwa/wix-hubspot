import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import app from '../index';
import { storeTokens } from '../services/token.service';

const prisma = new PrismaClient();
const INSTANCE_ID = 'test-instance-save-mappings';

beforeAll(async () => {
  await storeTokens(INSTANCE_ID, {
    accessToken: 'access-save',
    refreshToken: 'refresh-save',
    expiresAt: new Date(Date.now() + 1800_000),
    portalId: '12345',
  });
});

afterAll(async () => {
  await prisma.fieldMapping.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.hubSpotToken.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.appInstallation.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.$disconnect();
});

describe('POST /api/mappings/:instanceId', () => {
  it('saves valid mappings and returns them', async () => {
    const res = await request(app)
      .post(`/api/mappings/${INSTANCE_ID}`)
      .send({
        mappings: [
          { wixField: 'info.emails[0].email', hubspotProperty: 'email', direction: 'BOTH' },
          { wixField: 'info.name.first', hubspotProperty: 'firstname', direction: 'WIX_TO_HS' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.mappings).toHaveLength(2);
  });

  it('replaces existing mappings on second save', async () => {
    const res = await request(app)
      .post(`/api/mappings/${INSTANCE_ID}`)
      .send({
        mappings: [
          { wixField: 'info.phones[0].phone', hubspotProperty: 'phone', direction: 'BOTH' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.mappings).toHaveLength(1);
    expect(res.body.mappings[0].hubspotProperty).toBe('phone');
  });

  it('rejects duplicate hubspotProperty with conflicting directions → 422', async () => {
    const res = await request(app)
      .post(`/api/mappings/${INSTANCE_ID}`)
      .send({
        mappings: [
          { wixField: 'info.emails[0].email', hubspotProperty: 'email', direction: 'WIX_TO_HS' },
          { wixField: 'info.name.first', hubspotProperty: 'email', direction: 'HS_TO_WIX' },
        ],
      });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/conflicting/i);
  });

  it('returns 400 for invalid request body', async () => {
    const res = await request(app)
      .post(`/api/mappings/${INSTANCE_ID}`)
      .send({ mappings: [{ wixField: '', hubspotProperty: 'email', direction: 'INVALID' }] });

    expect(res.status).toBe(400);
  });

  it('returns 401 when HubSpot is not connected', async () => {
    const res = await request(app)
      .post('/api/mappings/not-connected-instance')
      .send({ mappings: [] });

    expect(res.status).toBe(401);
  });
});
