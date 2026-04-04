import { Router, Request, Response } from 'express';
import { getTokens, deleteTokens } from '../../services/token.service';

const router = Router();

// GET /api/oauth/status/:instanceId
// Returns whether HubSpot is connected and the portal name
router.get('/:instanceId', async (req: Request, res: Response) => {
  const { instanceId } = req.params;

  const tokens = await getTokens(instanceId);

  if (!tokens) {
    res.json({ connected: false });
    return;
  }

  res.json({
    connected: true,
    portalId: tokens.portalId,
    portalName: tokens.portalName ?? null,
  });
});

// DELETE /api/oauth/status/:instanceId
// Disconnects HubSpot by deleting stored tokens
router.delete('/:instanceId', async (req: Request, res: Response) => {
  const { instanceId } = req.params;
  await deleteTokens(instanceId);
  res.json({ connected: false });
});

export default router;
