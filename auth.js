import { APP_CONFIG, googleRedirectUri, microsoftRedirectUri } from './config.js?v=7';

let microsoftAccess = null;

const base64Url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const randomValue = (length = 32) => base64Url(crypto.getRandomValues(new Uint8Array(length)));

function decodeJwtPayload(token) {
  let encoded = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
  if (!encoded) throw new Error('Invalid Google credential');
  encoded += '='.repeat((4 - encoded.length % 4) % 4);
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded), char => char.charCodeAt(0))));
}

function validateGoogleCredential(credential, expectedNonce = '') {
  const payload = decodeJwtPayload(credential);
  const issuerOk = payload.iss === 'https://accounts.google.com' || payload.iss === 'accounts.google.com';
  if (!issuerOk || payload.aud !== APP_CONFIG.googleClientId || Number(payload.exp) * 1000 <= Date.now() || (expectedNonce && payload.nonce !== expectedNonce)) throw new Error('Google credential validation failed');
  return { sub: payload.sub, email: payload.email, name: payload.name || payload.email, picture: payload.picture || '', expiresAt: Number(payload.exp) * 1000 };
}

function consumeGoogleRedirect() {
  if (!location.hash) return null;
  const result = new URLSearchParams(location.hash.slice(1));
  if (!result.has('id_token') && !result.has('error')) return null;
  const saved = JSON.parse(sessionStorage.getItem('kagicho-google-oauth') || '{}');
  sessionStorage.removeItem('kagicho-google-oauth');
  history.replaceState(null, '', location.pathname + location.search);
  if (!saved.state || result.get('state') !== saved.state || Date.now() - saved.createdAt > 300000) throw new Error('Google OAuth state validation failed');
  if (result.get('error')) throw new Error(result.get('error_description') || result.get('error'));
  return validateGoogleCredential(result.get('id_token'), saved.nonce);
}

function beginGoogleRedirect() {
  const state = randomValue(24);
  const nonce = randomValue(24);
  sessionStorage.setItem('kagicho-google-oauth', JSON.stringify({ state, nonce, createdAt: Date.now() }));
  const params = new URLSearchParams({
    client_id: APP_CONFIG.googleClientId,
    redirect_uri: googleRedirectUri(),
    response_type: 'id_token',
    response_mode: 'fragment',
    scope: 'openid email profile',
    state,
    nonce,
    prompt: 'select_account'
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export const googleConfigured = () => Boolean(APP_CONFIG.googleClientId);
export const microsoftConfigured = () => Boolean(APP_CONFIG.microsoftClientId);

export async function authenticateGoogle(container) {
  if (!googleConfigured()) throw new Error('Google OAuth client ID is not configured');
  const returnedUser = consumeGoogleRedirect();
  if (returnedUser) return returnedUser;
  return new Promise(() => {
    if (!container) throw new Error('Google sign-in container is unavailable');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'google-redirect-button';
    button.textContent = 'G  Googleで続ける';
    button.addEventListener('click', beginGoogleRedirect, { once: true });
    container.replaceChildren(button);
  });
}

async function createPkce() {
  const verifier = randomValue(64);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: base64Url(new Uint8Array(digest)) };
}

async function exchangeMicrosoftCode(code, verifier) {
  const body = new URLSearchParams({ client_id: APP_CONFIG.microsoftClientId, grant_type: 'authorization_code', code, redirect_uri: microsoftRedirectUri(), code_verifier: verifier, scope: APP_CONFIG.microsoftScopes.join(' ') });
  const response = await fetch(`https://login.microsoftonline.com/${APP_CONFIG.microsoftTenant}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error_description || 'Microsoft token exchange failed');
  microsoftAccess = { token: result.access_token, expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 - 60000 };
  return result;
}

export async function authorizeMicrosoft() {
  if (!microsoftConfigured()) throw new Error('Microsoft OAuth client ID is not configured');
  const { verifier, challenge } = await createPkce();
  const state = randomValue(24);
  sessionStorage.setItem('kagicho-ms-oauth', JSON.stringify({ state, verifier, createdAt: Date.now() }));
  const params = new URLSearchParams({ client_id: APP_CONFIG.microsoftClientId, response_type: 'code', redirect_uri: microsoftRedirectUri(), response_mode: 'query', scope: APP_CONFIG.microsoftScopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' });
  const popup = window.open(`https://login.microsoftonline.com/${APP_CONFIG.microsoftTenant}/oauth2/v2.0/authorize?${params}`, 'kagicho-microsoft', 'popup,width=520,height=720');
  if (!popup) throw new Error('Microsoft sign-in popup was blocked');
  return new Promise((resolve, reject) => {
    let receive;
    const timeout = setTimeout(() => finish(new Error('Microsoft sign-in timed out')), 180000);
    const finish = (error, value) => {
      clearTimeout(timeout); window.removeEventListener('message', receive); sessionStorage.removeItem('kagicho-ms-oauth');
      try { popup.close(); } catch {}
      error ? reject(error) : resolve(value);
    };
    receive = async event => {
      if (event.origin !== location.origin || event.data?.type !== 'kagicho-ms-oauth') return;
      const saved = JSON.parse(sessionStorage.getItem('kagicho-ms-oauth') || '{}');
      const callback = new URLSearchParams(event.data.search);
      if (callback.get('state') !== saved.state || Date.now() - saved.createdAt > 180000) return finish(new Error('Microsoft OAuth state validation failed'));
      if (callback.get('error')) return finish(new Error(callback.get('error_description') || callback.get('error')));
      try { finish(null, await exchangeMicrosoftCode(callback.get('code'), saved.verifier)); } catch (error) { finish(error); }
    };
    window.addEventListener('message', receive);
  });
}

export async function getMicrosoftAccessToken(refreshToken) {
  if (microsoftAccess && microsoftAccess.expiresAt > Date.now()) return { accessToken: microsoftAccess.token, refreshToken };
  if (!refreshToken) {
    const result = await authorizeMicrosoft();
    return { accessToken: result.access_token, refreshToken: result.refresh_token || '' };
  }
  const body = new URLSearchParams({ client_id: APP_CONFIG.microsoftClientId, grant_type: 'refresh_token', refresh_token: refreshToken, redirect_uri: microsoftRedirectUri(), scope: APP_CONFIG.microsoftScopes.join(' ') });
  const response = await fetch(`https://login.microsoftonline.com/${APP_CONFIG.microsoftTenant}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error_description || 'Microsoft session expired');
  microsoftAccess = { token: result.access_token, expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 - 60000 };
  return { accessToken: result.access_token, refreshToken: result.refresh_token || refreshToken };
}

export function clearMicrosoftAccessToken() { microsoftAccess = null; }
