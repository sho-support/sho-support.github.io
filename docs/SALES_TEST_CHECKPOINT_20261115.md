# HP販売：接続修正後のテスト開始点

2026-11-15 JST。対象は SHO WEB SUPPORT のみ。システム販売・TrendBlogは変更しない。

## 今回の実装と実配備

ソース `78f93f541c9ce200b6290602591207432f66d697`。
CI https://github.com/sho-support/sho-support.github.io/actions/runs/43629541197 は成功。

- 実配備済みの5関数を取得し、各関数の実際の依存ファイルとJWT設定を保って、接続/戻り先だけを修正した。新しい商用DB機能を古いDBへ混在配備していない。
- 注文/顧客/復旧APIに検証済みCloudflareオリジンを追加。注文のpreflightにはSDKが送るAuthorizationも追加した。旧Netlify接続は維持。
- 顧客確認・素材・更新・プレビュー内のページ移動と招待/復旧リンクを、確認済みのリクエスト元に合わせる。任意のOriginやnextへの転送は禁止。既存GitHub/server呼出しの戻り先は旧Netlifyのまま。
- 旧バンドルには凍結契約と新しい公開プロトコルがないため、Cloudflareからの実注文作成/旧管理更新は `sales_release_pending` で止める。見積り/公開/AIを、旧処理へ迂回させて有効化しない。
- Cloudflareの復旧/招待はAuthの許可先確認後にだけ有効化する。未確認なら復旧回数を消費したりメールを送る前に止める。公開画面では受付準備中と案内する。
- DB/Storage/R2/DNS/Cloudflare契約は変更せず、実通知・メール・AI・決済は発生させていない。

| 関数 | 配備版 | JWT設定 | バンドルSHA256 |
|---|---|---|---|
| website-order-api | 17 | falseを維持 | ed95e63fae81529d90cca24417c43a6481a8a10a249e3d7d501af8abc85c55bd |
| website-customer-access | 54 | falseを維持 | 2b4df5f3f994cf78d9213807f3bdc0b8ce9406212238ddd849df63ca6e58e457 |
| website-password-recovery | 7 | falseを維持 | d34c091db897af9be64bb9ed6a99306ad3d529cf97b0789197f3a7822f9a8fb4 |
| website-api | 52 | trueを維持 | f2d30d89a24a11ceccbbe3cd25096cddeb354c3eea4f6f406f6f60e74ade2795 |
| website-preview | 14 | falseを維持 | 0a4a8b59b22c0a4132b2b61fa2ec46e6423b9144ca578220bf28e52481f5277f |

全5関数を配備後に再取得し、予定した全ファイルとの完全一致を確認。各旧 `_shared/website.ts` はバイト単位で不変。元バンドルは `sales-hosting/runtime-baseline`、配備ソースは `sales-hosting/runtime`、詳細は `runtime-migration.json`。

## 検証結果

- 正確な配備バンドルの隔離HTTP試験16件合格。Cloudflare/旧Netlify接続、偽装Origin拒否、匿名管理者拒否、実顧客キー判定、戻り先、未準備時の通知/旧処理停止、復旧回数制限を確認。
- 商用/公開の隔離HTTP試験21件合格。3プラン、承認前公開拒否、顧客隔離、素材/資源制限、設定保存/準備判定など。
- SQL+workerd/R2の隔離試験11件合格。3プランの公開→更新→巻戻しと通信断時の回復を含む。実本番で通ったという意味ではない。
- 正本Edge Functionsの型検査、料金9画面同期、build24項目、Wrangler配備前検査が合格。
- 配備後の実HTTPSでは注文/顧客/設定/復旧の4件ともCloudflareを許可し、SDK Authorizationを許可。無効入力400、匿名管理読取401、無関係Origin403、旧Netlify維持を確認。注文・顧客サイトはともに0件のまま。
- 新しい静的フロントの再配備と実HTTPS54項目の再検査も合格。CI https://github.com/sho-support/sho-support.github.io/actions/runs/43630074052 は全体成功。ソース `9d09725237ef295da5b50feec1edb94caa1883cd`、Worker版 `c964e1c0-333b-43f1-b077-a9b275165628`。検索対象外の検証公開を維持。

## 認証設定の現在地

Supabase管理画面へ本人がGitHubを選択してログインし、HP販売プロジェクトのURL Configurationを実見した。承認されたCloudflareのパスワード設定ページ用パターンを保存し、既存GitHub/Netlifyの2件とSITE_URLを維持したまま3件になったことを確認した。

復旧/招待の接続先は確認済みの公開URLとしてコード内の配備設定で管理する。Secrets画面へのアクセスや環境フラグの作成は不要。認証後の戻り先の許可設定を変える場合は先にこの公開確認設定を無効化し、再確認する。

次の本人確認はSHO WEB SUPPORT自身の管理者ログインと設定保存であり、Supabase管理画面のGitHubログインとは別。登録済みアカウントを用い、本人の事業者情報/振込先を下書き保存する。実バックアップ未実施のチェックを代入しない。パスワードはチャットへ出さない。

再設定を選ぶ場合、本人が登録アドレスへのメールを受け取り、本人操作でパスワードを入力する必要がある。実メール到着・パスワード変更は未確認であり、配備成功に読み替えない。

## 最終通し試験前の残件

接続と旧リンク修正は実装したが、販売完成ではない。本人情報と条件、正式な自社管理ドメイン、本番非公開R2と権限/期限、実DB/Auth/Storage/R2/ソースの暗号化別保管/復元、3追加migrationと対応する新しい全関数の一括反映が残る。準備完了後、3プランで見積り・同意・入金確認・素材・制作・承認・公開・更新・巻戻しを通す。

セキュリティ助言のうちprivateテーブルのRLS/no-policyはサーバー経由専用のため維持。既存 `pg_net` 配置と漏えいパスワード保護の警告は今回変更していない。認証/課金/拡張の変更を接続修正へ混ぜない。

公式資料：
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/functions/cors
- https://developers.cloudflare.com/workers/static-assets/

## 承認後の復旧先設定

本人が「最善ならいい」と承認したため、Cloudflareのパスワード設定ページ用パターンを保存。保存後の再読取でも3件の許可先と既存SITE_URLの維持を確認した。

Secrets画面への移動は自動承認レビューが拒否した。既存の秘密情報へアクセスせず、実画面で確認した公開URLを `_shared/auth-redirect-confirmation.ts` の配備設定として扱う方式へ変更した。秘密値/環境フラグの読取・変更は行わない。認証・現在の管理者照合・厳密なOrigin・既存復旧回数制限は維持する。

ソース `f7b96aeda421da23747a851b83ba19652c2434de`。配備後の読戻しで全ファイル一致。`website-password-recovery` v7 / SHA256 `d34c091db897af9be64bb9ed6a99306ad3d529cf97b0789197f3a7822f9a8fb4`、`website-api` v52 / SHA256 `f2d30d89a24a11ceccbbe3cd25096cddeb354c3eea4f6f406f6f60e74ade2795`。他3関数と静的Workerは再配備しない。

CI https://github.com/sho-support/sho-support.github.io/actions/runs/43631866469 は全体成功。隔離48件/型検査/buildに加え、既存公開先の静的54項目と4 APIの安全な読取/検証も合格。実注文・メール・AI・決済は起こしていない。実メール到着とHP販売自身の本人ログインは、この結果に含めない。

以後、以前の手順の `WEBSITE_AUTH_REDIRECT_ORIGIN` 作成は不要。Secrets画面へ入り直したり、承認レビューを回避する秘密情報取得をしない。Authの許可URLを変える場合は、先に公開確認設定を無効にして確認し直す。


## 本人がいま始められるテスト（同日追記）

実ブラウザーで販売トップから制作内容フォームのデモへ移動し、ダミーのサイト名 `公開前テスト 20261115` を入力。画面を再読み込みし、基本情報を開き直して同じ値が残ることを確認した。`prod=1` のないデモであり、これは同じブラウザーの端末保存の確認。実DB保存、顧客受付、LINE送信、公開の成功には数えない。

- 料金と表示の確認： https://sho-web-support-preview.zodiac-suu.workers.dev/
- 制作内容の入力デモ： https://sho-web-support-preview.zodiac-suu.workers.dev/website-intake?id=DEMO
- 本人設定： https://sho-web-support-preview.zodiac-suu.workers.dev/admin/sales-settings

入力デモは架空のサイト名で試す。本人設定は管理者本人のログイン後、実際の販売者情報・振込先・承認済み条件を下書き保存する。2026-11-15のDB確認では注文0、サイト0、sales_identity / bank_transfer / commercial_policy / sales_backup_attestation は未登録。復旧先設定の保存成功と、HP販売アプリ自身のログイン成功を混同しない。

## 正式ドメイン候補の実見積り（購入前）

Cloudflare公式の公開検索で `sho-websites.com` の購入ボタンと料金を実見した。表示は初年度 US$11.17、更新 US$11.17/年。2026-11-15時点の見積りであり、税・円換算・決済総額・将来の価格は未確認。購入、利用規約の承諾、支払情報の入力、DNS変更はいずれも行っていない。旧資料にある「価格未確認」はこの公開見積りまで進んだが、最終決済の確認を意味しない。

https://www.cloudflare.com/domains/search?q=sho-websites.com
https://pricing.registrar.cloudflare.com/

提案は、事業側がこの1ドメインを管理し、顧客の無料URLを `s{数値の案件番号}.sho-websites.com` にする構成。販売画面のホスト名は本人の名称承認後に確定する。この構成は未適用。顧客ごとに本体ドメインを買い足す提案ではない。お客様名義の独自ドメインは別途実費とする。

## 次に必要な判断と実作業

1. 本人が販売者情報・振込先・契約条件を管理者専用画面で登録する。認証情報や口座番号はチャットに貼らない。
2. 正式ドメイン名と購入上限を本人が決める。候補の検索結果だけを根拠に購入しない。
3. 本番専用の非公開R2と期限を含む適切な権限を用意し、実データ一式の暗号化別保管と空環境への復元を行う。30日限定の検証用S3キーを恒久運用へ流用しない。
4. 保管・復元と互換性を確認した上で、保留中の3 migration と対応する正式関数を一括反映し、新しい実注文の停止条件を解除できるか判定する。
5. 架空案件で3プランの見積り→同意→管理者の入金確認→素材→制作→顧客承認→公開→更新→巻戻しを通す。実送信・支払・有料AIが伴う箇所は事前に範囲を定める。

現段階は画面・入力デモの確認開始可。販売完成を前提にした実環境の最終通し試験は未開始。正式な販売開始日・完了時刻はまだ確約できない。
