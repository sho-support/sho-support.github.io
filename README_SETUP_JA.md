# Guns N' Loses 応援者ページ — GitHub Pages + Supabase 完成版

このフォルダは、Vercelを使わずに次の構成で動かす最終ファイルです。

- GitHub Pages：公式サイト、ログイン画面、BACKSTAGE ROOM
- Supabase Auth：メールのマジックリンクログイン
- Supabase Edge Functions：支援者判定、限定動画取得、Stripe Webhook
- Stripe：月額決済と契約状態通知

## 1. GitHubへアップロードするファイル

リポジトリの一番上へ、以下を同名上書きでアップロードします。

```text
support.html
support-us.html
member-config.js
member-login.html
member-login.js
members.html
members.js
member.css
```

`member-config.js`にはブラウザ公開用のSupabase Publishable keyだけが入っています。Stripeの秘密鍵、Webhook secret、Supabase Secret keyは入っていません。

以前アップロードしたVercel用の`api/`、`public/`、`data/`、`vercel.json`、`package.json`は、今回のページから参照されません。残っていても新しいページの動作には影響しませんが、後で整理する場合は削除できます。

## 2. 今回の修正

- `support-us.html`の応援者ログイン先をVercelから`member-login.html`へ変更
- ログイン画面とBACKSTAGE ROOMをGitHub Pagesのルートへ配置
- ブラウザからSupabase Edge Functionsを直接呼び出す構成へ変更
- 限定動画が未登録の場合は`COMING SOON`を表示
- microSD参考価格を次へ修正
  - 32GB：約4,000円
  - 64GB：約5,600円
  - 128GB：約6,300円
  - 256GB：約9,400円

参考価格は、信頼できるUHS-I・U3・V30以上のカードをこちらで用意する場合の目安です。購入商品・在庫・価格改定により最終金額は変動します。

## 3. Supabase Authentication URL設定

Supabase Dashboardで次へ進みます。

```text
Authentication
→ URL Configuration
```

設定値：

```text
Site URL
https://sho-support.github.io/

Redirect URLs
https://sho-support.github.io/members.html
```

保存します。`member-login.js`の`emailRedirectTo`も同じ`members.html`を使用します。

## 4. メール送信設定

Supabase標準SMTPは、本番の一般ユーザー向け送信には使えません。標準SMTPではプロジェクトチームに登録したメールアドレス以外への送信が拒否されます。

一般の応援者へログインメールを送るには、次へ進んでCustom SMTPを設定します。

```text
Authentication
→ Email
→ SMTP Settings / Custom SMTP
```

利用候補：Resend、Brevo、SendGrid、Postmarkなど。SMTPホスト、ポート、ユーザー名、パスワード、送信元メールアドレスが必要です。

## 5. Edge Functionsの最終状態

```text
stripe-webhook  ：Verify JWT OFF
member-status   ：Verify JWT ON
member-videos   ：Verify JWT ON
```

現在の関数コードは次の認証方式です。

- `stripe-webhook`：Stripe署名で認証
- `member-status`：SupabaseログインユーザーJWTで認証
- `member-videos`：SupabaseログインユーザーJWTで認証し、支援中だけ動画を返す

将来、Supabaseの署名方式変更後に会員関数が401になる場合は、`member-status`と`member-videos`の組み込みVerify JWTをOFFにして、関数内の`withSupabase({ auth: "user" })`だけで検証する方法があります。現時点では実際のログインテスト結果を優先してください。

## 6. 限定動画の追加

Supabase DashboardのTable Editorで`member_videos`を開き、行を追加します。

```text
title          動画タイトル
description    説明
youtube_id     YouTube動画IDだけ
published_at   公開日
sort_order     大きい数字ほど先頭
is_published   trueで表示
```

YouTube URLが次の場合：

```text
https://www.youtube.com/watch?v=AbCdEf12345
```

`youtube_id`へ入れるのは次だけです。

```text
AbCdEf12345
```

動画はYouTubeの限定公開を推奨します。ただし限定公開URLや埋め込み動画は、閲覧者による共有を完全には防止できません。

## 7. 本番確認

1. GitHub Pagesへ8ファイルをアップロード
2. `https://sho-support.github.io/member-login.html`を開く
3. Supabase組織メンバーのメールアドレスでログインメール送信を試す
4. Custom SMTP設定後、一般のメールアドレスでも送信を確認
5. Stripeで月額支援を行う
6. Stripe WorkbenchのWebhook deliveryがHTTP 200か確認
7. Supabase `supporters`テーブルにメールと`active`が入ったか確認
8. 決済時と同じメールでログインし、BACKSTAGE ROOMが開くか確認
9. 未支援メールではLOCKEDになるか確認

## 8. 公開してはいけない値

次はGitHub、HTML、JavaScript、チャット、スクリーンショットへ出さないでください。

```text
Stripe Secret key（sk_live_...）
Stripe Webhook signing secret（whsec_...）
Supabase Secret key（sb_secret_...）
```

Publishable key（`sb_publishable_...`）はブラウザ利用を前提とした公開用キーです。


## Band Supportの支払い方法

`support.html`には、銀行振込・原則前払い、振込手数料は依頼者負担、カード・PayPayは現在非対応という案内を追加しています。
