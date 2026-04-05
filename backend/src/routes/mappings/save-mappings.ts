import { Router, Request, Response } from 'express';
import { PrismaClient, SyncDirection } from '@prisma/client';
import { z } from 'zod';
import { getTokens } from '../../services/token.service';

const router = Router();
const prisma = new PrismaClient();

const VALID_TRANSFORMS = ['none', 'trim', 'lowercase', 'uppercase'] as const;

const MappingSchema = z.object({
  wixField: z.string().min(1),
  hubspotProperty: z.string().min(1),
  direction: z.nativeEnum(SyncDirection),
  transform: z.enum(VALID_TRANSFORMS).default('none'),
});

const SaveMappingsSchema = z.object({
  mappings: z.array(MappingSchema),
});

// POST /api/mappings/:instanceId
// Validates and saves field mappings, replacing all existing ones for the instance
router.post('/:instanceId', async (req: Request, res: Response) => {
  const { instanceId } = req.params;

  const tokens = await getTokens(instanceId);
  if (!tokens) {
    res.status(401).json({ error: 'HubSpot not connected for this instance' });
    return;
  }

  const parsed = SaveMappingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
    return;
  }

  const { mappings } = parsed.data;

  // Validate: no two rows with the same hubspotProperty and conflicting directions
  const seen = new Map<string, SyncDirection>();
  for (const m of mappings) {
    const existing = seen.get(m.hubspotProperty);
    if (existing && existing !== m.direction) {
      res.status(422).json({
        error: `HubSpot property "${m.hubspotProperty}" is mapped with conflicting directions`,
      });
      return;
    }
    seen.set(m.hubspotProperty, m.direction);
  }

  // Ensure AppInstallation exists
  await prisma.appInstallation.upsert({
    where: { instanceId },
    update: {},
    create: { instanceId },
  });

  // Replace all mappings for this instance in a transaction
  await prisma.$transaction([
    prisma.fieldMapping.deleteMany({ where: { instanceId } }),
    prisma.fieldMapping.createMany({
      data: mappings.map((m) => ({
        instanceId,
        wixField: m.wixField,
        hubspotProperty: m.hubspotProperty,
        direction: m.direction,
        transform: m.transform,
        isActive: true,
      })),
    }),
  ]);

  const saved = await prisma.fieldMapping.findMany({ where: { instanceId, isActive: true } });
  res.json({ mappings: saved });
});

export default router;
