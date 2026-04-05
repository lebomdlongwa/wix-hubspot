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

// Success page shown after connecting HubSpot
router.get('/success', (_req: Request, res: Response) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HubSpot Connected</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #f5f7ff 0%, #eef2ff 100%);
    }

    .card {
      background: #ffffff;
      border-radius: 20px;
      padding: 56px 48px;
      max-width: 480px;
      width: 90%;
      text-align: center;
      box-shadow: 0 8px 40px rgba(100, 100, 200, 0.12);
    }

    .icon-wrap {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6c63ff, #48b8f0);
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 28px;
      animation: pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }

    @keyframes pop {
      from { transform: scale(0); opacity: 0; }
      to   { transform: scale(1); opacity: 1; }
    }

    .icon-wrap svg {
      width: 40px;
      height: 40px;
      stroke: #fff;
      fill: none;
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
      animation: draw 0.5s ease 0.3s both;
    }

    @keyframes draw {
      from { stroke-dashoffset: 100; opacity: 0; }
      to   { stroke-dashoffset: 0;   opacity: 1; }
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #f0fdf4;
      color: #16a34a;
      font-size: 13px;
      font-weight: 600;
      padding: 4px 12px;
      border-radius: 20px;
      margin-bottom: 20px;
      letter-spacing: 0.3px;
    }

    .badge::before {
      content: '';
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #16a34a;
    }

    h1 {
      font-size: 26px;
      font-weight: 700;
      color: #1a1a2e;
      margin-bottom: 12px;
      line-height: 1.3;
    }

    p {
      font-size: 15px;
      color: #6b7280;
      line-height: 1.6;
      margin-bottom: 32px;
    }

    .logos {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      margin-bottom: 32px;
    }

    .logo-box {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
      color: #fff;
    }

    .logo-wix  { background: #000; letter-spacing: -1px; }
    .logo-hs   { background: #ff7a59; }

    .connector {
      display: flex;
      align-items: center;
      gap: 4px;
      color: #d1d5db;
    }

    .connector span {
      width: 20px;
      height: 2px;
      background: #d1d5db;
      border-radius: 2px;
    }

    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #6c63ff, #48b8f0);
      color: #fff;
      font-size: 15px;
      font-weight: 600;
      padding: 13px 32px;
      border-radius: 12px;
      border: none;
      cursor: pointer;
      text-decoration: none;
      transition: opacity 0.2s, transform 0.1s;
    }

    .btn:hover  { opacity: 0.9; transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }

    .hint {
      margin-top: 16px;
      font-size: 13px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logos">
      <div class="logo-box logo-wix">Wix</div>
      <div class="connector"><span></span>⚡<span></span></div>
      <div class="logo-box logo-hs">HS</div>
    </div>

    <div class="icon-wrap">
      <svg viewBox="0 0 24 24" stroke-dasharray="100">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </div>

    <div class="badge">Connected</div>

    <h1>HubSpot Connected Successfully</h1>
    <p>Your Wix site is now linked to HubSpot. Contacts will sync automatically and form submissions will be captured with full attribution.</p>

    <button class="btn" onclick="window.close()">Close This Tab</button>
    <div class="hint">You can safely close this tab and return to your Wix dashboard.</div>
  </div>
</body>
</html>`);
});

export default router;
