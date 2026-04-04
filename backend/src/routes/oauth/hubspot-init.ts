import { Router, Request, Response } from 'express';

const router = Router();

// GET /oauth/hubspot/init?instanceId=xxx
// Redirects the user to HubSpot's OAuth authorization page
router.get('/', (req: Request, res: Response) => {
  const { instanceId } = req.query;

  if (!instanceId || typeof instanceId !== 'string') {
    res.status(400).json({ error: 'instanceId query parameter is required' });
    return;
  }

  const params = new URLSearchParams({
    client_id: process.env.HUBSPOT_CLIENT_ID!,
    redirect_uri: process.env.HUBSPOT_REDIRECT_URI!,
    scope: 'crm.objects.contacts.read crm.objects.contacts.write crm.schemas.contacts.write oauth',
    state: instanceId,
  });

  res.redirect(`https://app.hubspot.com/oauth/authorize?${params.toString()}`);
});

export default router;
