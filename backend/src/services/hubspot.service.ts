import axios, { AxiosInstance } from 'axios';
import { getTokens, refreshTokens } from './token.service';

// Standard Wix contact fields available for mapping
export const WIX_CONTACT_FIELDS = [
  { key: 'info.name.first', label: 'First Name' },
  { key: 'info.name.last', label: 'Last Name' },
  { key: 'info.emails[0].email', label: 'Email' },
  { key: 'info.phones[0].phone', label: 'Phone' },
  { key: 'info.addresses[0].city', label: 'City' },
  { key: 'info.addresses[0].country', label: 'Country' },
  { key: 'info.addresses[0].subdivision', label: 'State / Region' },
  { key: 'info.addresses[0].postalCode', label: 'Postal Code' },
  { key: 'info.company.name', label: 'Company Name' },
  { key: 'info.jobTitle', label: 'Job Title' },
];

export interface HubSpotProperty {
  name: string;
  label: string;
  type: string;
}

function createHubSpotClient(accessToken: string): AxiosInstance {
  return axios.create({
    baseURL: 'https://api.hubapi.com',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// Creates an axios client that auto-refreshes the token on 401
export function createAuthenticatedClient(instanceId: string): AxiosInstance {
  const client = axios.create({ baseURL: 'https://api.hubapi.com' });

  client.interceptors.request.use(async (config) => {
    const tokens = await getTokens(instanceId);
    if (!tokens) throw new Error(`No HubSpot tokens for instanceId: ${instanceId}`);
    config.headers.Authorization = `Bearer ${tokens.accessToken}`;
    return config;
  });

  client.interceptors.response.use(
    (res) => res,
    async (error) => {
      if (error.response?.status === 401 && !error.config._retried) {
        error.config._retried = true;
        const refreshed = await refreshTokens(instanceId);
        error.config.headers.Authorization = `Bearer ${refreshed.accessToken}`;
        return client(error.config);
      }
      return Promise.reject(error);
    }
  );

  return client;
}

async function ensureProperty(client: ReturnType<typeof createAuthenticatedClient>, name: string, label: string): Promise<void> {
  try {
    await client.get(`/crm/v3/properties/contacts/${name}`);
  } catch (err: any) {
    if (err.response?.status === 404) {
      await client.post('/crm/v3/properties/contacts', {
        name,
        label,
        type: 'string',
        fieldType: 'text',
        groupName: 'contactinformation',
      });
    }
  }
}

export async function ensureWixSyncSourceProperty(instanceId: string): Promise<void> {
  const client = createAuthenticatedClient(instanceId);
  await ensureProperty(client, 'wix_sync_source', 'Wix Sync Source');
  await ensureProperty(client, 'utm_source', 'UTM Source');
  await ensureProperty(client, 'utm_medium', 'UTM Medium');
  await ensureProperty(client, 'utm_campaign', 'UTM Campaign');
  await ensureProperty(client, 'utm_term', 'UTM Term');
  await ensureProperty(client, 'utm_content', 'UTM Content');
  await ensureProperty(client, 'wix_form_submitted_at', 'Wix Form Submitted At');
}

export async function getHubSpotProperties(instanceId: string): Promise<HubSpotProperty[]> {
  const client = createAuthenticatedClient(instanceId);
  const response = await client.get('/crm/v3/properties/contacts');
  return response.data.results.map((p: { name: string; label: string; type: string }) => ({
    name: p.name,
    label: p.label,
    type: p.type,
  }));
}

export async function createOrUpdateContact(
  accessToken: string,
  properties: Record<string, string>
): Promise<string> {
  const client = createHubSpotClient(accessToken);
  const response = await client.post('/crm/v3/objects/contacts', { properties });
  return response.data.id;
}

export async function updateContact(
  accessToken: string,
  hubspotContactId: string,
  properties: Record<string, string>
): Promise<void> {
  const client = createHubSpotClient(accessToken);
  await client.patch(`/crm/v3/objects/contacts/${hubspotContactId}`, { properties });
}

export async function upsertContactByEmail(
  accessToken: string,
  properties: Record<string, string>
): Promise<string> {
  const client = createHubSpotClient(accessToken);
  const response = await client.post(
    '/crm/v3/objects/contacts',
    { properties },
    { params: { idProperty: 'email' } }
  );
  return response.data.id;
}
