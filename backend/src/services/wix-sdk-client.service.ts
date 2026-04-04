import { createClient, AppStrategy } from '@wix/sdk';

const publicKey = (process.env.WIX_PUBLIC_KEY ?? '').replace(/\\n/g, '\n');
const appId = process.env.WIX_APP_ID ?? '';

export const wixClient = createClient({
  auth: AppStrategy({ appId, publicKey }),
  modules: {},
});
