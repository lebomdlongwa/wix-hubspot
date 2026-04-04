import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

// GET /api/sync-log/:instanceId?limit=50&offset=0
// Returns recent sync log entries for the dashboard sync log table
router.get('/:instanceId', async (req: Request, res: Response) => {
  const { instanceId } = req.params;
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = parseInt(req.query.offset as string) || 0;

  const [logs, total] = await Promise.all([
    prisma.syncLog.findMany({
      where: { instanceId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.syncLog.count({ where: { instanceId } }),
  ]);

  res.json({ logs, total, limit, offset });
});

export default router;
