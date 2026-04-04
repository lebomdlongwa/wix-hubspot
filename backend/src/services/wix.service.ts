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
    console.error('[updateWixContact] error:', JSON.stringify(err?.response?.data ?? err?.message));
    throw err;
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
      properties[mapping.hubspotProperty] = value;
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
      fields[mapping.wixField] = String(value);
    }
  });

  return fields;
}
