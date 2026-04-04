import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { PrismaClient } from '@prisma/client';
import app from '../index';
import { storeTokens } from '../services/token.service';

const prisma = new PrismaClient();
const INSTANCE_ID = 'test-instance-get-mappings';

const server = setupServer(
  http.get('https://api.hubapi.com/crm/v3/properties/contacts', () => {
    return HttpResponse.json({
      results: [
        { name: 'email', label: 'Email', type: 'string' },
        { name: 'firstname', label: 'First Name', type: 'string' },
        { name: 'lastname', label: 'Last Name', type: 'string' },
        { name: 'phone', label: 'Phone Number', type: 'string' },
      ],
    });
  })
);

beforeAll(async () => {
  server.listen();
  await storeTokens(INSTANCE_ID, {
    accessToken: 'access-mappings',
    refreshToken: 'refresh-mappings',
    expiresAt: new Date(Date.now() + 1800_000),
    portalId: '12345',
  });
  // Seed a saved mapping
  await prisma.fieldMapping.create({
    data: {
      instanceId: INSTANCE_ID,
      wixField: 'info.emails[0].email',
      hubspotProperty: 'email',
      direction: 'BOTH',
      isActive: true,
    },
  });
});

afterAll(async () => {
  server.close();
  await prisma.fieldMapping.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.hubSpotToken.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.appInstallation.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.$disconnect();
});

describe('GET /api/mappings/:instanceId', () => {
  it('returns saved mappings, wixFields, and hubspotProperties', async () => {
    const res = await request(app).get(`/api/mappings/${INSTANCE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.mappings).toHaveLength(1);
    expect(res.body.mappings[0].hubspotProperty).toBe('email');
    expect(res.body.wixFields.length).toBeGreaterThan(0);
    expect(res.body.hubspotProperties).toHaveLength(4);
  });

  it('returns 401 when HubSpot is not connected', async () => {
    const res = await request(app).get('/api/mappings/not-connected-instance');
    expect(res.status).toBe(401);
  });
});
