import { get, pick, mapValues } from 'lodash';

export interface UtmParams {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  pageUrl: string | null;
  referrer: string | null;
  submittedAt: string;
}

export interface FormSubmission {
  submissionId: string;
  formId?: string;
  submissions?: Record<string, { value: unknown }>;
  // Wix may also send fields as a flat map
  [key: string]: unknown;
}

const UTM_FIELD_NAMES = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'page_url', 'referrer'];

/**
 * Extracts UTM parameters, page URL, referrer, and timestamp from a Wix form submission.
 * Looks for hidden form fields named utm_source, utm_medium, utm_campaign, utm_term,
 * utm_content, page_url, and referrer.
 */
export function extractUtm(submission: FormSubmission): UtmParams {
  const submissionsMap: Record<string, { value: unknown }> =
    (get(submission, 'submissions') as Record<string, { value: unknown }>) ?? {};

  // Build a flat key→value map from the submissions entries
  const flatValues: Record<string, string | null> = {};
  for (const [key, entry] of Object.entries(submissionsMap)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z_]/g, '_');
    // Handle both {value: ...} and flat string formats
    const value = entry != null && typeof entry === 'object' && 'value' in entry
      ? get(entry, 'value')
      : entry;
    flatValues[normalizedKey] = value != null && value !== '' ? String(value) : null;
  }

  // Also check top-level fields (some Wix webhook formats are flat)
  const topLevel = pick(submission, UTM_FIELD_NAMES);
  const topLevelValues = mapValues(topLevel, (v) =>
    v != null && v !== '' ? String(v) : null
  ) as Record<string, string | null>;

  const merged = { ...flatValues, ...topLevelValues };

  return {
    utmSource: merged['utm_source'] ?? null,
    utmMedium: merged['utm_medium'] ?? null,
    utmCampaign: merged['utm_campaign'] ?? null,
    utmTerm: merged['utm_term'] ?? null,
    utmContent: merged['utm_content'] ?? null,
    pageUrl: merged['page_url'] ?? null,
    referrer: merged['referrer'] ?? null,
    submittedAt: new Date().toISOString(),
  };
}

/**
 * Infers HubSpot's native hs_lead_source enum value from utm_medium.
 * Falls back to 'OTHER' when medium is absent or unrecognised.
 */
export function inferLeadSource(utmMedium: string | null): string {
  if (!utmMedium) return 'OTHER';
  const medium = utmMedium.toLowerCase();
  if (['cpc', 'ppc', 'paid', 'paid_search', 'paidsearch'].some(v => medium.includes(v))) return 'PAID_SEARCH';
  if (['paid_social', 'paid-social', 'paidsocial'].some(v => medium.includes(v))) return 'PAID_SOCIAL';
  if (['email', 'newsletter', 'e-mail'].some(v => medium.includes(v))) return 'EMAIL_MARKETING';
  if (['social', 'instagram', 'facebook', 'twitter', 'linkedin', 'tiktok'].some(v => medium.includes(v))) return 'ORGANIC_SOCIAL';
  if (['referral', 'referrer'].some(v => medium.includes(v))) return 'REFERRALS';
  if (['organic', 'seo'].some(v => medium.includes(v))) return 'ORGANIC_SEARCH';
  return 'OTHER';
}

/**
 * Converts UtmParams to a flat HubSpot properties object.
 * Only includes non-null values.
 * UTM and attribution properties must exist as custom properties in HubSpot
 * (auto-created on OAuth connect via ensureWixSyncSourceProperty).
 */
export function utmToHubSpotProperties(utm: UtmParams): Record<string, string> {
  const props: Record<string, string> = {};
  if (utm.utmSource) props['utm_source'] = utm.utmSource;
  if (utm.utmMedium) props['utm_medium'] = utm.utmMedium;
  if (utm.utmCampaign) props['utm_campaign'] = utm.utmCampaign;
  if (utm.utmTerm) props['utm_term'] = utm.utmTerm;
  if (utm.utmContent) props['utm_content'] = utm.utmContent;
  if (utm.pageUrl) props['hs_analytics_last_url'] = utm.pageUrl;
  if (utm.referrer) props['hs_analytics_last_referrer'] = utm.referrer;
  props['wix_form_submitted_at'] = utm.submittedAt;
  return props;
}
