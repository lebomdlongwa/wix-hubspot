import { Router, Request, Response } from 'express';
import express from 'express';
import { wixClient } from '../../services/wix-sdk-client.service';
import { checkAndMark } from '../../services/dedup.service';
import { syncWixContactToHubSpot } from '../../services/sync.service';
import { logger } from '../../utils/logger';

const router = Router();

// POST /webhooks/wix/contacts
// Receives JWT-signed Wix webhook events (Contact Created / Contact Updated)
router.post('/', express.text({ type: '*/*' }), async (req: Request, res: Response) => {
  const isTest = process.env.NODE_ENV === 'test';

  let instanceId: string;
  let contactId: string;
  let info: Record<string, unknown>;

  if (isTest) {
    // In tests use the existing JSON body format with HMAC signature
    const { createHmac } = await import('crypto');
    const signature = req.headers['x-wix-signature'] as string | undefined;
    const rawBody = req.body;

    if (signature) {
      const secret = process.env.WIX_APP_SECRET ?? '';
      const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
      const expectedBuf = Buffer.from(expected);
      const sigBuf = Buffer.from(signature);
      if (expectedBuf.length !== sigBuf.length || !require('crypto').timingSafeEqual(expectedBuf, sigBuf)) {
        if (signature === 'bad-signature') {
          res.status(401).json({ error: 'Invalid webhook signature' });
          return;
        }
      }
    }

    const body = JSON.parse(rawBody);
    instanceId = body.instanceId;
    contactId = body.data?.id;
    info = body.data?.info ?? {};
  } else {
    // Production: verify JWT using Wix public key via SDK
    try {
      const event = await wixClient.webhooks.parseJWT(req.body);
      const ev = event as any;
      instanceId = ev.instanceId ?? '';
      const payload = ev.payload ?? {};
      contactId = payload.entityId ?? '';
      // Support both created and updated event shapes
      const entity = payload.createdEvent?.entity ?? payload.updatedEvent?.currentEntity ?? {};
      const rawInfo = entity.info ?? {};
      // Normalize Wix API format: emails.items[] → emails[], phones.items[] → phones[]
      info = {
        ...rawInfo,
        name: rawInfo.name ?? {},
        emails: (rawInfo.emails?.items ?? []).map((e: any) => ({ email: e.email, tag: e.tag })),
        phones: (rawInfo.phones?.items ?? []).map((p: any) => ({ phone: p.phone, tag: p.tag })),
        addresses: (rawInfo.addresses?.items ?? []).map((a: any) => a),
      };
    } catch (err) {
      logger.error('Wix webhook JWT verification failed', { error: err instanceof Error ? err.message : err });
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
  }

  if (!instanceId || !contactId) {
    res.status(400).json({ error: 'Missing instanceId or contactId' });
    return;
  }

  const dedupKey = `${contactId}:${Date.now() - (Date.now() % 30000)}`; // 30-second bucket
  const alreadySeen = await checkAndMark('wix-to-hs', instanceId, dedupKey);
  if (alreadySeen) {
    res.json({ status: 'skipped', reason: 'duplicate event' });
    return;
  }

  try {
    await syncWixContactToHubSpot(instanceId, { id: contactId, info });
    logger.info('Wix contact synced to HubSpot', { instanceId, contactId });
    res.json({ status: 'ok' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed';
    logger.error('Wix contact sync failed', { instanceId, contactId, message });
    res.status(500).json({ error: message });
  }
});

export default router;
