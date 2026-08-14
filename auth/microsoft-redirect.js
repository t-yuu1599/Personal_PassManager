if (window.opener && window.opener !== window) {
  window.opener.postMessage({ type: 'kagicho-ms-oauth', search: window.location.search }, window.location.origin);
  window.close();
} else {
  document.body.textContent = '認証元の画面へ戻って、もう一度接続してください。';
}
