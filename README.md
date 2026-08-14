# 鍵帳

ローカル優先の個人用パスワード管理 PWA です。データは IndexedDB 内で AES-GCM 暗号化され、Vault 鍵は端末固有の非抽出 CryptoKey でラップされます。

## 起動

Service Worker と Web Crypto のため、`file://` ではなく localhost または HTTPS で配信してください。

```powershell
python -m http.server 4173
```

その後 `http://localhost:4173` を開きます。

## 実装済み

- オフライン PWA / IndexedDB
- 登録・編集・削除・お気に入り・使用回数
- 日本語正規化、読み、カテゴリ、タグ、曖昧検索
- ルールベースの自動分類とパスワード生成
- AES-GCM 暗号化保存、メモリ上の Vault 鍵、自動ロック
- 端末鍵で暗号化したバックアップの書き出し・復元

Google OAuth、WebAuthn PRF、Microsoft Graph / OneDrive 同期は、各サービスのクライアントID・リダイレクトURIと実機検証が必要なため未接続です。
