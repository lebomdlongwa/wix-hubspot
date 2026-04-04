import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface HubSpotTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  portalId: string;
  portalName?: string;
}

export async function storeTokens(instanceId: string, tokens: HubSpotTokens): Promise<void> {
  await prisma.hubSpotToken.upsert({
    where: { instanceId },
    update: {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      portalId: tokens.portalId,
      portalName: tokens.portalName,
    },
    create: {
      instanceId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      portalId: tokens.portalId,
      portalName: tokens.portalName,
    },
  });

  // Upsert the AppInstallation record so the rest of the app can reference it
  await prisma.appInstallation.upsert({
    where: { instanceId },
    update: { hubspotPortalId: tokens.portalId, connectedAt: new Date() },
    create: { instanceId, hubspotPortalId: tokens.portalId, connectedAt: new Date() },
  });
}

export async function getTokens(instanceId: string): Promise<HubSpotTokens | null> {
  const record = await prisma.hubSpotToken.findUnique({ where: { instanceId } });
  if (!record) return null;
  return {
    accessToken: record.accessToken,
    refreshToken: record.refreshToken,
    expiresAt: record.expiresAt,
    portalId: record.portalId,
    portalName: record.portalName ?? undefined,
  };
}

export async function deleteTokens(instanceId: string): Promise<void> {
  await prisma.hubSpotToken.deleteMany({ where: { instanceId } });
  await prisma.appInstallation.updateMany({
    where: { instanceId },
    data: { hubspotPortalId: null, connectedAt: null },
  });
}

export async function refreshTokens(instanceId: string): Promise<HubSpotTokens> {
  const existing = await getTokens(instanceId);
  if (!existing) throw new Error(`No tokens found for instanceId: ${instanceId}`);

  const response = await axios.post(
    'https://api.hubapi.com/oauth/v1/token',
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.HUBSPOT_CLIENT_ID!,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
      refresh_token: existing.refreshToken,
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const expiresAt = new Date(Date.now() + response.data.expires_in * 1000);
  const updated: HubSpotTokens = {
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token,
    expiresAt,
    portalId: existing.portalId,
    portalName: existing.portalName,
  };

  await storeTokens(instanceId, updated);
  return updated;
}
