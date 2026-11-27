# SHO WEB SUPPORT | 3プラン×3ケース QA記録
日付: 2026-11-06
対象: Supabase project tyhymvgjkoebetyypspj / netlify-sales-staging

## テスト振込先
- テスト銀行 / テスト支店 / 普通 0000000
- 本物の銀行口座ではないため、振込は禁止。
- website_settings.bank_transfer_test に保存。
- order_codes は空配列（一般注文へ誤送信しないため）。
- 正式見積りで使う website_settings.bank_transfer は未設定のまま維持。

## 実施した9ケース (DBトランザクション内・自動ロールバック)
1. One / unlimited / ¥22,000〜 / ID1000 / PASS
2. One / none / ¥15,000〜 / ID1001 / PASS
3. One / none / ¥15,000〜 / ID1002 / PASS
4. Semi / rock / free3 / ¥22,000〜 / ID1003 / PASS
5. Semi / premium / free3 / ¥22,000〜 / ID1004 / PASS
6. Semi / cyber / free3 / ¥22,000〜 / ID1005 / PASS
7. Full / free3 / ¥30,000〜 / ID1006 / PASS
8. Full / free3 / ¥30,000〜 / ID1007 / PASS
9. Full / free3 / ¥30,000〜 / ID1008 / PASS

テスト内容:
注文レコード作成 → 入金待ちへのステータス変更 → 数字だけのSITE IDによる案件作成 → ヒアリングデータ登録 → building状態 → 制作ジョブqueuedの登録 → 全4テーブルの参照整合性と料金・プラン照合。

9ケースすべてSQLのチェックに合格。例外ブロックによる自動ロールバックを実施し、終了後の件数は orders=0 / sites=0 / jobs=0 / intakes=0 と再照合済み。
**実際の注文APIに対してブラウザから注文したわけではない。実AI生成、GitHubへの成果物作成、プレビューのブラウザ表示、メール・LINEの送受信、現実の入金、正式URLの公開は未検証。**

## 販売前に必ず検証する項目
- フォーム→注文API→LINE連携→正式見積り→入金確認→案件作成→AI生成→PC/スマホプレビュー→お客様承認→公開までのE2E
- 3プランそれぞれの実際の出力デザイン、画像、文字サイズ、URL、404、リンク
- 実在する正式公開ドメインの調達と検証。無料URLという販売文言と、システム側のサービス提供者ドメイン禁止ルールの整合
- 「テスト銀行」は本番正式振込先として設定しない。本番振込先の設定は実口座決定後
- Netlifyデプロイ後の実機動作（ステージングGitHub編集だけで公開反映されたと判断しない）
- Supabaseの漏えいパスワード保護警告

## 判定
9ケースのDB整合性: PASS
本番9回の注文→完成サイト自動生成: NOT RUN
販売可能判定: 未取得


## 追加の改良・自動ブラウザ検査（11/06）

- 見積り画面の「独自ドメイン必須」を修正。独自ドメイン欄を空欄にすると `free` を送信し、数値の案件IDからGitHub PagesプロジェクトURLを算出。
- サーバー側も無料URL / 独自ドメインを区別。独自ドメインの所有・更新責任確認は独自ドメインだけに要求。
- GitHub Pagesを有効化する前の公開URL検査という初回公開デッドロックを解消。先に生成ファイル検査・承認済み内容の反映・Pages有効化、次にURLのHTTPS表示を確認。
- お客様本人の公開権限を廃止し、運営者ログイン＋管理者権限が必要な `admin_publish_site` へ移行。
- 別のAPI経路 `website-api.review_action=publish` も拒否するよう変更。
- お客様確認画面から公開ボタンを除去。運営管理画面の承認済み案件に公開ボタンを追加。
- Netlifyビルドの回帰チェックを20項目へ増やし、同内容をステージングGitHubソースへ反映。読込ソースで20/20の静的チェックに合格。
- GitHub Actions `.github/workflows/qa-sales-staging.yml` と Playwrightテスト `tests/qa-sales-checkout.cjs` を追加。3プラン×3ケース×PC/モバイル=18ケースをブラウザで検査する構成。**GitHub Actions の実行結果・スクリーンショットの目視は未確認。**
- Supabaseのセキュリティアドバイザーで漏えいパスワード保護の無効化、publicスキーマのpg_net警告を確認。セキュリティ機能変更は未実施。

### 特に残る未確認
1. 本番URLでNetlifyの新しいデプロイがPublishedとなっていること
2. Playwrightの18ケース完走とスクリーンショットでの実目視（GitHub ActionsのCIログ要確認）
3. 実際の注文フォームPOST、LINEとの紐付け、見積りLINE受信、入金処理、AI生成、レポジトリ作成、公開（外部連携を伴う実動作）
4. GitHub PagesのプロジェクトURLはユーザーサイトに設定したカスタムドメインの影響を受けることがある。現状のサイト設定と顧客用の無料URL運用を必ず実サイトで確認
5. 本番の実口座 `bank_transfer` は未登録。テスト用設定 `bank_transfer_test` は設定したが本番見積りには使用しない（誤送金防止）
6. AI生成に用いるSupabase Edge Functionの外部APIキー／GitHub書込権限はライブ実行で未確認。作成した9サイトは存在しない。

**最終判定：静的/DB処理の部分合格。実運用E2Eの販売合格は未取得。**

## 実際のセミオーダー生成エンジン検査（追加）
- Supabaseの `website-worker/semi-template.mjs` を用い、NetlifyのテンプレートHTMLを入力として全10テーマのHTMLを生成。
- 同じworkerの `validateGenerated` を直接呼び出して、CSS・内部ページリンク・画像参照の検証に合格（10/10）。
- `<img onerror>` などをサイト名に含むテストと、`javascript:` リンクの安全性を検査、10テーマともHTMLエスケープ・無効リンク制御が有効。
- Rock、Premium、Cyberの3種は架空内容のサンプルページも作成済み：
  - `website-demo-semi-rock.html`
  - `website-demo-semi-premium.html`
  - `website-demo-semi-cyber.html`
  サンプルにはnoindexメタと「架空の内容です」表示を付加。ユーザーサイトの本番案件とは区別する。
- これは本番のAIモデル呼出し、GitHubサイトRepo作成、公開成功とは別の検証である。


## 追加調査：旧実AI制作ジョブの履歴
2026-11-06に退避済みのwebsite_jobsを監査。以前の制作処理の履歴では、初期生成7件中6件がsho_reviewへ到達し、1件がerror。
- qaone20261102: one-page AIモデル gpt-6.1-sol、sho_review、完了 2026-11-02T09:48:03Z
- qafull20261102: AIモデル gpt-6.1-sol、同日一度WallClockTime制限のエラーがあり、後続の別ジョブがsho_reviewへ到達
- qafull5nov04: AIモデル gpt-6.1-sol、sho_review、完了 2026-11-05T05:11:27Z
- したがって、過去には1ページ・フルオーダーの実AI制作が完了した履歴がある。
- ただし旧テストの成功は、今回の改良後に3プランそれぞれ3回を実行・公開できた証拠にはならない。旧サイトのprivate repo内容も、この監査では未照合。

## 追加ブラウザQAコード
`tests/qa-sales-checkout.cjs` を、9注文シナリオ×PC/スマホ=18、実セミHTML3種×PC/スマホ=6の24ケースへ拡張。
構文は確認済みだが、GitHub Actionsの実行結果をツールから取得できなかったため、UI合格とは記録しない。


## 2026-11-06 追加の実ブラウザ・公開監査
- GitHub Actions run `42124213557`: sales-ui PASS。Chromiumで注文画面9ケース×PC/スマホ、および生成済みセミHTML3種×PC/スマホの計24ケースを実行。24枚のスクリーンショットをGitHub Actions artifact `13459943174` から取得し目視確認。
- スクリーンショットでスマホLIVE日付とイベント名の重なりを発見。原因は `website-worker/semi-template.mjs` の後半にある重複 `@media` が先のCSSを上書きしていたこと。workerの最終CSSとテンプレート共通CSS、3サンプルの出力CSSを修正。
- 追加した `.event` のDOM矩形重なり検査が修正前に赤（run `42126398047`）となり、修正後の run `42126959181` はPASS。新しいartifact `13461531762` の修正版スクリーンショットでも日付と名称の縦表示を確認。
- Netlify無認証アクセス run `42126581035`: FAIL。ログインしていないChromiumから `https://sho-web-support.netlify.app/` が **HTTP 401** を返した。販売サイトは非公開設定のままで、一般ユーザーに閲覧できない。本番公開前にNetlifyの Project visibility をPublicへ変更する必要がある。Netlify側の設定変更はこのGitHub/Supabaseツールでは不可。
- GitHub Pagesの無料URLは運営側ユーザーサイトの独自ドメインを継承する場合があるため、`website-customer-access` でGitHub Pages設定を確認して無料URLを算出する処理を追加。公式仕様参照: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages
- GitHub REST public Pages確認は非認証で404（Pages設定の存在は非認証では確定できない）。有効なアプリトークンを持つEdge Functionが公開時に判定する。
- HTTP実注文APIで数字のみの注文番号1000の発行を実際に確認。DBアーカイブ後にテスト注文を削除し、現在の注文/案件/ジョブは0件。
- 安全確認のためテスト銀行の情報は `bank_transfer_test` にのみ保持。 `bank_transfer` 本番振込先は未設定。
- ブラウザ検査を320px/390px/768px/1366pxの4画面幅・48ケースへ拡大した。最新実行結果は別途確認する。


## 最終確認：48ケース + RLS
- GitHub Actions run `42127815193` の `sales-ui` ジョブは `success`。ログにも `"total": 48` と明示。320/390/768/1366pxで、9注文ケース+生成サンプル3ケースの計48件を合格。
- SupabaseのRLSを確認：すべての `public.website_*` テーブルでRLS有効。公開スキーマの顧客データは `authenticated` のサイト権限確認付きSELECTポリシー、管理者表は本人ID限定、LINE連携表は管理者限定。 `anon` 向けSELECTポリシーなし。
- 現在の管理者アカウント1件。現行案件、注文、制作ジョブ、顧客リンクは0件。既存過去テストのバックアップは保持。
- Netlify Public判定は認証なしGET HTTP401のためFAIL。Netlify設定は所有者本人がProject visibilityを変更する必要があり、Github/Supabaseで代替できない。 https://docs.netlify.com/manage/security/secure-access-to-sites/project-visibility/
- GitHub Pagesの無料URLは正式公開時に実際のPages設定を照合して発行する。運営側ユーザーサイトPages設定がAPIで404だったため、未設定扱い時はGitHubデフォルトURLへフォールバックする実装。
- 正式見積り・制作開始～公開の本番E2Eは、顧客の本物のLINE通信と運営側の権限ある操作を必要とするため未完了。ユーザー確認なしの対外通知や公開は実行しない。


## 顧客アカウント招待・確認画面再編集・API耐性検査（追加）
- GitHub Actions run `42137606400` で3プランの「注文確認→内容変更→同じプラン・テンプレート・金額の復元→再確認」の検査を追加し、Chromiumで合格。
- 320pxのプラン名改行テストで単一行を誤判定するチェックコードの不具合を見つけ、font-sizeではなく実line-heightを基準に修正。run `42136974497` success。
- 実際のSupabase注文APIへ6種類の不正な注文パラメーターを送信。無効プラン・テンプレート・不正な更新プラン5件はHTTP400、無許可Origin1件はHTTP403。新規の注文・顧客データは作成されず。
- `website-api` に運営者専用 `admin_invite_customer` を追加。既存のアカウントはSITE IDに権限付与、未登録の場合のみSupabase Authの `inviteUserByEmail` を利用してパスワード設定招待を送る。明示的な運営操作が必要。
- `admin/customers.html` を追加。既存の制作案件を選び、顧客確認済みメールアドレスに招待を送るUI。管理画面 `admin/index.html` と `admin/orders.html` に導線。販売ビルド検査に3チェック追加。
- 未ログインで `admin_invite_customer` を呼んでも権限により拒否する設計。ユーザーの実メールへ招待した実配送・パスワード設定・顧客マイページ閲覧の一連のテストは未実施。
- `website-api` に残っていた古い「お客様が公開を選ぶ」LINE文面を修正し、運営者が最終公開する仕様へ統一。
- GitHub Actions run `42138864433` は48件の画面テストと公開APIの拒否・CORS検査ともにsuccess。`42138864333` は新しい招待画面込み販売ビルドでsuccess。

現存する外部ブロッカー：
1. NetlifyのProduction URLは匿名アクセスにHTTP401を返していた。公開設定をオーナーが変更しない限り一般顧客は閲覧できない。
2. 実銀行口座未登録。テスト用の架空銀行口座は本番の請求に使わない。
3. LINE送受信・外部AI生成・GitHub Pagesの本番公開を通す完全な実E2Eは未合格。


## 2026-11-06 夕方の追加監査
- 正式見積り確認画面に古いハードコードURL `https://sho-support.github.io/site-<ID>/` が残っていたのを発見。サーバーが確定した無料URLと画面で確認するURLが食い違う可能性があったため、見積り確認画面は運営者専用 `admin_resolve_free_url` の返却値を使うよう修正。APIが取得に失敗した場合は送信せず日本語で警告。
- この変更によって販売ビルドの旧文字列比較が一時的に失敗（run `42201518199`）。旧条件を新仕様に合わせて修正し、run `42201570678` でビルド成功。
- 最新ブラウザUI 48ケース + API権限拒否検査：run `42201570716` 成功。
- 実Supabase注文APIへ不正入力5件を投げHTTP400、未許可Originを投げHTTP403、全件期待どおり拒否。注文データ0件を再確認。
- 匿名GET `https://sho-web-support.netlify.app/website-order.html` は引き続きHTTP401（Netlifyの非公開制限）。この状態で販売開始不可。
- Authパスワード再設定はすでにユーザーがメール受信からログインまで成功を報告。ただし新規顧客の招待メール・顧客ポータルの実端末動作は独立の未確認項目。
