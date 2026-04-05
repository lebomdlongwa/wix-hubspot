import { PrismaClient, SyncStatus } from '@prisma/client';
import { getTokens } from './token.service';
import { applyWixToHubSpotMappings, applyHubSpotToWixMappings, WixContact, updateWixContact, createWixContact } from './wix.service';
import { createAuthenticatedClient } from './hubspot.service';

const prisma = new PrismaClient();

const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * CONFLICT RESOLUTION RULE: "Originating system wins"
 *
 * When a contact is updated in one system, the change is propagated to the
 * other system. If the other system fires a return webhook, it is suppressed
 * by the loop-prevention layers so the original change is never overwritten.
 *
 * - Wix-originated update → pushed to HubSpot → HubSpot return webhook skipped
 *   (Layer 1: wix_sync_source correlation ID check within 5-minute window)
 * - HubSpot-originated update → pushed to Wix → Wix return webhook skipped
 *   (Layer 3: DB lastSyncedBy=HUBSPOT within 10-second window)
 *
 * In a true simultaneous conflict (both systems updated within seconds of each
 * other before any webhook fires), the webhook that arrives first determines
 * the outcome — effectively "last write wins" at the network level. This is
 * acceptable because such conflicts are rare and both systems reach consistency
 * within one sync cycle.
 */

// Written to HubSpot so we can detect our own syncs and skip the return webhook
function syncSourceTag(): string {
  return `wix_sync_${Date.now()}`;
}

/**
 * Layer 1 loop prevention: checks if a wix_sync_source tag was written recently.
 * If the tag starts with 'wix_sync_' and the embedded timestamp is within 5 min, skip.
 */
export function isCorrelationIdFresh(wixSyncSource: string | undefined): boolean {
  if (!wixSyncSource || !wixSyncSource.startsWith('wix_sync_')) return false;
  const ts = parseInt(wixSyncSource.replace('wix_sync_', ''), 10);
  if (isNaN(ts)) return false;
  return Date.now() - ts < DEDUP_WINDOW_MS;
}

async function getActiveMappings(instanceId: string) {
  return prisma.fieldMapping.findMany({ where: { instanceId, isActive: true } });
}

async function writeSyncLog(
  instanceId: string,
  direction: 'WIX' | 'HUBSPOT' | 'FORM' | 'MANUAL',
  status: SyncStatus,
  opts: { wixId?: string; hubspotId?: string; skipReason?: string; errorMessage?: string } = {}
) {
  await prisma.syncLog.create({
    data: { instanceId, direction, status, ...opts },
  });
}

// ─── Wix → HubSpot ────────────────────────────────────────────────────────────

export async function syncWixContactToHubSpot(
  instanceId: string,
  contact: WixContact
): Promise<void> {
  const tokens = await getTokens(instanceId);
  if (!tokens) throw new Error(`No HubSpot tokens for instanceId: ${instanceId}`);

  const mappings = await getActiveMappings(instanceId);
  const properties = applyWixToHubSpotMappings(contact, mappings);

  // Tag so the HubSpot webhook knows this change came from us (Layer 1 loop prevention)
  properties['wix_sync_source'] = syncSourceTag();

  const client = createAuthenticatedClient(instanceId);

  const existingMapping = await prisma.contactIdMapping.findUnique({
    where: { instanceId_wixContactId: { instanceId, wixContactId: contact.id } },
  });

  try {
    if (existingMapping) {
      await client.patch(
        `/crm/v3/objects/contacts/${existingMapping.hubspotContactId}`,
        { properties }
      );
      await prisma.contactIdMapping.update({
        where: { instanceId_wixContactId: { instanceId, wixContactId: contact.id } },
        data: { lastSyncedBy: 'WIX', lastSyncedAt: new Date() },
      });
    } else {
      const response = await client.post('/crm/v3/objects/contacts', { properties });
      const hubspotContactId: string = response.data.id;

      await prisma.contactIdMapping.create({
        data: {
          instanceId,
          wixContactId: contact.id,
          hubspotContactId,
          lastSyncedBy: 'WIX',
          lastSyncedAt: new Date(),
        },
      });
    }

    await writeSyncLog(instanceId, 'WIX', 'SUCCESS', {
      wixId: contact.id,
      hubspotId: existingMapping?.hubspotContactId,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await writeSyncLog(instanceId, 'WIX', 'ERROR', {
      wixId: contact.id,
      errorMessage: message,
    });
    throw err;
  }
}

// ─── HubSpot → Wix ────────────────────────────────────────────────────────────

export async function syncHubSpotContactToWix(
  instanceId: string,
  hsContactId: string,
  hsProperties: Record<string, string>
): Promise<{ skipped: boolean; skipReason?: string }> {
  // Layer 1: correlation ID check — did we write this change?
  if (isCorrelationIdFresh(hsProperties['wix_sync_source'])) {
    await writeSyncLog(instanceId, 'HUBSPOT', 'SKIPPED', {
      hubspotId: hsContactId,
      skipReason: 'Correlation ID detected — change originated from Wix sync',
    });
    return { skipped: true, skipReason: 'correlation_id' };
  }

  const existingMapping = await prisma.contactIdMapping.findUnique({
    where: { instanceId_hubspotContactId: { instanceId, hubspotContactId: hsContactId } },
  });

  const mappings = await getActiveMappings(instanceId);
  const wixFields = applyHubSpotToWixMappings(hsProperties, mappings);

  // No existing mapping — fetch full HubSpot contact and create in Wix
  if (!existingMapping) {
    try {
      const { createAuthenticatedClient } = await import('./hubspot.service');
      const client = createAuthenticatedClient(instanceId);
      const hsResponse = await client.get(`/crm/v3/objects/contacts/${hsContactId}?properties=firstname,lastname,email,phone,jobtitle,company`);
      const fullProps: Record<string, string> = { ...hsResponse.data.properties, ...hsProperties };
      const fullWixFields = applyHubSpotToWixMappings(fullProps, mappings);

      if (Object.keys(fullWixFields).length === 0) {
        await writeSyncLog(instanceId, 'HUBSPOT', 'SKIPPED', {
          hubspotId: hsContactId,
          skipReason: 'No mapped fields to create Wix contact with',
        });
        return { skipped: true, skipReason: 'no_mapped_fields' };
      }

      console.log('[syncHS→Wix] creating contact with fields:', JSON.stringify(fullWixFields));
      let wixContactId: string;
      try {
        wixContactId = await createWixContact(fullWixFields);
      } catch (createErr: any) {
        const duplicateId: string | undefined =
          createErr?.response?.data?.details?.applicationError?.data?.duplicateContactId;
        if (duplicateId) {
          console.log('[syncHS→Wix] duplicate detected, updating existing contact:', duplicateId);
          await updateWixContact(duplicateId, fullWixFields);
          wixContactId = duplicateId;
        } else {
          throw createErr;
        }
      }
      await prisma.contactIdMapping.create({
        data: {
          instanceId,
          wixContactId,
          hubspotContactId: hsContactId,
          lastSyncedBy: 'HUBSPOT',
          lastSyncedAt: new Date(),
        },
      });
      await writeSyncLog(instanceId, 'HUBSPOT', 'SUCCESS', {
        wixId: wixContactId,
        hubspotId: hsContactId,
      });
      return { skipped: false };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await writeSyncLog(instanceId, 'HUBSPOT', 'ERROR', {
        hubspotId: hsContactId,
        errorMessage: message,
      });
      throw err;
    }
  }

  // Layer 3: DB timestamp check — did we sync this contact from Wix very recently?
  const TEN_SECONDS = 10_000;
  if (
    existingMapping.lastSyncedBy === 'WIX' &&
    Date.now() - existingMapping.lastSyncedAt.getTime() < TEN_SECONDS
  ) {
    await writeSyncLog(instanceId, 'HUBSPOT', 'SKIPPED', {
      hubspotId: hsContactId,
      wixId: existingMapping.wixContactId,
      skipReason: 'Recently synced from Wix — skipping to prevent loop',
    });
    return { skipped: true, skipReason: 'recent_wix_sync' };
  }

  try {
    await updateWixContact(existingMapping.wixContactId, wixFields);
    await prisma.contactIdMapping.update({
      where: { instanceId_hubspotContactId: { instanceId, hubspotContactId: hsContactId } },
      data: { lastSyncedBy: 'HUBSPOT', lastSyncedAt: new Date() },
    });

    await writeSyncLog(instanceId, 'HUBSPOT', 'SUCCESS', {
      wixId: existingMapping.wixContactId,
      hubspotId: hsContactId,
    });
    return { skipped: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await writeSyncLog(instanceId, 'HUBSPOT', 'ERROR', {
      hubspotId: hsContactId,
      errorMessage: message,
    });
    throw err;
  }
}
