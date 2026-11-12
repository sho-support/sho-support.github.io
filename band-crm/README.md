# SHO Band Support CRM — 開発版

Band Support専用の**運営者向け**顧客・見積・実入金・納品進捗管理アプリ。

- 顧客A/Bのセルフ登録は設けていない。既存の確認済み運営者だけがログイン可能。
- 実入金は消去・上書き不可の監査台帳で管理。誤入金は理由付きマイナス記録。
- 営業・見積額・実入金を別計上。既存のBand Support掲載料金を初期最低料金として使用（編集2,500/4,000/8,000円、撮影4,000/6,500円）。
- 見積文コピー、集計CSVと全データJSON保存（任意・顧客情報を含む）、PC/スマホ対応。
- 顧客情報はSupabase `sho-web-support` 内の **band_crm_* の新規テーブルのみ**。既存 `website_*` や他プロジェクトは変更しない。
- まだ一般向けサイトは未公開。GitHub Pagesは商取引サイト/SaaS用として利用しない。
- 無料商用ホスティング候補は Cloudflare Pages/Workers 静的アセット。実際のCloudflareアカウント接続・ドメイン・HTTPS・クレジットを確認してから公開。
- Supabase Edge FunctionsによるHTML配信はカスタムドメインなしでは利用不可。無理に代替しない。
- Supabaseフロントエンドには`sb_publishable_`のみを載せる。Service Role/Secret keyを絶対に公開しない。

## ファイル

- `web/index.html`, `web/style.css`, `web/app.js`, `web/config.js` — 商用ホスティングへ配置する静的アプリ
- `database/001_band_crm.sql`〜`003_paid_quote_and_refund_guards.sql` — 既存HP販売システムに触れない追加DDL、RLS、監査用トリガー
- `tests/check.mjs`・`tests/smoke.py` — Chromiumを使ったレスポンシブ・見積・XSS・権限UI検証（APIはテスト用モック）

## 公開前の必須確認

1. **販売者自身のログイン**：既存の確認済みSupabase Authユーザーに限定。メールアドレスとパスワードを用いてログイン、管理者以外はアクセス拒否。
2. **Cloudflareの接続**：既存の会社/バンドサイトと別プロジェクトを利用。GitHubの新規作業ブランチを直接公開しない。公開するコミットをまとめ、意図しない自動デプロイを止める。
3. **認証情報**：SupabaseのSite URL、許可Redirect URLを公開先と合わせる。初回パスワード再設定の実送受信。
4. **実データ試験**：実ブラウザで顧客→見積→見積文コピー→入金/訂正→売上集計→CSV書き出し、画面サイズ各種。銀行の実入金の自動確認はしない。
5. **機密保持**：顧客の氏名、LINE IDなどを外部に公開しない。CSVは任意バックアップで、共有に注意する。
6. **取引条件**：別途LINEで税区分、キャンセル・修正・納期・対外費用を確定。現在は銀行振込・原則前払い。

## 商用ルールの一次資料

- https://developers.cloudflare.com/pages/platform/limits/
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/functions/limits
## 2026-11-12 実施した検証
- DBマイグレーション3本を専用Band Supportテーブルへ適用。匿名閲覧・非管理者書込みの拒否、支払証跡の重複拒否、DB側の料金下限（2,500円〜）、訂正理由の必須化をROLLBACK付きで試験。
- 現行Node静的契約検査15件成功（実GitHub Actionsは未実行）、PC1440px・スマホ390px/320pxのChromium模擬操作12件成功。試験データは保存していない。
- GitHub Pages本番`main`は未変更。Cloudflare商用公開は未接続のため、現時点ではWebアプリURLなし。
- [本番設定の詳細](DEPLOYMENT_AND_RELEASE.md)。

## 2026-11-12 追加の保守・セキュリティ検証
- `database/003_paid_quote_and_refund_guards.sql` をBand Support専用DBに適用済み。入金済み案件の見積金額・顧客・サービス・税区分・案件名は変更禁止。入金額を超える返金訂正、および見積作成中・キャンセル済み案件への新規入金登録もDBで拒否。
- 入金日付は日本時間 `Asia/Tokyo` に統一。正規化照合番号の一意制約を維持。
- Web画面は操作結果の更新行数を確認し、**保存成功後の画面更新失敗を登録失敗と誤表示しない**。結果不明時は再送信せず一覧を確認するよう案内する。
- 管理者向けのパスワード再設定ページ `web/reset.html` / `web/reset.js` を追加。**本番URLが確定したら、Supabase Authの許可リダイレクトに `https://(実際のCloudflare URL)/reset.html` を正確に登録**し、メール送信・変更・再ログインの実試験を行う。
- `集計CSV` は閲覧用、`全データJSON保存` は顧客・案件・入金・操作履歴をまとめる任意の記録用。JSONからの自動復元機能はまだない。どちらも個人情報を含むため、第三者への共有禁止。
- SQLトランザクションで管理者の入金→返金と見積ロック、非管理者の情報閲覧拒否、過剰返金拒否、重複照合拒否を確認。**テスト用データはROLLBACK済みで、実売上は0件**。
- 最新版のGitHubファイルから静的契約検査**15項目通過**とJS構文確認を実施。過去のChromium模擬操作12項目の成功はあるが、今回の追加変更についてはブラウザE2Eをまだ再実行していない。
- Supabaseセキュリティアドバイザーは既存のSHO WEB SUPPORT向け警告・情報を計3種類報告（RLSポリシーなし5テーブル、public拡張、漏えいパスワード保護）。**Band Supportの5テーブルはすべてRLS有効**。既存システムへの影響を避けるため、関係ないテーブル・Auth設定は無断変更していない。
- Cloudflare Pagesの本番用ブランチは開発版を直接指定せず、検証済みコミットから切った`band-crm-release-v1`を使う。以後は開発→確認→まとめてリリースし、無料枠と更新回数を管理する。
