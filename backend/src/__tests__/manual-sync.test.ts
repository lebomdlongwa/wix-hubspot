import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { PrismaClient } from '@prisma/client';
import app from '../index';
import { storeTokens } from '../services/token.service';

const prisma = new PrismaClient();
const INSTANCE_ID = 'test-instance-manual-sync';

// 3 mock Wix contacts to paginate through
const mockContacts = [
  { id: 'wix-sync-001', info: { name: { first: 'Alice' }, emails: [{ email: 'alice@example.com' }] } },
  { id: 'wix-sync-002', info: { name: { first: 'Bob' }, emails: [{ email: 'bob@example.com' }] } },
  { id: 'wix-sync-003', info: { name: { first: 'Carol' }, emails: [{ email: 'carol@example.com' }] } },
];

let hsIdCounter = 100;

const server = setupServer(
  // Mock Wix contacts query — returns all 3 contacts in one page
  http.post('https://www.wixapis.com/contacts/v4/contacts/query', () => {
    return HttpResponse.json({
      contacts: mockContacts,
      pagingMetadata: { cursors: { next: null } },
    });
  }),
  // Mock HubSpot create contact — returns unique IDs
  http.post('https://api.hubapi.com/crm/v3/objects/contacts', () => {
    return HttpResponse.json({ id: String(++hsIdCounter) }, { status: 201 });
  })
);

beforeAll(async () => {
  server.listen();
  await storeTokens(INSTANCE_ID, {
    accessToken: 'access-manual-sync',
    refreshToken: 'refresh-manual-sync',
    expiresAt: new Date(Date.now() + 1800_000),
    portalId: '12345',
  });
  await prisma.fieldMapping.createMany({
    data: [
      { instanceId: INSTANCE_ID, wixField: 'info.emails[0].email', hubspotProperty: 'email', direction: 'BOTH', isActive: true },
      { instanceId: INSTANCE_ID, wixField: 'info.name.first', hubspotProperty: 'firstname', direction: 'WIX_TO_HS', isActive: true },
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

describe('POST /api/sync/:instanceId', () => {
  it('syncs all paginated Wix contacts and returns totals', async () => {
    const res = await request(app).post(`/api/sync/${INSTANCE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.totalSynced).toBe(3);
    expect(res.body.totalErrors).toBe(0);
  });

  it('writes a SyncLog row for each contact', async () => {
    const logs = await prisma.syncLog.findMany({
      where: { instanceId: INSTANCE_ID, direction: 'WIX', status: 'SUCCESS' },
    });
    expect(logs).toHaveLength(3);
  });

  it('creates a ContactIdMapping for each contact', async () => {
    const mappings = await prisma.contactIdMapping.findMany({
      where: { instanceId: INSTANCE_ID },
    });
    expect(mappings).toHaveLength(3);
  });

  it('returns 401 when HubSpot is not connected', async () => {
    const res = await request(app).post('/api/sync/not-connected-instance');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/sync-log/:instanceId', () => {
  it('returns sync log entries for the instance', async () => {
    const res = await request(app).get(`/api/sync-log/${INSTANCE_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBeGreaterThanOrEqual(3);
    expect(res.body.total).toBeGreaterThanOrEqual(3);
    expect(res.body.logs[0]).toHaveProperty('status');
    expect(res.body.logs[0]).toHaveProperty('direction');
    expect(res.body.logs[0]).toHaveProperty('createdAt');
  });

  it('respects limit and offset query params', async () => {
    const res = await request(app).get(`/api/sync-log/${INSTANCE_ID}?limit=2&offset=0`);

    expect(res.status).toBe(200);
    expect(res.body.logs).toHaveLength(2);
    expect(res.body.limit).toBe(2);
  });
});
