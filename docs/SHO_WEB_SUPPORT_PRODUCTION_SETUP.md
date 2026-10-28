# SHO WEB SUPPORT 本番化セットアップ

この文書は公開用の秘密情報を含めない。秘密鍵・トークンはGitHubへコミットせず、Supabase Edge FunctionsのSecretsへ設定する。

## 1. Supabase

適用するMigration:

```
supabase/migrations/20261028_website_support_core.sql
```

作成される主なデータ:
- website_sites: SITE ID・状態・GitHub公開設定
- website_site_users: 1つのSITE IDを複数ユーザーで共有
- website_intakes: ヒアリング下書き・最終送信
- website_activity: 要望・承認・LINE履歴
- website_jobs: AI制作キュー
- website_line_links: LINEユーザーとSITE IDの紐付け
- website_settings: SHO通知先等のprivate設定
- Storage bucket website-intake-files: 写真等のprivate保存

管理者のSupabase AuthユーザーIDを website_admins に1件登録する。

## 2. Edge Functions

Deploy:
- website-api
- website-line-webhook

website-api はログインJWTをコード内でも確認する。
website-line-webhook はLINE署名を検証するため、LINEから直接POSTできる設定にする。

## 3. Supabase Secrets

必須:
- LINE_CHANNEL_ACCESS_TOKEN
- LINE_CHANNEL_SECRET
- LINE_ADMIN_LINK_CODE
- GITHUB_PAGES_TOKEN

任意:
- LINE_OWNER_USER_ID
  - 未設定でも、LINE_ADMIN_LINK_CODEを使った一度きりの登録でwebsite_settingsに保存可能。

Supabaseが自動提供:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY

GITHUB_PAGES_TOKENは最小権限を優先する。
現在の自動公開に必要:
- Pages: write
- Administration: write

将来、顧客Repoの自動作成・AIによるファイル更新まで行う場合:
- Repository creation: write
- Contents: read/write
も必要になる。

## 4. LINE Messaging API

LINE DevelopersでSHO WEB SUPPORT公式アカウントのMessaging APIを有効化。

Webhook URL:
```
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/website-line-webhook
```

Webhookを有効化し、検証する。

SHOの個人LINEを自動通知先へ登録する方法:
1. Supabase SecretにLINE_ADMIN_LINK_CODEを設定
2. SHO個人LINEからSHO WEB SUPPORT公式LINEへ次を送信
```
SHO ADMIN LINK <設定したコード>
```
3. 「自動通知先として登録しました」と返信されれば完了

顧客はサイト内の「LINEで相談」ボタンを押す。
初回メッセージにSITE IDが入るため、Webhookがwebsite_line_linksへ自動紐付けする。

## 5. Authentication

Customer URL:
- website-login.html
- website-portal.html

Supabase AuthのRedirect URLsへ少なくとも以下を追加:
```
https://sho-support.github.io/website-portal.html
https://sho-support.github.io/website-intake.html
https://sho-support.github.io/website-customer-review.html
https://sho-support.github.io/admin/
```

一般顧客へMagic Linkメールを送るため、Custom SMTPを本番設定する。

## 6. 本番URLモード

現在は既存デモを壊さないように分離している。

本番顧客:
```
website-intake.html?id=1042&prod=1
website-customer-review.html?id=1042&prod=1
```

本番SHO管理:
```
admin/?prod=1
```

Supabase接続・Migration・Functions deploy・管理者登録が完了したら、最終的に通常URLを本番モードへ切り替える。

## 7. GitHub Pages 公開 / 一時非公開

website_sites:
- repo_full_name: 例 sho-support/customer-site-1042
- publish_branch: main
- live_path: /
- offline_path: /docs

各顧客Repoの /docs/index.html へ、このリポジトリの
```
templates/customer-site/docs/index.html
```
を配置する。

公開中:
- GitHub Pages source = main /

一時非公開 / 改良中:
- GitHub Pages source = main /docs

この切替はwebsite-apiからGitHub Pages REST APIを呼んで行う。

## 8. 独自ドメイン

料金表示:
- 設定代行 ¥5,000〜
- ドメイン取得・更新費用は実費

原則:
- ドメインは顧客名義
- DNSは契約しているドメイン会社側で設定
- SHO側は取得案内・DNS設定補助・GitHub Pages設定・HTTPS確認を担当
- 既存ドメイン移管や特殊DNSは追加見積り可

管理画面の「公開設定」からGitHub Pages側のcustom domainを設定可能。
DNS反映と証明書発行には時間がかかる場合があるため、即時完了を保証しない。

## 9. AI自動制作

ヒアリング送信時:
- website_sites.status -> building
- website_jobs -> initial_create / queued

顧客修正時:
- website_jobs -> customer_revision / queued

SHO修正時:
- website_jobs -> sho_revision / queued

次工程はwebsite_jobsのqueuedを処理するAI worker:
1. SITE IDのintake/activity/profileを読む
2. 顧客Repo最新版を読む
3. 作成・修正
4. preview URL更新
5. website_jobsをsho_reviewへ
6. website_sitesをsho_reviewへ
7. SHOへLINE通知

OpenAI API / GitHub書込権限を接続してからworkerを有効化する。
