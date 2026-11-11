# Band Support CRM — 商用公開手順（2026-11-12）
現状：**専用DBとWebアプリの実装・オフライン試験は合格。本番公開は未実施。**
この手順は**Band Support管理画面だけ**を対象にし、Guns N' Loses / SHO WEB SUPPORT公開URL・DNS・既存サイトを変更しない。

## 公開先の判断
Cloudflare Pagesの静的公開を推奨。無料枠は公式資料上、月500ビルド。GitHub Pagesは商取引/SaaSの無料ホスティング用途に適さない。Netlifyは共用クレジット枯渇中なので使用しない。
- ソース: GitHub `sho-support/sho-support.github.io`
- 公開するブランチ: **`band-crm-isolated-20261112`**。絶対に `main` を選ばない。
- Build command: 空欄（ビルド不要）
- Publish / output directory: **`band-crm/web`**
- プロジェクト名候補: `sho-band-support-admin`（空き名はCloudflareで確認する）
- 初回公開後、**Production branchのみ**を対象にする。Preview branchはNone、不要な自動デプロイは停止。以後はまとめてリリース。
- 登録前にCloudflareのFree/有料・クレジット残高とAuto billing/overage条件を確認する。有料契約は自動承諾しない。
- 公開URLはCloudflareが発行した**実在URL**を使う。仮の `pages.dev` アドレスを推測して案内しない。
- CRMは顧客向け販売ページではなく、SHO運営者のログイン画面。URLの公開だけではデータを取得できないことをRLSで確認済み。

## 初回ログインと実画面試験
1. 公開したHTTPS URLをPC・Androidで開く。SSL・CSS・外部Supabase SDKの読み込みを確認。
2. 既存の検証済み運営者のメール/パスワードでログインする。本人だけがCRMにアクセスできることを確認する。
3. 管理者以外/ログアウトで顧客、案件、入金を読み書きできないことを確認する。ログアウト後のブラウザ戻るも確認する。
4. **個人情報ではないテストデータ**で、見込み客の作成→見積→税込/税別→進捗更新→入金→売上集計→マイナス訂正→CSVバックアップを実施。
5. 顧客向けのLINE・メール・BOOTH等への自動送信はない。画面の「見積文コピー」で手動案内する。
6. 表示幅320/390/1366px、Chrome/Safari/Androidとキーボードを確認。外部ブラウザ接続の実試験は未実施。
7. テストデータは管理画面から削除できない仕様（誤消去防止）。実DBでテストする場合は専用トランザクションROLLBACKなど安全な手順を使う。

## データ保護・運用
- Supabase：`sho-web-support` / `tyhymvgjkoebetyypspj`。新規の `band_crm_*` テーブルと価格・照合番号の制約を追加。HP販売側の`website_*`は未変更。
- 既存の認証済み運営者アカウント1つにだけCRM管理権限を付与。メールの自己申告やSNS名だけでは他人へ管理権限を付与しない。
- 取引先情報は必要最小限。銀行口座・パスワード・APIキー・秘密トークンを顧客メモに入力しない。
- 入金記録は編集・削除不可。実入金は銀行明細と照合し、重複不能な証跡番号を登録。返金・誤入力は理由つきマイナス記録で訂正。
- 無料Supabaseは長期不使用時の一時停止・バックアップ制限がある。実務データについてはCSVバックアップを適切に保存し、継続稼働が必要になったら公式プラン条件を確認する。
- CRMの公開前に個人情報の利用目的・保管期間・削除対応・問い合わせ先をBand Supportのプライバシー案内で確認する。

## 検証済みと未検証
- PostgreSQL/RLS試験: 管理者書込み可・非管理者拒否・重複入金拒否・マイナス訂正条件・DB側の最低価格・証跡番号の大文字小文字差重複拒否。**ROLLBACK**でテストデータを残していない。
- Node静的検査：10項目通過。
- Chromiumモック画面検査：PC 1440px、Android相当390px、320pxで合計12項目通過。横はみ出しなし。模擬APIのため**本番API通信成功とは異なる**。
- 未検証：Cloudflareへの公開／本物の認証セッションでのログイン／現物の銀行入金／LINEと顧客との実やり取り。

公式：
- https://developers.cloudflare.com/pages/configuration/git-integration/
- https://developers.cloudflare.com/pages/platform/limits/
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://supabase.com/docs/guides/platform/free-project-pausing

## 2026-11-12 DB制約の強化
- `database/002_price_and_payment_reference_guards.sql` も適用済み。見積金額の最低ラインをDBで強制し、銀行照合番号の前後スペース・大文字小文字だけの違いによる重複を拒否。
- モック操作テストは12件成功。ブラウザから実Supabaseにログインする本番接続試験とは区別する。
