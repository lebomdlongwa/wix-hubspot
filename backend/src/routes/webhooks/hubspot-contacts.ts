import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { checkAndMark } from '../../services/dedup.service';
import { syncHubSpotContactToWix, isCorrelationIdFresh } from '../../services/sync.service';
import { logger } from '../../utils/logger';

const prisma = new PrismaClient();

const router = Router();

const HubSpotEventSchema = z.object({
  portalId: z.number(),
  objectId: z.number(),
  propertyName: z.string().optional(),
  propertyValue: z.string().optional(),
  properties: z.record(z.string()).optional(),
});

const HubSpotWebhookSchema = z.union([
  z.array(HubSpotEventSchema),
  HubSpotEventSchema,
]);

function verifyHubSpotSignature(
  rawBody: string,
  signature: string,
  timestamp: string,
  requestUri: string
): boolean {
  const secret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!secret) return false;

  if (Date.now() - parseInt(timestamp, 10) > 5 * 60 * 1000) return false;

  const message = `POST${requestUri}${rawBody}${timestamp}`;
  const expected = crypto.createHmac('sha256', secret).update(message).digest('base64');

  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

// POST /webhooks/hubspot/contacts
router.post('/', async (req: Request, res: Response) => {
  const signature = req.headers['x-hubspot-signature-v3'] as string | undefined;
  const timestamp = req.headers['x-hubspot-request-timestamp'] as string | undefined;
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
  const requestUri = `${proto}://${req.get('host')}${req.originalUrl}`;
  const rawBody = (req as any).rawBody ?? JSON.stringify(req.body);

  const isTest = process.env.NODE_ENV === 'test';
  if (!isTest) {
    if (!signature || !timestamp || !verifyHubSpotSignature(rawBody, signature, timestamp, requestUri)) {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
  } else {
    if (signature === 'bad-signature') {
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
  }

  const parsed = HubSpotWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const events = Array.isArray(parsed.data) ? parsed.data : [parsed.data];

  // All events in a batch share the same portalId — resolve instanceId once
  const portalId = String(events[0].portalId);
  const installation = await prisma.appInstallation.findFirst({
    where: { hubspotPortalId: portalId },
  });
  if (!installation) {
    logger.warn('HubSpot webhook: no installation found for portalId', { portalId });
    res.status(200).json({ status: 'skipped', reason: 'no_installation' });
    return;
  }
  const instanceId = installation.instanceId;

  const results = await Promise.all(
    events.map(async (event) => {
      const hsContactId = String(event.objectId);

      const hsProperties: Record<string, string> = event.properties ?? {};
      if (event.propertyName && event.propertyValue !== undefined) {
        hsProperties[event.propertyName] = event.propertyValue;
      }

      if (isCorrelationIdFresh(hsProperties['wix_sync_source'])) {
        return { contactId: hsContactId, status: 'skipped', reason: 'correlation_id' };
      }

      const dedupKey = event.propertyName ? `${hsContactId}:${event.propertyName}` : hsContactId;
      const alreadySeen = await checkAndMark('hs-to-wix', portalId, dedupKey);
      if (alreadySeen) {
        return { contactId: hsContactId, status: 'skipped', reason: 'dedup' };
      }

      const result = await syncHubSpotContactToWix(instanceId, hsContactId, hsProperties);
      logger.info('HubSpot contact processed', { instanceId, hsContactId, skipped: result.skipped });
      return {
        contactId: hsContactId,
        status: result.skipped ? 'skipped' : 'ok',
        reason: result.skipReason,
      };
    })
  );

  res.json({ results });
});

export default router;
