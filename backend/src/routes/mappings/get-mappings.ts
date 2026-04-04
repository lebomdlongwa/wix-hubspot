import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { getHubSpotProperties, WIX_CONTACT_FIELDS } from '../../services/hubspot.service';
import { getTokens } from '../../services/token.service';

const router = Router();
const prisma = new PrismaClient();

// GET /api/mappings/:instanceId
// Returns saved field mappings + available Wix fields + available HubSpot properties
router.get('/:instanceId', async (req: Request, res: Response) => {
  const { instanceId } = req.params;

  const tokens = await getTokens(instanceId);
  if (!tokens) {
    res.status(401).json({ error: 'HubSpot not connected for this instance' });
    return;
  }

  try {
    const [savedMappings, hubspotProperties] = await Promise.all([
      prisma.fieldMapping.findMany({ where: { instanceId, isActive: true } }),
      getHubSpotProperties(instanceId),
    ]);

    res.json({
      mappings: savedMappings,
      wixFields: WIX_CONTACT_FIELDS,
      hubspotProperties,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch mappings';
    res.status(500).json({ error: message });
  }
});

export default router;
