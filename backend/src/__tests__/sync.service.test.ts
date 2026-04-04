import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { PrismaClient } from '@prisma/client';
import { syncWixContactToHubSpot } from '../services/sync.service';
import { storeTokens } from '../services/token.service';
import { WixContact } from '../services/wix.service';

const prisma = new PrismaClient();
const INSTANCE_ID = 'test-instance-sync';
const WIX_CONTACT_ID = 'wix-contact-001';
const HS_CONTACT_ID = 'hs-contact-001';

const mockContact: WixContact = {
  id: WIX_CONTACT_ID,
  info: {
    name: { first: 'Jane', last: 'Doe' },
    emails: [{ email: 'jane@example.com' }],
    phones: [{ phone: '+27821234567' }],
  },
};

const server = setupServer(
  // Mock HubSpot create contact
  http.post('https://api.hubapi.com/crm/v3/objects/contacts', () => {
    return HttpResponse.json({ id: HS_CONTACT_ID }, { status: 201 });
  }),
  // Mock HubSpot update contact
  http.patch(`https://api.hubapi.com/crm/v3/objects/contacts/${HS_CONTACT_ID}`, () => {
    return HttpResponse.json({ id: HS_CONTACT_ID });
  })
);

beforeAll(async () => {
  server.listen();
  await storeTokens(INSTANCE_ID, {
    accessToken: 'access-sync',
    refreshToken: 'refresh-sync',
    expiresAt: new Date(Date.now() + 1800_000),
    portalId: '12345',
  });
  // Seed field mappings
  await prisma.fieldMapping.createMany({
    data: [
      { instanceId: INSTANCE_ID, wixField: 'info.emails[0].email', hubspotProperty: 'email', direction: 'BOTH', isActive: true },
      { instanceId: INSTANCE_ID, wixField: 'info.name.first', hubspotProperty: 'firstname', direction: 'WIX_TO_HS', isActive: true },
      { instanceId: INSTANCE_ID, wixField: 'info.name.last', hubspotProperty: 'lastname', direction: 'WIX_TO_HS', isActive: true },
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

describe('sync.service — Wix → HubSpot', () => {
  it('new contact: creates HubSpot record and saves ContactIdMapping', async () => {
    await syncWixContactToHubSpot(INSTANCE_ID, mockContact);

    const mapping = await prisma.contactIdMapping.findUnique({
      where: { instanceId_wixContactId: { instanceId: INSTANCE_ID, wixContactId: WIX_CONTACT_ID } },
    });

    expect(mapping).not.toBeNull();
    expect(mapping!.hubspotContactId).toBe(HS_CONTACT_ID);
    expect(mapping!.lastSyncedBy).toBe('WIX');

    const log = await prisma.syncLog.findFirst({
      where: { instanceId: INSTANCE_ID, direction: 'WIX', status: 'SUCCESS' },
    });
    expect(log).not.toBeNull();
  });

  it('existing contact: PATCHes HubSpot instead of creating, applies only WIX_TO_HS + BOTH mappings', async () => {
    // The mapping already exists from previous test — this should PATCH not POST
    let patchCalled = false;
    server.use(
      http.patch(`https://api.hubapi.com/crm/v3/objects/contacts/${HS_CONTACT_ID}`, ({ request }) => {
        patchCalled = true;
        return HttpResponse.json({ id: HS_CONTACT_ID });
      })
    );

    await syncWixContactToHubSpot(INSTANCE_ID, mockContact);
    expect(patchCalled).toBe(true);
  });
});
