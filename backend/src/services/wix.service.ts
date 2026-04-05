import axios from 'axios';
import { get, set, filter } from 'lodash';
import { FieldMapping } from '@prisma/client';

export interface WixContact {
  id: string;
  info: {
    name?: { first?: string; last?: string };
    emails?: Array<{ email: string }>;
    phones?: Array<{ phone: string }>;
    addresses?: Array<{
      city?: string;
      country?: string;
      subdivision?: string;
      postalCode?: string;
    }>;
    company?: { name?: string };
    jobTitle?: string;
  };
}

function createWixClient() {
  return axios.create({
    baseURL: 'https://www.wixapis.com',
    headers: {
      Authorization: process.env.WIX_API_KEY!,
      'wix-site-id': process.env.WIX_SITE_ID,
    },
  });
}

export async function getWixContact(contactId: string): Promise<WixContact> {
  const client = createWixClient();
  const response = await client.get(`/contacts/v4/contacts/${contactId}`);
  return response.data.contact;
}

export async function createWixContact(
  fields: Record<string, string>
): Promise<string> {
  const client = createWixClient();

  // Build structured info directly from known field keys
  const info: Record<string, any> = {};

  const firstName = fields['info.name.first'];
  const lastName = fields['info.name.last'];
  const email = fields['info.emails[0].email'];
  const phone = fields['info.phones[0].phone'];
  const city = fields['info.addresses[0].city'];
  const country = fields['info.addresses[0].country'];
  const postalCode = fields['info.addresses[0].postalCode'];
  const companyName = fields['info.company.name'];
  const jobTitle = fields['info.jobTitle'];

  if (firstName || lastName) info.name = { first: firstName, last: lastName };
  if (email) info.emails = { items: [{ email, tag: 'UNTAGGED' }] };
  if (phone) info.phones = { items: [{ phone, tag: 'UNTAGGED' }] };
  if (city || country || postalCode) info.addresses = { items: [{ city, country, postalCode }] };
  if (companyName) info.company = { name: companyName };
  if (jobTitle) info.jobTitle = jobTitle;

  try {
    const response = await client.post('/contacts/v4/contacts', { info });
    return response.data?.contact?.id;
  } catch (err: any) {
    console.error('[createWixContact] error:', err?.response?.data ? JSON.stringify(err.response.data) : err?.message);
    throw err;
  }
}

export async function updateWixContact(
  contactId: string,
  fields: Record<string, string>
): Promise<void> {
  const client = createWixClient();

  // Wix v4 PATCH requires the current revision
  const getResponse = await client.get(`/contacts/v4/contacts/${contactId}`);
  const revision = getResponse.data?.contact?.revision;

  // Build nested info object from flat fields map using lodash set
  const info = {};
  Object.entries(fields).forEach(([key, value]) => {
    // Strip leading 'info.' so we set relative to info root
    const relativePath = key.startsWith('info.') ? key.slice(5) : key;
    set(info, relativePath, value);
  });
  try {
    await client.patch(`/contacts/v4/contacts/${contactId}`, { revision, info });
  } catch (err: any) {
    // Retry once with fresh revision on conflict
    if (err?.response?.status === 409) {
      const retryGet = await client.get(`/contacts/v4/contacts/${contactId}`);
      const freshRevision = retryGet.data?.contact?.revision;
      await client.patch(`/contacts/v4/contacts/${contactId}`, { revision: freshRevision, info });
      return;
    }
    console.error('[updateWixContact] error:', err?.response?.data ? JSON.stringify(err.response.data) : err?.message);
    throw err;
  }
}

/**
 * Applies a named transform to a string value before syncing.
 */
export function applyTransform(value: string, transform: string | null | undefined): string {
  switch (transform) {
    case 'trim': return value.trim();
    case 'lowercase': return value.toLowerCase();
    case 'uppercase': return value.toUpperCase();
    default: return value;
  }
}

/**
 * Reads a value from a WixContact using a dot-notation field key.
 * Uses lodash get for safe nested access including array indexes.
 * e.g. 'info.emails[0].email' → contact.info.emails[0].email
 */
export function extractWixField(contact: WixContact, fieldKey: string): string | undefined {
  const value = get(contact, fieldKey);
  return value != null ? String(value) : undefined;
}

/**
 * Builds a HubSpot properties object from a Wix contact using the saved field mappings.
 * Uses lodash filter to select only WIX_TO_HS and BOTH direction mappings.
 */
export function applyWixToHubSpotMappings(
  contact: WixContact,
  mappings: FieldMapping[]
): Record<string, string> {
  const applicable = filter(mappings, (m) => m.direction === 'WIX_TO_HS' || m.direction === 'BOTH');

  const properties: Record<string, string> = {};
  applicable.forEach((mapping) => {
    const value = extractWixField(contact, mapping.wixField);
    if (value !== undefined) {
      properties[mapping.hubspotProperty] = applyTransform(value, mapping.transform);
    }
  });

  return properties;
}

/**
 * Builds a Wix info patch object from HubSpot contact properties using the saved field mappings.
 * Uses lodash filter to select only HS_TO_WIX and BOTH direction mappings.
 */
export function applyHubSpotToWixMappings(
  hsProperties: Record<string, string>,
  mappings: FieldMapping[]
): Record<string, string> {
  const applicable = filter(mappings, (m) => m.direction === 'HS_TO_WIX' || m.direction === 'BOTH');

  const fields: Record<string, string> = {};
  applicable.forEach((mapping) => {
    const value = get(hsProperties, mapping.hubspotProperty);
    if (value != null) {
      fields[mapping.wixField] = applyTransform(String(value), mapping.transform);
    }
  });

  return fields;
}
