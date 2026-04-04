import { Router, Request, Response } from 'express';
import axios from 'axios';
import pLimit from 'p-limit';
import { getTokens } from '../../services/token.service';
import { syncWixContactToHubSpot } from '../../services/sync.service';
import { WixContact } from '../../services/wix.service';

const router = Router();

const CONCURRENCY = 5; // Max parallel HubSpot calls (stays under 110 req/10s limit)
const PAGE_SIZE = 100;

// POST /api/sync/:instanceId
// Fetches all Wix contacts and syncs each to HubSpot with concurrency limiting
router.post('/:instanceId', async (req: Request, res: Response) => {
  const { instanceId } = req.params;

  const tokens = await getTokens(instanceId);
  if (!tokens) {
    res.status(401).json({ error: 'HubSpot not connected for this instance' });
    return;
  }

  const limit = pLimit(CONCURRENCY);
  let cursor: string | undefined;
  let totalSynced = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  try {
    do {
      // Paginate Wix contacts
      const params: Record<string, string | number> = { limit: PAGE_SIZE };
      if (cursor) params.cursor = cursor;
      const response = await axios.get(
        'https://www.wixapis.com/contacts/v4/contacts',
        {
          params,
          headers: {
            Authorization: process.env.WIX_API_KEY!,
            'wix-site-id': process.env.WIX_SITE_ID,
          },
        }
      );

      // Normalize Wix API format: emails.items[] → emails[], phones.items[] → phones[]
      const contacts: WixContact[] = (response.data.contacts ?? []).map((c: any) => ({
        ...c,
        info: c.info ? {
          ...c.info,
          emails: (c.info.emails?.items ?? []).map((e: any) => ({ email: e.email, tag: e.tag })),
          phones: (c.info.phones?.items ?? []).map((p: any) => ({ phone: p.phone, tag: p.tag })),
          addresses: (c.info.addresses?.items ?? []).map((a: any) => a),
        } : {},
      }));
      cursor = response.data.pagingMetadata?.hasNext ? response.data.pagingMetadata?.cursor : undefined;

      // Sync all contacts in this page concurrently (capped at CONCURRENCY)
      await Promise.all(
        contacts.map((contact) =>
          limit(async () => {
            try {
              await syncWixContactToHubSpot(instanceId, contact);
              totalSynced++;
            } catch {
              totalErrors++;
            }
          })
        )
      );
    } while (cursor);

    res.json({ status: 'ok', totalSynced, totalSkipped, totalErrors });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Manual sync failed';
    const axiosErr = err as any;
    if (axiosErr?.response?.data) {
      console.error('[ManualSync] error response:', JSON.stringify(axiosErr.response.data));
    } else {
      console.error('[ManualSync] error:', message);
    }
    res.status(500).json({ error: message });
  }
});

export default router;
