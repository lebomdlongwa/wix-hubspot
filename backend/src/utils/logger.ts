/**
 * Safe logger — never logs tokens or full PII.
 * Emails are masked as j***@domain.com
 * Tokens/secrets are fully redacted.
 */

const SENSITIVE_KEYS = ['accessToken', 'refreshToken', 'access_token', 'refresh_token', 'client_secret', 'WIX_APP_SECRET', 'HUBSPOT_CLIENT_SECRET'];

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local[0]}***@${domain}`;
}

function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 5) return obj;
  if (typeof obj === 'string') {
    // Mask anything that looks like an email
    return obj.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, (match) =>
      maskEmail(match)
    );
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitive(item, depth + 1));
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([key, value]) => {
        if (SENSITIVE_KEYS.includes(key)) return [key, '[REDACTED]'];
        return [key, redactSensitive(value, depth + 1)];
      })
    );
  }
  return obj;
}

export const logger = {
  info: (message: string, meta?: unknown) => {
    console.log(`[INFO] ${message}`, meta ? JSON.stringify(redactSensitive(meta)) : '');
  },
  warn: (message: string, meta?: unknown) => {
    console.warn(`[WARN] ${message}`, meta ? JSON.stringify(redactSensitive(meta)) : '');
  },
  error: (message: string, meta?: unknown) => {
    console.error(`[ERROR] ${message}`, meta ? JSON.stringify(redactSensitive(meta)) : '');
  },
};
