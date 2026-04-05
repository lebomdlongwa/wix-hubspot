import { describe, it, expect } from 'vitest';
import { extractUtm, utmToHubSpotProperties, FormSubmission } from '../services/utm.service';

function makeSubmission(fields: Record<string, string | null>): FormSubmission {
  return {
    submissionId: 'sub-001',
    submissions: Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [key, { value }])
    ),
  };
}

describe('extractUtm', () => {
  it('extracts all 5 UTM params from submission fields', () => {
    const submission = makeSubmission({
      utm_source: 'facebook',
      utm_medium: 'ad',
      utm_campaign: 'summer_sale',
      utm_term: 'running+shoes',
      utm_content: 'banner_top',
    });

    const utm = extractUtm(submission);
    expect(utm.utmSource).toBe('facebook');
    expect(utm.utmMedium).toBe('ad');
    expect(utm.utmCampaign).toBe('summer_sale');
    expect(utm.utmTerm).toBe('running+shoes');
    expect(utm.utmContent).toBe('banner_top');
  });

  it('missing UTM params default to null', () => {
    const submission = makeSubmission({ utm_source: 'google' });
    const utm = extractUtm(submission);
    expect(utm.utmSource).toBe('google');
    expect(utm.utmMedium).toBeNull();
    expect(utm.utmCampaign).toBeNull();
    expect(utm.utmTerm).toBeNull();
    expect(utm.utmContent).toBeNull();
  });

  it('empty string values are treated as null', () => {
    const submission = makeSubmission({ utm_source: '', utm_medium: 'email' });
    const utm = extractUtm(submission);
    expect(utm.utmSource).toBeNull();
    expect(utm.utmMedium).toBe('email');
  });

  it('no UTM fields → all null', () => {
    const submission = makeSubmission({ email: 'test@example.com' });
    const utm = extractUtm(submission);
    expect(utm.utmSource).toBeNull();
    expect(utm.utmMedium).toBeNull();
    expect(utm.utmCampaign).toBeNull();
    expect(utm.utmTerm).toBeNull();
    expect(utm.utmContent).toBeNull();
  });

  it('also picks up UTM params from top-level fields', () => {
    const submission: FormSubmission = {
      submissionId: 'sub-002',
      utm_source: 'newsletter',
      utm_medium: 'email',
    };
    const utm = extractUtm(submission);
    expect(utm.utmSource).toBe('newsletter');
    expect(utm.utmMedium).toBe('email');
  });
});

describe('utmToHubSpotProperties', () => {
  it('converts UTM params to HubSpot properties, skipping nulls', () => {
    const props = utmToHubSpotProperties({
      utmSource: 'facebook',
      utmMedium: null,
      utmCampaign: 'launch',
      utmTerm: null,
      utmContent: null,
      pageUrl: null,
      referrer: null,
      submittedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(props).toEqual({ utm_source: 'facebook', utm_campaign: 'launch', wix_form_submitted_at: '2026-01-01T00:00:00.000Z' });
  });

  it('returns only timestamp when all UTM params are null', () => {
    const props = utmToHubSpotProperties({
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmTerm: null,
      utmContent: null,
      pageUrl: null,
      referrer: null,
      submittedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(props).toEqual({ wix_form_submitted_at: '2026-01-01T00:00:00.000Z' });
  });
});
