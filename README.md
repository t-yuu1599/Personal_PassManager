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
- Google Identity Servicesによる起動時本人確認
- Microsoft OAuth 2.0 Authorization Code + PKCE
- Microsoft Graph App Folderへの暗号化同期とrevision競合検出

Google OAuthとOneDrive同期は実装済みですが、各サービスのクライアントIDを設定するまでUI上では無効になります。WebAuthn PRFによる新端末へのVault鍵引き継ぎは未実装です。

## 公開先

- GitHub: https://github.com/applegrimm/Personal_PassManager
- PWA: https://applegrimm.github.io/Personal_PassManager/

GitHub Pagesへ公開されるのはアプリ本体だけです。パスワード、Vault鍵、OAuthトークンはリポジトリへ保存しません。

## OAuth設定

`config.js`へ公開識別子であるクライアントIDだけを設定します。クライアントシークレットは作成・保存しません。

### Google

Webアプリケーションの承認済みJavaScript生成元：

```text
http://localhost:4173
http://127.0.0.1:4173
https://applegrimm.github.io
```

取得した値を`config.js`の`googleClientId`へ設定します。

### Microsoft Entra

プラットフォームは「シングルページ アプリケーション」、委任されたMicrosoft Graph権限は`Files.ReadWrite.AppFolder`だけを追加します。

リダイレクトURI：

```text
http://localhost:4173/auth/microsoft-redirect.html
https://applegrimm.github.io/Personal_PassManager/auth/microsoft-redirect.html
```

MicrosoftはHTTPのリダイレクトURIを`localhost`だけ許可するため、ローカル確認では`127.0.0.1`ではなく`localhost`を使用します。

取得したApplication (client) IDを`config.js`の`microsoftClientId`へ設定します。認証はAuthorization Code Flow + PKCEを使用します。

## OneDrive同期

接続後はMicrosoft Graphのアプリ専用領域へ次のファイルだけを保存します。

```text
Apps/<Entraアプリ名>/vault.enc
Apps/<Entraアプリ名>/wrapped-key.bin
```

`vault.enc`はAES-GCM暗号化済みです。`wrapped-key.bin`は端末固有の非抽出CryptoKeyでラップしたVault鍵です。現段階の鍵ラップは同じブラウザプロファイルへの復元用であり、新端末への鍵引き継ぎにはWebAuthn PRFまたは既存端末承認フローの追加が必要です。
