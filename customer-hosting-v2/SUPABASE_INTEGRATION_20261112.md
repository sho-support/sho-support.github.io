# Supabase / Cloudflare 公開統合の開発記録（2026-11-12）

対象ブランチ: `architecture/customer-hosting-v2`。販売開始・本番切替の完了報告ではない。

## 実環境と保護範囲

- `sho-web-support` / `tyhymvgjkoebetyypspj` の稼働ソースを取り直した。customer-access v49、api v46、worker v42、preview v9。変更前の各ファイルの SHA-256 は `evidence/supabase-source-baseline-20261112.json` に記録。
- 各 Function が実際に同梱していた `_shared/website.ts` をそれぞれ保持した。版の異なる共通ファイルを一つに上書きして、既存の見積り・LINE認証・制作処理を退行させないため。LINEのリトライ対応だけは既に稼働している v49 実装に統一。
- PostgreSQL のバイパス権限を持つ実行ロールで集計した時点で `website_sites=0`、`website_orders=0`、確定URL付き注文=0。顧客の識別情報・トークン値は取得していない。将来の本番反映直前に再集計する。
- 本番 Function / DB / DNS / Netlify / `main` は変更していない。テスト注文・LINE・決済は本番で発生させていない。Guns N' Loses のサイト・画像・会員機能は変更対象外。

## 保存した実装

1. `supabase/functions/_shared/hosting-release-{preflight,publisher}.mjs` を Node と Deno の共通の正本にした。従来の `customer-hosting-v2/src/` は再エクスポートするため、両環境で異なる公開コードに分岐しない。
2. 制作完了時に非公開 GitHub リポジトリのコミットを固定し、Git の blob ハッシュを照合して R2 へ不変アップロード。完成マニフェストを SHA-256 で DB に結び付ける。顧客プレビューもその固定版を読み、可変ブランチからは配信しない。
3. 両方の顧客承認経路、運営者の公開・非公開、確認URL再送を `hosting-routes.ts` に統一。公開は運営者の実認証と DB の最新の承認対象版を照合する。ブラウザの `approved:true` は使わない。
4. CLI で新規生成した追加 migration `20261112053755_website_cloudflare_publication_protocol.sql` に URL予約・公開版・操作・通知の記録を保存。新設表は RLS 有効、一般利用者の表アクセス / RPC 実行は禁止。既存サイトの自動登録・URL移行は行わない。
5. URL は見積り前に予約。入金確認時の案件・ヒアリング・LINE紐付け・アクセスキーの保存は一つの短いトランザクションで実行。既に案内した異なる URL の自動置換は禁止。
6. 公開操作は DB の永続的なロックと R2 の条件付き書込みを使用。タイムアウトだけではロックを解除しない。元の書込み前のスナップショットに対して復旧用の条件付き書込みを行い、遅延していた古い処理が後から公開を変更することを防ぐ。
7. 公開ポインターに操作ごとの UUID を追加。A→B→A の復元で同じ ETag が再現し、古い書込みが通る問題を防止した。既存の公開リーダーは追加フィールドを無視できる。
8. R2 成功・DB 失敗、DB 成功・応答喪失、復旧書込みの応答喪失を再照合できる。認識できない別の書込みは上書きせずロックを残す。完了済み操作と通知は再実行で重複作成しない。
9. 復元後の次回更新は、DB が指す現在の公開コミットから専用のソースブランチを作る。古い `main` / 過去の確認ブランチを流用しない。正式 URL と無料期間の起算日は復元で変えない。
10. 運営管理画面に公開履歴・復元・未確定操作の復旧・通知確認を追加。Cloudflare 管理案件には旧 Pages 設定欄を表示しない。公開済みの顧客確認リンクから更新画面へ進める。キーの平文は DB / 操作履歴に保存しない。
11. 公開通知は先に outbox を保存し、受信者ごとに保存済み UUID で LINE の重複排除を利用。送信リースを使用し、23時間を超えた不明な結果を自動再送しない。顧客への到達・既読を保証する仕組みではない。
12. Cloudflare モードでは旧 Pages のソース変更・独自ドメイン設定・ブランチ公開をサーバー側でも拒否。既存の SHO 追跡スクリプトを挿入しない。アクセス計測は未提供と明示し、未計測を「0回」と表示しない。

## 検証方法と境界

- ローカルの PGlite は PostgreSQL 18.6。既存の Postgres 17 と同一環境とは主張しない。GitHub Actions に使い捨ての PostgreSQL 17 を追加し、同じ SQL と一般ロールの権限拒否、独立した2接続の競合試験を実行する。
- `test:db`: URL固定・権限・3プラン・承認失効・操作ロック・入金確認の途中失敗・通知リース等。
- `test:pipeline`: 合成 SQL データ + 実際のローカル workerd/R2 で3プランの公開・更新・旧HTMLへの復元・非公開と障害復旧。
- `test:routes`: 実際の customer-access / api / preview ハンドラー、実 SQL、ローカル R2 を使用。外部 HTTP は遮断。認証検証と LINE はモック。修正依頼の二重送信防止、公開後の更新リンク、テナント分離も確認。
- `check:edge`: Deno 2.9.6、稼働版と同じ SDK 2.57.4 と aws4fetch 1.0.20 の型で4つの Function を検査。QA だけ npm の同一版へ解決する。実行コードの ESM import は変更しない。
- `website-hosting-ui.cjs`: 実 HTML を6幅で描画し、復元・復旧の操作、公開済み顧客の更新リンクをモック環境で確認。外部通知や決済は実行しない。
- この作業環境のローカルブラウザは OS 制限で起動できなかったため、画面描画の合否は GitHub Actions の実行結果と画像で判定する。テストコードの存在だけを合格としない。
- AI の有料 API を呼ぶ実制作、GitHub の実顧客リポジトリへの保存、実 LINE / メール / 入金、Supabase 本番と R2 S3 認証の接続はこのモック試験の対象外。
- 静的検査は認証情報らしい文字列、旧管理URL、ブラウザ保存領域、動的コード、未審査の通信・外部スクリプト等を拒否する。難読化した任意 JavaScript の安全性を証明するサンドボックスではない。専用ドメインによる分離と秘密情報をサイトに含めない設計が前提。

## 本番接続前に残る A 項目

- 販売用の正式な顧客専用ドメインの決定・所有・更新条件・DNS / HTTPS 確認。`CUSTOMER_BASE_DOMAIN` と `CUSTOMER_HOSTING_DOMAIN_READY` が同じ確定ドメインになるまで見積り予約を拒否する。購入・DNS変更は承認が必要。
- Supabase から R2 に接続するバケット限定の S3 認証情報を安全な Secrets 設定で登録し、実疎通を試験する。GitHub に保存した Cloudflare API トークンは、この S3 認証情報の代わりにはならない。チャットやコードへキーを貼らない。
- 素材受付は参照する画像を合計50点 / 30,000,000B / 1点7,000,000Bに揃えた。元ソースの公開スナップショットは80ファイル / 35 MiB、汎用公開パッケージは500ファイル / 35 MiB。これは受理する素材の上限であり、Storage全体の保管量や署名URL発行数の上限ではない。未使用アップロードの保持期限・掃除・発行頻度の制限は販売前の残件。
- AI 生成費用の予算・上限、長期のリリース保持量、異常アクセス・アップロード量の監視を本番の実利用に接続。Cloudflare の $5 通知は強制停止ではない。
- Supabase のバックアップと別系統への保管・実復元、契約終了時の引渡しを実証。R2 の合成データを別のローカルバケットへ復元した試験だけで本番のバックアップ完了とはしない。
- 制作費・更新費・公開維持費の契約条件と正式な営業者表示、実連携の最終試験。本作業で価格・キャンペーンは変更していない。

## 反映と復旧の制約

- migration は追加のみで、現存顧客の自動移行は含まない。過去の migration 全件を本番へ再実行しない。リポジトリ内の初期 SQL に既存の区切り文字の不整合があるため、全DBの新規再構築が検証済みとはしない。
- 本番反映は、対象4関数の稼働版が記録したベースから変わっていないか再確認してから、先に追加 SQL、次に4関数を機能フラグ無効で反映し、最後に明示的な接続確認を行う。部分的に新旧公開経路を切り替えない。
- 一度 Cloudflare へ登録した顧客を、問題時に単純にフラグを戻して Pages 公開してはならない。DB のガードと不変URLを維持し、R2 の旧版復元または非公開で対応する。元 Function へ戻す必要がある場合も、登録済み顧客の状態と通知を個別に照合する。
- Supabase の有料開発ブランチは作成していない。テストは使い捨て環境で実行し、本番 DB に試験注文を作っていない。

一次資料:
- https://supabase.com/docs/guides/database/functions
- https://supabase.com/docs/guides/functions/limits
- https://docs.github.com/en/rest/git/blobs
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- https://developers.line.biz/en/docs/messaging-api/retrying-api-request/

## 管理権限の再監査

- 公開履歴の actor_id は操作時点の UUID を記録する。管理者一覧への外部キーで権限剥奪を妨げない。公開直前と復旧時に現在の管理者権限を再確認する。
- 操作を開始した管理者が外れた場合も、別の現管理者が同じ永続記録を照合して復旧できる。元の actor_id は保持し、存在しない認証利用者を操作履歴へ再挿入しない。合成データで権限剥奪と引継ぎ復旧を試験する。

## 実行証跡（最終再検証）

- 実装コミット: `e2fbcae821e529a411e681d221a8fe84997b1a15`。素材受付の追加修正: `52ccdfda65a913f02779f3ffd30dc4012e10d1b8`。
- 最新の総合試験: https://github.com/sho-support/sho-support.github.io/actions/runs/43203729930 — contract / publication-database / sales-regression が全合格。
- 単体98、ローカル workerd/R2 14、Supabase R2ラッパー3、PGlite 11、SQL＋R2通し11、実HTTPハンドラー11が合格。別ジョブのPostgreSQL **17.11** でも12テスト合格。重複するDB試験を含むため、総数を一つに合算しない。
- ブラウザ: 販売ページ636、注文モック71、新しい復元・復旧UI62、素材受付68の各確認項目が合格。全6幅で描画。320 / 390 / 1366px の管理画面と公開済み顧客確認画面の画像を目視確認。QR用の外部CDNはこのモックでは遮断しており、QRの実通信検証ではない。
- 実Cloudflare試験: https://github.com/sho-support/sho-support.github.io/actions/runs/43173412998 — 9項目と実HTTPS画面6幅が合格。公開リーダーは再デプロイしていない。試験対象の予約IDは `9000001000` のみ。
- 今回の計測範囲は PUT 22回、GET/HEAD 76回、11,333B。訪問者HTTP読取・R2一覧・管理API等を含む総課金量ではない。
- 証跡JSON: `evidence/supabase-cloudflare-integration-20261112.json` と `evidence/live-preview-supabase-core-20261112.json`。
- 作業用ローカル環境が途中で利用できなくなったため、その後の修正もGitHubへ直接保存し、GitHub Actionsで実行して再検証した。ローカルにしか存在しない完成コードはない。

**判定: 開発版の公開統合と復旧処理は検証済み。本番接続・販売開始は未完了。上記 A 項目を残したまま切り替えない。**

## 素材受付の追加監査（2026-11-12）

- 既存の制作ワーカーは、ヒアリングに含まれる画像パスをサービスロールでダウンロードする前に顧客の保存先か照合していなかった。第三者の素材が実際に漏えいしたという証拠はない。開発版では両方の保存・送信経路とワーカーの制作開始前に同じ検証を通す。
- `intake-assets.mjs` は全参照を先に検査し、他顧客・パストラバーサル・非画像形式・不正な項目・過剰な点数を拒否する。送信・制作時には秘密のStorageメタデータを参照し、ブラウザが申告するサイズではなく実サイズとMIMEで50点 / 30MB / 1点7MBを確認する。メンバー写真も同じ合計に含める。
- `website-materials.js` とヒアリング画面は、選択中・保存済み画像を合算し、超過時は最初のアップロードURL発行前に停止する。失敗理由を画面に表示し、保存に失敗したまま確認画面へ進まない。申込最終確認・FAQにも同じ上限を記載。既存価格・無料キャンペーンは変更していない。
- 画像の複製中にも実バイト数を再確認する。ソース公開パッケージの合計を35 MiBに揃え、30MBの素材に生成HTML等を加えられる範囲を確保した。上限超過は公開前に拒否する。
- `.info()` を使う実Supabase環境のメタデータ応答との疎通、本番アップロード、全体の保管量制限は未検証・未完了。署名URLは個々に取り消せないため、この修正だけで無制限アップロードや従量課金リスクが解消したとはしない。
- 追加した単体8件・実HTTP経路2件と、Chromiumの素材受付68確認項目が実行済み・合格。6幅で描画・操作し、51点、メンバー写真との合算、30MB超過、1点7MB超過でアップロード開始前に停止すること、正常保存・再保存を確認した。390pxの描画画像は目視確認済み。最新総合CIは上記 `43203729930`。実Cloudflareへの追加書込み・Worker再デプロイは行っていない。

追加の一次資料:
- https://supabase.com/docs/reference/javascript/file-buckets-info
- https://supabase.com/docs/guides/platform/manage-your-usage/storage-size
- https://supabase.com/docs/guides/storage/uploads/standard-uploads

### 追加修正の変更ファイル

- サーバー: `supabase/functions/_shared/intake-assets.mjs`、`intake-assets.ts`、`hosting-github.mjs`、`website-api/index.ts`、`website-customer-access/index.ts`、`website-worker/index.ts`。
- 画面: `website-materials.js`、`website-intake.html`、`website-order-confirm.html`、`website-faq.html`。
- 検証: `customer-hosting-v2/tests/intake-assets.test.mjs`、`intake-routes.integration.mjs`、`tests/helpers/edge-harness.mjs`、`customer-hosting-v2/package.json`、`tests/website-intake-materials.cjs`、`.github/workflows/customer-hosting-v2-tests.yml`。
- 記録: 本資料と `evidence/supabase-cloudflare-integration-20261112.json`。

保存先は開発ブランチ `architecture/customer-hosting-v2`。`main` は再確認時も `b24971dc4e7956a9bbfa68d5607189c3beaebb4b` のまま。既存のバンド公式サイトのファイルは変更していない。
