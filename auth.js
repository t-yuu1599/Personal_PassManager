/**
 * 鍵帳のGoogle / Microsoft OAuth処理。
 * GoogleはIdentity Services公式ボタンと、同一タブのOIDCリダイレクトを併用する。
 * MicrosoftはAuthorization Code + PKCE。ポップアップ不通時はlocalStorageでもコールバックを返す。
 * 制限: ID tokenの署名検証は行わない。Vaultの機密性は暗号化と鍵管理が担う。
 */
import { APP_CONFIG, googleRedirectUri, microsoftRedirectUri } from './config.js?v=9';

let googleLibraryPromise;
let googleInitialized = false;
let googlePending;
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

function loadGoogleLibrary() {
  if (globalThis.google?.accounts?.id) return Promise.resolve();
  if (googleLibraryPromise) return googleLibraryPromise;
  googleLibraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Google Identity Services could not be loaded'));
    document.head.append(script);
  });
  return googleLibraryPromise;
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

/**
 * Google公式ボタン失敗時に使う、同一タブのリダイレクト認証ボタンを作る。
 * @returns {HTMLButtonElement}
 */
function createGoogleRedirectButton() {
  const fallbackButton = document.createElement('button');
  fallbackButton.type = 'button';
  fallbackButton.className = 'google-redirect-button';
  fallbackButton.textContent = '別画面でGoogle認証を試す';
  fallbackButton.addEventListener('click', beginGoogleRedirect, { once: true });
  return fallbackButton;
}

function showGoogleButtonHint(message) {
  const authError = document.getElementById('authError');
  if (authError) authError.textContent = message;
}

export const googleConfigured = () => Boolean(APP_CONFIG.googleClientId);
export const microsoftConfigured = () => Boolean(APP_CONFIG.microsoftClientId);

/**
 * Google本人確認を開始する。リダイレクト復帰を優先し、失敗時は同一タブ認証へ倒す。
 * @param {HTMLElement} container ボタンを描画する要素
 * @returns {Promise<{sub:string,email:string,name:string,picture:string,expiresAt:number}>}
 */
export async function authenticateGoogle(container) {
  if (!googleConfigured()) throw new Error('Google OAuth client ID is not configured');
  const returnedUser = consumeGoogleRedirect();
  if (returnedUser) return returnedUser;
  if (!container) throw new Error('Google sign-in container is unavailable');
  if (googlePending) {
    googlePending.reject(new Error('Google sign-in was replaced'));
    googlePending = null;
  }
  try {
    await loadGoogleLibrary();
  } catch (error) {
    return new Promise((resolve, reject) => {
      googlePending = { resolve, reject };
      showGoogleButtonHint('Google公式ボタンを読み込めませんでした。別画面で認証してください。');
      container.replaceChildren(createGoogleRedirectButton());
    });
  }
  return new Promise((resolve, reject) => {
    googlePending = { resolve, reject };
    google.accounts.id.initialize({
      client_id: APP_CONFIG.googleClientId,
      auto_select: false,
      use_fedcm_for_button: true,
      callback: response => {
        try { googlePending?.resolve(validateGoogleCredential(response.credential)); }
        catch (error) { googlePending?.reject(error); }
        finally { googlePending = null; }
      },
      error_callback: () => {
        showGoogleButtonHint('Google公式ボタンを利用できませんでした。別画面で認証してください。');
      }
    });
    googleInitialized = true;
    const officialButton = document.createElement('div');
    google.accounts.id.renderButton(officialButton, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', width: 300 });
    container.replaceChildren(officialButton, createGoogleRedirectButton());
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

/**
 * Microsoftログイン画面を開き、Authorization Codeをアクセストークンへ交換する。
 * @returns {Promise<object>} token endpointのJSON
 */
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
    let onStorage;
    let poll;
    let done = false;
    let consuming = false;
    const timeout = setTimeout(() => finish(new Error('Microsoft sign-in timed out')), 180000);
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      clearInterval(poll);
      window.removeEventListener('message', receive);
      window.removeEventListener('storage', onStorage);
      sessionStorage.removeItem('kagicho-ms-oauth');
      try { localStorage.removeItem('kagicho-ms-oauth-result'); } catch {}
      try { popup.close(); } catch {}
      error ? reject(error) : resolve(value);
    };
    const consume = async data => {
      if (done || consuming || data?.type !== 'kagicho-ms-oauth') return;
      const saved = JSON.parse(sessionStorage.getItem('kagicho-ms-oauth') || '{}');
      const callback = new URLSearchParams(data.search);
      if (callback.get('state') !== saved.state || Date.now() - saved.createdAt > 180000) return finish(new Error('Microsoft OAuth state validation failed'));
      consuming = true;
      if (callback.get('error')) return finish(new Error(callback.get('error_description') || callback.get('error')));
      try { finish(null, await exchangeMicrosoftCode(callback.get('code'), saved.verifier)); } catch (error) { finish(error); }
    };
    receive = event => {
      if (event.origin !== location.origin) return;
      consume(event.data);
    };
    onStorage = event => {
      if (event.key !== 'kagicho-ms-oauth-result' || !event.newValue) return;
      try { consume(JSON.parse(event.newValue)); } catch {}
    };
    poll = setInterval(() => {
      try {
        const raw = localStorage.getItem('kagicho-ms-oauth-result');
        if (!raw) return;
        localStorage.removeItem('kagicho-ms-oauth-result');
        consume(JSON.parse(raw));
      } catch {}
    }, 400);
    window.addEventListener('message', receive);
    window.addEventListener('storage', onStorage);
  });
}

/**
 * Microsoft Graph用アクセストークンを返す。再接続時は必ずログイン画面を出す。
 * @param {string} refreshToken 保存済みrefresh token
 * @param {{interactive?:boolean,forceLogin?:boolean}} [options]
 * @returns {Promise<{accessToken:string,refreshToken:string}>}
 */
export async function getMicrosoftAccessToken(refreshToken, options = {}) {
  const interactive = Boolean(options.interactive);
  const forceLogin = Boolean(options.forceLogin);
  if (forceLogin) clearMicrosoftAccessToken();
  else if (microsoftAccess && microsoftAccess.expiresAt > Date.now()) return { accessToken: microsoftAccess.token, refreshToken };
  if (!forceLogin && refreshToken) {
    const body = new URLSearchParams({ client_id: APP_CONFIG.microsoftClientId, grant_type: 'refresh_token', refresh_token: refreshToken, redirect_uri: microsoftRedirectUri(), scope: APP_CONFIG.microsoftScopes.join(' ') });
    const response = await fetch(`https://login.microsoftonline.com/${APP_CONFIG.microsoftTenant}/oauth2/v2.0/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const result = await response.json();
    if (response.ok) {
      microsoftAccess = { token: result.access_token, expiresAt: Date.now() + Number(result.expires_in || 3600) * 1000 - 60000 };
      return { accessToken: result.access_token, refreshToken: result.refresh_token || refreshToken };
    }
    clearMicrosoftAccessToken();
    if (!interactive) throw new Error(result.error_description || 'Microsoft session expired');
  } else if (!interactive) {
    throw new Error(refreshToken ? 'Microsoft session expired' : 'OneDriveは未接続です');
  }
  const result = await authorizeMicrosoft();
  return { accessToken: result.access_token, refreshToken: result.refresh_token || '' };
}

export function clearMicrosoftAccessToken() { microsoftAccess = null; }
