# 販売画面のCloudflare統一を検証する

2026-11-14 JST。Netlifyを有料化する前に、既存のHP販売画面をCloudflare Workers Static Assetsで配信できるか検証する。既存の販売機能・料金正本・GitHubのコード保管・Supabaseの顧客管理は維持する。Netlifyの継続契約を必須費用とは扱わない。

## 役割と範囲

| 対象 | 今回の扱い |
|---|---|
| SHO自身の販売ページ、注文画面、管理画面 | `sho-web-support-preview` という独立した静的検証先を用意 |
| 顧客に納品するHP | 既存の顧客用Worker/R2/正式ドメイン計画を維持。今回の配備では接続・変更しない |
| 既存Netlifyサイト | 公開版を保持。切替・削除・有料化・支払方法登録なし |
| システム販売 SHO VIDEO STUDIO | 別リポジトリ・別Supabase。今回の検証結果だけで移行済み・同一利用枠と扱わない |

この検証のソースは開発ブランチ `3bf5bbb7bda6f265b81ffc91f03e3993234550ab`。Netlify向け限定リリース `9c7f4da` より新しい維持費・契約表示を含むが、対応する本番API・DB移行がすべて反映済みという意味ではない。mainと既存Netlifyの本番ブランチは更新しない。

## 実装

- `scripts/build-sales-cloudflare.mjs` が既存の販売用buildを再利用し、販売画面だけを `dist-cloudflare` へ出力する。初回は23項目、後記の実例枠の確認を追加した版は24項目。出力は40ファイルと `_headers`。
- SQL、内部文書、バックアップ、秘密ファイルは公開パッケージに含めない。公開パス・サイズ・SHA256を公開対象外のmanifestに記録する。
- 静的配信のみ。独自Workerコード、R2やDBのbinding、DNS routeを持たない。検索対象外/no-sniff/referrerの設定を既存Netlifyから引き継ぐ。
- 既存の固定バージョンWrangler `4.160.0` とlockfileを再利用する。有料サービスを追加しない。
- 初回の配備は固定名のWorkerが存在しないことを確認してから行う。以後の更新は、直前に記録した版が100%配信中であることを照合してから行い、違う版なら停止する。他のWorkerを上書きしない。通常のpushは検証のみで、配備は専用のコミット指定時だけ行う。
- 実HTTPS試験では公開全ファイルの内容・MIME・ヘッダー、拡張子なし/管理画面パス、非公開ファイルの404、HEADを確認する。

## 商用条件・費用・継続性

Cloudflare公式資料でHTML等の静的配信と保管は無料、静的配信以外のWorker処理は別の利用料金・上限に従う。今回の構成には独自の実行処理やストレージbindingを追加しない。これはSupabase、顧客用R2、ドメイン、AIなどの費用がすべて無料という意味ではない。

Developer Platformの条件ではコンテンツのホスティング、利用者への提供、ソースの権利保持を確認した。違法コンテンツ等の禁止・運営者のサポート責任・利用制限は引き続き適用される。`workers.dev` は事業者側の都合で変更され得るため、今回のURLは検証用であり、顧客に永続性を約束する正式URLには使わない。本番の継続性は自社管理ドメインで確保する。

- https://developers.cloudflare.com/workers/static-assets/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://www.cloudflare.com/service-specific-terms-developer-platform/

## 本番切替前の残件

1. 実配備のURLとHTTPS試験結果を記録し、PC/スマホ幅で表示を確認する。静的表示成功だけで販売可能とは扱わない。
2. 正式な販売用URLを確定する。既存 `sho-support.com` のDNS・メール・バンドは変更しない。購入が必要なら名称・初年度/更新総額・名義を実見積りで確認する。
3. 現在のAPIはNetlify/GitHubのOriginを許可している。検証先からのOPTIONSは403、またはHTTP200でも許可Originが旧URLのままでブラウザは接続できない。さらに、未対応の無処理アクションによるPOSTもサーバーが403にすることを確認する。全ドメイン許可や旧Originへの偽装プロキシで回避しない。正式URLが決まったら、その1件だけを対象にAPI許可先とAuthの戻り先を準備する。
4. 実ユーザーのログイン・復旧メール・管理者権限、見積り/注文/素材/顧客確認、本人設定の保存を検証する。後記のとおり設定APIだけをv2へ更新し、検証済みCloudflareオリジンを1件追加した。その他の本番関数は配備していない。
5. 料金9画面、契約保存、実バックアップ、本番R2/独自ドメイン、追加migration等の既存残件を完了する。実通知・有料AI・決済を勝手に起こさない。
6. 旧URLのリンク・通知・再送/復旧経路を照合し、戻せる状態で切り替える。その後にNetlifyの残し方を判断する。Cloudflareへ画面を置くだけで顧客URLやコード権利の引継ぎが完成するとは扱わない。

## 検証結果

ローカルの料金同期、build内の既存23項目、40ファイルの公開範囲・サイズ、Wrangler配備前検証は合格。

初回CI https://github.com/sho-support/sho-support.github.io/actions/runs/43562183566 は配備前検証と配備に成功。URLは https://sho-web-support-preview.zodiac-suu.workers.dev 、版は `75dae493-44ef-4049-aaf6-e35604bc54a1`、ソース `d1ba1869629db8e6a1b8e1aafb1d09008558f3e7`。

最初のHTTP試験では静的配信54項目を通過後、APIの拒否応答にも `Access-Control-Allow-Origin: *` を付ける既存共通エラー処理に対する試験の仮定が誤っており停止した。実際には注文API/設定APIのOPTIONSは403、顧客APIのOPTIONSは200だが許可Originは旧Netlifyとなる。403のエラーを読めることやOPTIONSがHTTP200であることと、操作が受理されることは別なので、ブラウザの接続不可と、無処理POSTの明示的な `403 / Forbidden` を確認し、実際のヘッダーも記録するよう修正した。本番APIの認証やOrigin判定は変更しない。初回CI全体を合格とは扱わない。

通知/確認/素材/更新のリンクにもNetlify直書きがあるため、CORSだけ直して移行完了とは扱わない。`website-customer-access` のリンク生成と `website-preview` のプレビュー戻り先を、正式販売URL確定後に揃える必要がある。再試験と画面確認の結果は取得後に追記する。再試験専用ジョブは認証情報を使わず、再配備もしない。

実ブラウザ確認で、制作実例のiframeが移行先自身の `index.html` を再帰表示する不具合を発見した。既存buildがバンド向けhrefだけを書き換え、srcを相対URLのまま残していたため。バンドページのsrcも既存GitHub Pagesへ向ける修正と、埋め込み先の回帰チェックを追加した。バンド本体のHTML・DNSは変更しない。

修正後CI https://github.com/sho-support/sho-support.github.io/actions/runs/43562980229 は全体成功。ソース `3a46dae38a804ca5ada8041d6c3856ca6ea81f2a`、Worker版 `3a489aee-ffff-4160-8202-f773c3178dd7`。静的40ファイル/537,566バイト、build24項目、実HTTPS54項目、既存API3件の未許可Origin拒否を確認した。再配備前に初回版が100%配信中であることも照合した。

実ブラウザでは幅1363pxで横はみ出しなし。修正後の実例枠がGuns N' Loses公式サイトを表示し、トップと申込画面の年6,000円/初年度込み/自動課金なしを確認。匿名で設定画面を開くと同じCloudflareオリジンの運営者ログインへ誘導された。ログイン実行・設定保存・実注文送信は未実施。今回のCloudflare公開先でのスマホ幅の実画面確認は未実施。

追加の読み取りで `website-password-recovery` v5にもNetlify固定のOriginと復旧後URLがあることを確認した。これも正式URL確定後の変更対象。再配備不要の確認対象へ追加する。本番の既存API/worker/customer-access/preview/order-api/resource-qa/設定APIの版は変わらず、実DBの注文0・顧客サイト0も確認した。

4件目の復旧APIはOPTIONSが204となる。HTTP200だけを想定した再試験 https://github.com/sho-support/sho-support.github.io/actions/runs/43563918506 は停止したため合格と扱わない。200/204の正常なpreflightと許可Originの不一致、無処理POSTの拒否を区別するよう修正し、https://github.com/sho-support/sho-support.github.io/actions/runs/43564267619 で54項目とAPI4件の未接続確認がすべて成功した。追加配備は行っていない。

## 本人設定画面の接続だけを追加

Netlifyの公開待ちで本人入力が止まらないよう、検証用Cloudflareオリジンを `website-sales-setup` の許可先に1件だけ追加した。既存v1の実配備ファイル15個を取得し、entrypointの許可先1行だけを変更。他14ファイル・getUser・現在の管理者照合・操作3種類の制限はそのまま。JWT検証設定も従来どおりで、関数内の実ユーザー認証と管理者権限が必要。

- ソース：`f9aaf2e6336079262bbbd296e7a4985cbd8282a0`。
- 配備済み設定API：v2、SHA256 `60fcbcf665c2d20c75a234f2f8f02d616c92c887fcea23470b5e2bea53d5ad65`。
- CI https://github.com/sho-support/sho-support.github.io/actions/runs/43564662015 は成功。静的54項目、注文/顧客/復旧API3件の接続拒否と、設定APIのCloudflare接続・匿名読取401・無関係Origin403・旧Netlify接続維持を確認した。
- この確認は認証情報を使わず、再配備も行わない。本人のログイン・実情報保存は未実施であり、本人入力が必要。新しい顧客見積りや公開を有効化しない。
- 設定入力先：https://sho-web-support-preview.zodiac-suu.workers.dev/admin/sales-settings.html 。匿名時は同じCloudflareサイトの運営者ログインへ移動する。
- 注文/顧客/復旧APIの接続、通知リンク、Authの復旧メールの戻り先、正式ドメイン/本番R2/実バックアップ等は残件。システム販売側は別管理のまま未移行。

機械可読な証跡は `docs/qa/sales-cloudflare-preview-20261114.json`。実画面は同名の `.jpg`。今回のホスティング確認をもって販売開始完了とは扱わない。

## 本人ログインの現在地

安全な認証入力を用いて運営者ログインを試行したが、画面はログイン失敗を表示し、アプリのエラー種別は `invalid_credentials` だった。ログイン成功・設定読取/保存は未完了。パスワードやトークン値は取得せず、自動再試行もしていない。この本人確認は、SHO WEB SUPPORTの管理画面を実ユーザーで検証するための別残件として保持する。

本人から「CloudflareにログインできないためAPIを作成済み」と再確認があった。Cloudflareへの検証配備は実際に保存済みAPIトークン経由で成功しており、その作業にCloudflareのブラウザ再認証を求めない。許可範囲内のCloudflare作業をAPIで進める。CloudflareのAPIトークンとSHO WEB SUPPORTの管理者ログインは別の認証であり、前者で後者の権限確認を迂回しない。

復旧APIの戻り先はまだ旧Netlifyに固定されているため、Cloudflare側の再設定リンクを検証済みとは案内しない。再設定メールの送信・パスワード変更・管理者の差替え・Auth設定変更は行っていない。本人が再設定を選ぶ場合は、既存の復旧経路と戻り先を確認してから本人操作で進める。
