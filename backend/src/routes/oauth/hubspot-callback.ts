import { Router, Request, Response } from 'express';
import axios from 'axios';
import { storeTokens } from '../../services/token.service';
import { ensureWixSyncSourceProperty } from '../../services/hubspot.service';

const router = Router();

// GET /oauth/hubspot/callback?code=xxx&state=instanceId
// Exchanges the authorization code for tokens and stores them
router.get('/', async (req: Request, res: Response) => {
  const { code, state: instanceId } = req.query;

  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'Missing authorization code' });
    return;
  }

  if (!instanceId || typeof instanceId !== 'string') {
    res.status(400).json({ error: 'Missing instanceId in state parameter' });
    return;
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post(
      'https://api.hubapi.com/oauth/v1/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.HUBSPOT_CLIENT_ID!,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
        redirect_uri: process.env.HUBSPOT_REDIRECT_URI!,
        code,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const { access_token, refresh_token, expires_in } = tokenResponse.data;
    const expiresAt = new Date(Date.now() + expires_in * 1000);

    // Get portal info from the access token
    const tokenInfoResponse = await axios.get(
      `https://api.hubapi.com/oauth/v1/access-tokens/${access_token}`
    );
    const { hub_id: portalId, hub_domain: portalName } = tokenInfoResponse.data;

    await storeTokens(instanceId, {
      accessToken: access_token,
      refreshToken: refresh_token,
      expiresAt,
      portalId: String(portalId),
      portalName,
    });

    // Ensure the wix_sync_source custom property exists in HubSpot
    await ensureWixSyncSourceProperty(instanceId);

    // Redirect back to the Wix dashboard after successful connection
    res.redirect(`/oauth/hubspot/callback/success?instanceId=${instanceId}`);
  } catch (err: unknown) {
    const message = axios.isAxiosError(err)
      ? err.response?.data?.message ?? err.message
      : 'OAuth exchange failed';
    res.status(400).json({ error: message });
  }
});

// Simple success page shown after connecting HubSpot
router.get('/success', (_req: Request, res: Response) => {
  res.send('<h2>HubSpot connected successfully. You can close this tab.</h2>');
});

export default router;
