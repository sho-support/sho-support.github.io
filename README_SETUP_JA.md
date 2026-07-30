# Guns N' Loses 支援者専用ページ 完成版セットアップ

この更新は次の3点をまとめて反映します。

1. `support.html` を横長カードの縦並びへ変更
2. `index.html` のJAS FESTIVAL詳細から大きなOFFICIAL INFO欄を削除
3. Stripe支援中の人だけが入れるBACKSTAGE ROOMを追加

## ZIP内の配置

```text
/
├─ index.html
├─ support.html
├─ support-us.html
├─ .env.example
├─ package.json
├─ supabase.sql
├─ vercel.json
├─ README_SETUP_JA.md
├─ api/
│  ├─ _shared.js
│  ├─ public-config.js
│  ├─ member-status.js
│  ├─ member-videos.js
│  └─ stripe-webhook.js
├─ data/
│  └─ member-videos.json
└─ public/
   ├─ member.css
   ├─ member-login.html
   ├─ member-login.js
   ├─ members.html
   └─ members.js
```

GitHubの同じ場所へ上書きしてください。画像・`about.html`・`gallery.html`などは変更しません。

---

## 1. GitHub Pages側で先に確認するページ

アップロード後、数分待って次を確認します。

- `https://sho-support.github.io/`
- `https://sho-support.github.io/support.html`
- `https://sho-support.github.io/support-us.html`

確認内容：

- Band Supportが3列ではなく、横長カード3枚の縦並びになっている
- microSDを開いても文字が縦1列にならない
- 動画編集を開くと3本の参考動画が同時に表示される
- JAS FESTIVAL詳細に大きなOFFICIAL INFO欄がない
- Support Usの3つのStripeボタンが今までどおり開く
- 「応援者ログイン」ボタンが表示される

---

## 2. Supabase設定

### 新規プロジェクトの場合

1. Supabaseで新規プロジェクトを作成
2. SQL Editorを開く
3. `supabase.sql` を全文実行
4. Project Settings → APIで次を控える
   - Project URL
   - Publishable key（anon key）
   - service_role key

`service_role key` はGitHubやHTMLへ絶対に貼らないでください。

### 以前のSQLを実行済みの場合

今回の `supabase.sql` は不足列を追加できるようにしてあります。もう一度全文を実行してください。

### Authentication URL設定

Authentication → URL Configurationで設定します。

Vercelプロジェクト名を `guns-n-loses-members` にした場合：

- Site URL：`https://guns-n-loses-members.vercel.app`
- Redirect URLs：`https://guns-n-loses-members.vercel.app/members.html`

Vercelで別URLになった場合は、実際のURLへ置き換えてください。

---

## 3. Vercel設定

1. Vercelで `sho-support` リポジトリをImport
2. Project Nameを可能なら `guns-n-loses-members` にする
3. Framework Presetは `Other`
4. Root Directoryは空欄のまま
5. Environment Variablesへ次を登録

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
OFFICIAL_SITE_URL=https://sho-support.github.io
```

6. Deployを実行
7. 次が開くことを確認

```text
https://guns-n-loses-members.vercel.app/member-login.html
```

VercelのURLが違った場合は、`support-us.html` にある次のURLを実際のURLへ1か所だけ置換します。

```text
https://guns-n-loses-members.vercel.app/member-login.html
```

置換後、`support-us.html`だけGitHubへ再アップロードします。

---

## 4. Stripe Webhook設定

Stripe Dashboard → Developers / Workbench → WebhooksでEndpointを追加します。

Endpoint URL：

```text
https://guns-n-loses-members.vercel.app/api/stripe-webhook
```

Vercel URLが異なる場合は実際のURLへ変更します。

受信イベント：

```text
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
invoice.paid
invoice.payment_failed
```

作成後に表示されるSigning secret（`whsec_...`）を、Vercelの `STRIPE_WEBHOOK_SECRET` に登録して再デプロイします。

---

## 5. 限定動画の追加

`data/member-videos.json` は現在空です。そのため、支援者ページには「COMING SOON」と表示されます。

動画を追加するときは次の形式にします。

```json
[
  {
    "title": "7月のバンド練習",
    "description": "次回ライブに向けた練習映像です。",
    "videoUrl": "https://www.youtube.com/embed/動画ID",
    "publishedAt": "2026-07-30"
  }
]
```

YouTubeは限定公開にし、通常の視聴URLではなく埋め込みURLを使用します。

注意：YouTube限定公開URLは、閲覧者がURLを第三者へ共有できます。完全な転載防止ではありません。

---

## 6. 本番テスト

次の順番で確認します。

1. Stripeの月額支援をテスト用メールアドレスで行う
2. Stripe WebhookがHTTP 200になっていることを確認
3. Supabaseの `supporters` テーブルにメールアドレスと `active` が入ることを確認
4. Support Usの「応援者ログイン」を押す
5. Stripe決済時と同じメールアドレスを入力
6. 届いたメールのリンクを開く
7. BACKSTAGE ROOMが表示されることを確認
8. 別の未支援メールではACCESS LOCKEDになることを確認
9. Stripeで解約し、契約終了後に閲覧できなくなることを確認

## 完成判定

コードと画面はこのZIPで揃っています。ただし、支援者認証は外部サービスとの接続が必要です。Supabase・Vercel・Stripe Webhookの設定と、本番メールでの動作確認が終わるまでは公開運用の完成とは判定しません。
