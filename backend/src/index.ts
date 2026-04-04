import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import hubspotInitRouter from './routes/oauth/hubspot-init';
import hubspotCallbackRouter from './routes/oauth/hubspot-callback';
import oauthStatusRouter from './routes/oauth/oauth-status';
import getMappingsRouter from './routes/mappings/get-mappings';
import saveMappingsRouter from './routes/mappings/save-mappings';
import wixContactsWebhookRouter from './routes/webhooks/wix-contacts';
import hubspotContactsWebhookRouter from './routes/webhooks/hubspot-contacts';
import wixFormsWebhookRouter from './routes/webhooks/wix-forms';
import manualSyncRouter from './routes/sync/manual-sync';
import syncLogRouter from './routes/sync/sync-log';

const app = express();

app.use(cors());
app.use(express.json({
  verify: (req: any, _res, buf) => {
    req.rawBody = buf.toString('utf8');
  },
}));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// OAuth routes
app.use('/oauth/hubspot/init', hubspotInitRouter);
app.use('/oauth/hubspot/callback', hubspotCallbackRouter);

// API routes
app.use('/api/oauth/status', oauthStatusRouter);
app.use('/api/mappings', getMappingsRouter);
app.use('/api/mappings', saveMappingsRouter);
app.use('/webhooks/wix/contacts', wixContactsWebhookRouter);
app.use('/webhooks/hubspot/contacts', hubspotContactsWebhookRouter);
app.use('/webhooks/wix/forms', wixFormsWebhookRouter);
app.use('/api/sync', manualSyncRouter);
app.use('/api/sync-log', syncLogRouter);

export default app;
