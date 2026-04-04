import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { PrismaClient } from '@prisma/client';
import { storeTokens, getTokens, deleteTokens, refreshTokens } from '../services/token.service';

const prisma = new PrismaClient();

const INSTANCE_ID = 'test-instance-token-service';

const server = setupServer(
  // Mock HubSpot token refresh endpoint
  http.post('https://api.hubapi.com/oauth/v1/token', () => {
    return HttpResponse.json({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 1800,
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(async () => {
  server.close();
  await prisma.hubSpotToken.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.appInstallation.deleteMany({ where: { instanceId: INSTANCE_ID } });
  await prisma.$disconnect();
});

describe('token.service', () => {
  it('storeTokens saves tokens to the database', async () => {
    await storeTokens(INSTANCE_ID, {
      accessToken: 'access-abc',
      refreshToken: 'refresh-abc',
      expiresAt: new Date(Date.now() + 1800_000),
      portalId: '12345',
      portalName: 'Test Portal',
    });

    const record = await prisma.hubSpotToken.findUnique({ where: { instanceId: INSTANCE_ID } });
    expect(record).not.toBeNull();
    expect(record!.accessToken).toBe('access-abc');
    expect(record!.portalId).toBe('12345');
  });

  it('getTokens retrieves stored tokens', async () => {
    const tokens = await getTokens(INSTANCE_ID);
    expect(tokens).not.toBeNull();
    expect(tokens!.accessToken).toBe('access-abc');
    expect(tokens!.portalName).toBe('Test Portal');
  });

  it('storeTokens upserts — second call updates existing record', async () => {
    await storeTokens(INSTANCE_ID, {
      accessToken: 'access-updated',
      refreshToken: 'refresh-updated',
      expiresAt: new Date(Date.now() + 1800_000),
      portalId: '12345',
      portalName: 'Test Portal',
    });

    const tokens = await getTokens(INSTANCE_ID);
    expect(tokens!.accessToken).toBe('access-updated');
  });

  it('refreshTokens calls HubSpot and stores new tokens', async () => {
    const refreshed = await refreshTokens(INSTANCE_ID);
    expect(refreshed.accessToken).toBe('new-access-token');
    expect(refreshed.refreshToken).toBe('new-refresh-token');

    const stored = await getTokens(INSTANCE_ID);
    expect(stored!.accessToken).toBe('new-access-token');
  });

  it('getTokens returns null when no tokens exist', async () => {
    const tokens = await getTokens('non-existent-instance');
    expect(tokens).toBeNull();
  });

  it('deleteTokens removes tokens from the database', async () => {
    await deleteTokens(INSTANCE_ID);
    const tokens = await getTokens(INSTANCE_ID);
    expect(tokens).toBeNull();
  });
});
