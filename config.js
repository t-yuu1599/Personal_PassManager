// OAuth client IDs are public identifiers. Never add client secrets, tokens, or Vault data here.
export const APP_CONFIG = Object.freeze({
  googleClientId: '417137420688-r2q6slhf5oi6sl29l39odkbopgtrsfcv.apps.googleusercontent.com',
  microsoftClientId: '7ebfd83f-0a6f-454c-bd85-efd257564132',
  microsoftTenant: 'common',
  microsoftScopes: ['openid', 'profile', 'offline_access', 'Files.ReadWrite.AppFolder'],
  productionOrigin: 'https://applegrimm.github.io',
  productionBasePath: '/Personal_PassManager/'
});

export function microsoftRedirectUri() {
  return new URL('./auth/microsoft-redirect.html', document.baseURI).href;
}

export function googleRedirectUri() {
  return new URL('./', document.baseURI).href.split('#')[0];
}
