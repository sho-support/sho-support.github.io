# SHO WEB SUPPORT / 2026-11-09 引き継ぎ検証と実装状態

> 開発専用の進捗記録。本番反映・Cloudflare接続・DNS変更・実決済は未実施。完成宣言ではない。

## 正式な運用判断

- **目的は最初の1〜2件を販売すること。** 100件無料維持は必須条件ではない。
- GitHub（顧客ごとに原則非公開リポジトリ）はソース・履歴・納品データ用。Cloudflare Worker + R2 Standardは顧客の公開サイト用。Supabaseは受注・認証・承認・制作管理用。
- 最初は無料枠中心で開始。初回成約、必要な安定性・利用量に応じ、Workers Paid（月最低$5）等に移行できる設計とする。Supabase等の費用は**別途**考慮する。
- Cloudflareの無料→有料変更だけで正式URLを変えない。顧客に正式URLを渡す**前**に保有・更新できるドメインを確定する。
- SHO管理型はSHOのアカウントでコードと公開を運用。完全独立型はGitHubの移管だけで完了とはしない。顧客自身が管理する公開先・独自ドメインへ移行する。SHOの共用サブドメインでは完全独立できない点を契約前に伝える。
- 顧客の公開専用ドメインを優先検討し、運営・認証サイトと同じ登録ドメイン下で任意JavaScriptを配信する際のCookie・SameSite汚染問題を避ける。
- 既存の販売価格（15,000円〜 / 22,000円〜 / 30,000円〜）と更新料金は、ユーザーの承認なく変更しない。公開維持費の有無・期間・停止条件は、販売前に別途確定する。

## 2026-11-09 実際に確認した事実

1. GitHubの3ブランチ（main, netlify-sales-staging, architecture/customer-hosting-v2）を確認。新設計ブランチはnetlify-sales-stagingの25コミット先にある。
2. Supabase sho-web-support は ACTIVE_HEALTHY。website_* テーブル14件を確認し、すべてRLS有効。website-worker/website-api/website-customer-access などが ACTIVE。
3. **既存Supabase本番の公開処理はGitHub Pages依存のまま**。website-workerが顧客用GitHubリポジトリを作成し、website-api と website-customer-access がGitHub Pagesの公開を実行する。Cloudflare経路への切替は未実装。
4. Cloudflareの新コードはプロトタイプ。実R2、DNS、SSL、API連携、顧客承認・決済通しテストは未実施。
5. Supabase Security Advisorは、RLSポリシーなし5テーブル（サービスロール専用の意図があり得るため自動修正しない）、public内pg_net、漏えいパスワード検知無効を指摘。後者は要検討。未承認のDB変更は禁止。
6. 現行販売ページの無料URL説明には「公開先の変更でURLが変わることがあります」とある。正式公開URLが確定した後は、約束と整合する表示への見直しが必要。

## 今回の追加実装（開発ブランチのみ）

- src/release-publisher.mjs: 変更前の公開を保持したまま新リリースをR2に不変アップロードし、サイズ再照合。サーバー側の承認を求めるコールバックを必須にし、既存リリースIDとの比較とR2条件付きPUTで競合公開を拒否する。旧リリースIDへの切戻しも可能。
- tests/release-publisher.test.mjs: 未公開保持、二重上書き拒否、途中失敗時の旧公開維持、承認なし拒否、初回公開、更新、競合拒否、切戻しなど **9件**。ローカルNode.js 22で全合格。
- **重要**: このモジュールはSupabase本番へ接続しておらず、Cloudflare実サービスでの動作確認でもない。認証コールバックを呼び出す側で、運営権限・顧客承認の永続化を必ず検証する必要がある。

## 販売開始を妨げている未解決の必須事項

1. Cloudflareアカウント／R2サブスクリプションの有無を確認。R2 StandardのバケットとテストWorkerを用意し、実デプロイ・TLS・R2読み書き・ワイルドカードルートを検証する。R2は無料枠があっても利用開始にサブスクリプションの有効化が必要。
2. 顧客に配る標準URLの**登録ドメイン・更新責任・権限**を確定。SHOの既存DNS/メール/Guns N' Losesサイトは切替対象にしない。新規公開専用ドメインを使う場合は登録費・更新費と登録者を確認。
3. SupabaseのAI生成したHTMLと画像を非公開R2へアップロードする経路を安全に実装。公開前の検証・管理者確認・顧客承認後にだけアクティブリリースを切替え、実公開を確認してDBの公開状態を更新する。従来のGitHub Pages公開処理を本番反映前に置換。
4. 3料金プランを注文→内容確認→AI制作→顧客承認→公開→更新→ロールバックまで実環境で試験。実入金や実通知の最終許可は運営者が行う。
5. 顧客ごとの隔離、公開前秘匿、バックアップと復元、申込・契約条件、公開維持費、解約後の移管、Supabase Freeの停止リスクに対処。
6. 販売サイトの全画面サイズでの目視・自動E2E検証は、**本番に投入するコミット**で再実施。既存サイト・バンド関連ページを破壊しない。

## 一次情報

- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/configuration/routing/routes/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/get-started/
- https://supabase.com/docs/guides/platform/free-project-pausing
- https://supabase.com/docs/guides/platform/backups

**結論**: 現状では販売システム全体は完成していない。これ以上の概念設計よりも、Cloudflare環境の実接続とSupabase公開フローの置換が次の実装対象。

## 追加でコードと照合した本番移行時の注意点

- 既存の `website-worker` は顧客HTMLへ `https://sho-support.github.io/website-track.js` を挿入している。公開ページからこの旧公開基盤に依存しないよう、追跡処理を適切な商用公開先へ移すか、移行が終わるまで無効化する。GitHub Pagesを商取引サイトの実行基盤に残したまま完成扱いしない。
- `website-api` と `website-customer-access` の「publish」経路が **2か所** 存在し、どちらも旧GitHub Pagesへ公開する。片側だけ直すと方式が混在するため、両経路の公開許可・顧客承認・更新・通知・状態保存を一括で統合し、旧方式へ誤って公開する経路をなくす。
- `wrangler.example.jsonc` は `workers_dev:false` かつ `CUSTOMER_BASE_DOMAIN` のホスト名チェックが厳密。そのまま `workers.dev` でアクセスしても顧客サイトを200で表示する仕組みではない。テスト環境では仮ドメイン・Host検証を別途用意し、`workers.dev` が開いたというだけで本番のSSL/ルーティング合格とはしない。
- 現行の `*.sho-support.com/*` というWorkersルート案は、将来既存サブドメインを巻き込むリスクがある。顧客専用ドメインを優先し、ゾーン・DNSと対象ホスト名を確認するまで既存ドメインへ適用しない。
- 新しいリリースモジュールの公開許可コールバックは **サーバー側で顧客の最新承認記録と運営者権限を検証して初めて有効**。ブラウザから渡された `approved:true` だけを信用してはならない。公開切替成功後のDB更新失敗も回復可能な手順を別途実装する。
