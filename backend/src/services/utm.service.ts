import { get, pick, mapValues } from 'lodash';

export interface UtmParams {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
}

export interface FormSubmission {
  submissionId: string;
  formId?: string;
  submissions?: Record<string, { value: unknown }>;
  // Wix may also send fields as a flat map
  [key: string]: unknown;
}

const UTM_FIELD_NAMES = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

/**
 * Extracts UTM parameters from a Wix form submission.
 * Looks for hidden form fields named utm_source, utm_medium, utm_campaign, utm_term, utm_content.
 * These are populated by a Wix page code snippet that reads URL search params on page load.
 */
export function extractUtm(submission: FormSubmission): UtmParams {
  // Wix form submissions store field values in a submissions map: { fieldId: { value: ... } }
  // Site owners name their hidden fields utm_source etc., so we look up by field name/key
  const submissionsMap: Record<string, { value: unknown }> =
    (get(submission, 'submissions') as Record<string, { value: unknown }>) ?? {};

  // Build a flat key→value map from the submissions entries
  const flatValues: Record<string, string | null> = {};
  for (const [key, entry] of Object.entries(submissionsMap)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z_]/g, '_');
    const value = get(entry, 'value');
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
  };
}

/**
 * Converts UtmParams to a flat HubSpot properties object.
 * Only includes non-null values.
 */
export function utmToHubSpotProperties(utm: UtmParams): Record<string, string> {
  const props: Record<string, string> = {};
  if (utm.utmSource) props['utm_source'] = utm.utmSource;
  if (utm.utmMedium) props['utm_medium'] = utm.utmMedium;
  if (utm.utmCampaign) props['utm_campaign'] = utm.utmCampaign;
  if (utm.utmTerm) props['utm_term'] = utm.utmTerm;
  if (utm.utmContent) props['utm_content'] = utm.utmContent;
  return props;
}
