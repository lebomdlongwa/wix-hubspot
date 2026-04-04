import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { extractUtm, utmToHubSpotProperties, FormSubmission } from '../../services/utm.service';
import { getTokens } from '../../services/token.service';
import { createAuthenticatedClient } from '../../services/hubspot.service';
import { logger } from '../../utils/logger';
import { get } from 'lodash';

const WixFormWebhookSchema = z.object({
  instanceId: z.string().min(1),
  data: z.object({
    submissionId: z.string().min(1),
    submissions: z.record(z.object({ value: z.unknown() })).optional(),
  }),
});

const router = Router();
const prisma = new PrismaClient();

function verifyWixSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.WIX_APP_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

// POST /webhooks/wix/forms
router.post('/', async (req: Request, res: Response) => {
  const signature = req.headers['x-wix-signature'] as string | undefined;
  const rawBody = JSON.stringify(req.body);

  if (!signature || !verifyWixSignature(rawBody, signature)) {
    res.status(401).json({ error: 'Invalid webhook signature' });
    return;
  }

  const parsed = WixFormWebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid payload', details: parsed.error.flatten() });
    return;
  }

  const { instanceId, data } = parsed.data as { instanceId: string; data: FormSubmission };

  // Idempotency — skip if we already processed this submission
  const existing = await prisma.formSubmissionLog.findUnique({
    where: { wixSubmissionId: data.submissionId },
  });
  if (existing) {
    res.json({ status: 'skipped', reason: 'duplicate submission' });
    return;
  }

  const tokens = await getTokens(instanceId);
  if (!tokens) {
    res.status(401).json({ error: 'HubSpot not connected for this instance' });
    return;
  }

  // Extract email from submission fields
  const submissionsMap: Record<string, { value: unknown }> =
    (get(data, 'submissions') as Record<string, { value: unknown }>) ?? {};

  let email: string | null = null;
  let firstName: string | null = null;
  let lastName: string | null = null;

  for (const [key, entry] of Object.entries(submissionsMap)) {
    const normalizedKey = key.toLowerCase();
    const value = entry.value != null ? String(entry.value) : null;
    if (normalizedKey.includes('email')) email = value;
    if (normalizedKey.includes('first')) firstName = value;
    if (normalizedKey.includes('last')) lastName = value;
  }

  if (!email) {
    res.status(400).json({ error: 'No email found in form submission' });
    return;
  }

  // Extract UTM params
  const utm = extractUtm(data);
  const utmProperties = utmToHubSpotProperties(utm);

  // Build HubSpot contact properties
  const properties: Record<string, string> = {
    email,
    ...utmProperties,
  };
  if (firstName) properties['firstname'] = firstName;
  if (lastName) properties['lastname'] = lastName;

  try {
    // Upsert HubSpot contact by email using auto-refreshing authenticated client
    const client = createAuthenticatedClient(instanceId);
    const response = await client.post(
      '/crm/v3/objects/contacts',
      { properties },
      { params: { idProperty: 'email' } }
    );
    const hubspotContactId: string = response.data.id;

    // Ensure AppInstallation exists
    await prisma.appInstallation.upsert({
      where: { instanceId },
      update: {},
      create: { instanceId },
    });

    // Log the submission
    await prisma.formSubmissionLog.create({
      data: {
        instanceId,
        wixSubmissionId: data.submissionId,
        hubspotContactId,
        utmSource: utm.utmSource,
        utmMedium: utm.utmMedium,
        utmCampaign: utm.utmCampaign,
        utmTerm: utm.utmTerm,
        utmContent: utm.utmContent,
        rawSubmission: data as object,
        syncedAt: new Date(),
      },
    });

    logger.info('Form submission synced to HubSpot', { instanceId, submissionId: data.submissionId, hubspotContactId });
    res.json({ status: 'ok', hubspotContactId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to sync form submission';
    const axiosErr = err as any;
    if (axiosErr?.response?.data) {
      console.error('[Forms] HubSpot error:', JSON.stringify(axiosErr.response.data));
    }
    logger.error('Form submission sync failed', { instanceId, submissionId: data.submissionId, message });
    res.status(500).json({ error: message });
  }
});

export default router;
