/**
 * Microsoft OAuthコールバック。親画面へcodeを返し、opener不通時はlocalStorageへ退避する。
 */
const payload = { type: 'kagicho-ms-oauth', search: window.location.search, createdAt: Date.now() };
try { localStorage.setItem('kagicho-ms-oauth-result', JSON.stringify(payload)); } catch {}
if (window.opener && window.opener !== window) {
  window.opener.postMessage({ type: 'kagicho-ms-oauth', search: window.location.search }, window.location.origin);
  window.close();
} else {
  document.body.textContent = '認証が完了しました。この画面を閉じて、鍵帳へ戻ってください。';
}
