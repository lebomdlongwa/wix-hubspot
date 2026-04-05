import { Router, Request, Response } from 'express';
import express from 'express';
import { PrismaClient } from '@prisma/client';
import { extractUtm, utmToHubSpotProperties, FormSubmission } from '../../services/utm.service';
import { getTokens } from '../../services/token.service';
import { createAuthenticatedClient } from '../../services/hubspot.service';
import { wixClient } from '../../services/wix-sdk-client.service';
import { logger } from '../../utils/logger';
import { get } from 'lodash';

const router = Router();
const prisma = new PrismaClient();

// POST /webhooks/wix/forms
router.post('/', express.text({ type: '*/*' }), async (req: Request, res: Response) => {
  const isTest = process.env.NODE_ENV === 'test';

  let instanceId: string;
  let data: FormSubmission;

  if (isTest) {
    const body = JSON.parse(req.body);
    instanceId = body.instanceId;
    data = body.data;
  } else {
    try {
      const event = await wixClient.webhooks.parseJWT(req.body);
      const ev = event as any;
      instanceId = ev.instanceId ?? '';
      const payload = ev.payload ?? {};
      // Form submission data is in the createdEvent entity
      const entity = payload.createdEvent?.entity ?? payload.data ?? {};
      data = {
        submissionId: entity.submissionId ?? payload.entityId ?? '',
        submissions: entity.submissions ?? entity.formFieldValues ?? {},
        ...entity,
      } as FormSubmission;
    } catch (err) {
      logger.error('Wix forms webhook JWT verification failed', { error: err instanceof Error ? err.message : err });
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }
  }

  if (!instanceId || !data?.submissionId) {
    // Log and respond 200 to avoid Wix retrying — the submission might have a different structure
    logger.warn('Wix forms webhook: missing instanceId or submissionId', { instanceId, submissionId: data?.submissionId });
    res.status(200).json({ status: 'skipped', reason: 'missing required fields' });
    return;
  }

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
    logger.warn('Wix forms webhook: no email found', { instanceId, submissionId: data.submissionId, submissionsMap: JSON.stringify(submissionsMap) });
    res.status(200).json({ status: 'skipped', reason: 'no email found' });
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
