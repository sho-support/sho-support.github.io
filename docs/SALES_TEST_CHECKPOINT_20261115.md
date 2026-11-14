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
| website-password-recovery | 6 | falseを維持 | 2b826d5181462fb604da6599f3b006a84cefa8ed625ce1bdbd584ea8770d24cf |
| website-api | 51 | trueを維持 | 65e103071633bde2da183d0a46bf44592857980f47d0091406bb1538749cf2b7 |
| website-preview | 14 | falseを維持 | 0a4a8b59b22c0a4132b2b61fa2ec46e6423b9144ca578220bf28e52481f5277f |

全5関数を配備後に再取得し、予定した全ファイルとの完全一致を確認。各旧 `_shared/website.ts` はバイト単位で不変。元バンドルは `sales-hosting/runtime-baseline`、配備ソースは `sales-hosting/runtime`、詳細は `runtime-migration.json`。

## 検証結果

- 正確な配備バンドルの隔離HTTP試験16件合格。Cloudflare/旧Netlify接続、偽装Origin拒否、匿名管理者拒否、実顧客キー判定、戻り先、未準備時の通知/旧処理停止、復旧回数制限を確認。
- 商用/公開の隔離HTTP試験21件合格。3プラン、承認前公開拒否、顧客隔離、素材/資源制限、設定保存/準備判定など。
- SQL+workerd/R2の隔離試験11件合格。3プランの公開→更新→巻戻しと通信断時の回復を含む。実本番で通ったという意味ではない。
- 正本Edge Functionsの型検査、料金9画面同期、build24項目、Wrangler配備前検査が合格。
- 配備後の実HTTPSでは注文/顧客/設定/復旧の4件ともCloudflareを許可し、SDK Authorizationを許可。無効入力400、匿名管理読取401、無関係Origin403、旧Netlify維持を確認。注文・顧客サイトはともに0件のまま。
- 新しい静的フロントの再配備と実HTTPS54項目の再検査も合格。CI https://github.com/sho-support/sho-support.github.io/actions/runs/43630074052 は全体成功。ソース `9d09725237ef295da5b50feec1edb94caa1883cd`、Worker版 `c964e1c0-333b-43f1-b077-a9b275165628`。検索対象外の検証公開を維持。

## 本人確認が必要な具体的な箇所

SupabaseコネクタにはAuth URL設定の読取/更新機能がないため、管理画面を開いたが、Supabase自身へのサインイン画面になった。設定変更、ログイン試行、メール送信はしていない。Cloudflareのブラウザログインとは別件であり、Cloudflareの再認証やAPI再作成は求めない。

認証後の設定先は、HP販売プロジェクトの Authentication → URL Configuration。

1. 復旧/招待で使う `https://sho-web-support-preview.zodiac-suu.workers.dev/website-password.html` とクエリ付きの戻り先を、公式のRedirect URLs仕様に合わせて確認する。SITE_URLを勝手に置き換えず旧URLも残す。
2. 実際の許可先確認後だけ `WEBSITE_AUTH_REDIRECT_ORIGIN` を上記Cloudflareのオリジンに設定する。フラグの設定だけをAuthや実メール検証の代わりにしない。
3. SHO WEB SUPPORT自身の管理者ログインと、本人の事業者情報/振込先の下書き保存を確認する。パスワードはチャットに出さない。実バックアップ未実施のチェックを代入しない。

## 最終通し試験前の残件

接続と旧リンク修正は実装したが、販売完成ではない。本人情報と条件、正式な自社管理ドメイン、本番非公開R2と権限/期限、実DB/Auth/Storage/R2/ソースの暗号化別保管/復元、3追加migrationと対応する新しい全関数の一括反映が残る。準備完了後、3プランで見積り・同意・入金確認・素材・制作・承認・公開・更新・巻戻しを通す。

セキュリティ助言のうちprivateテーブルのRLS/no-policyはサーバー経由専用のため維持。既存 `pg_net` 配置と漏えいパスワード保護の警告は今回変更していない。認証/課金/拡張の変更を接続修正へ混ぜない。

公式資料：
- https://supabase.com/docs/guides/auth/redirect-urls
- https://supabase.com/docs/guides/functions/cors
- https://developers.cloudflare.com/workers/static-assets/
