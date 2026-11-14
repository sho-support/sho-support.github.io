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

- `scripts/build-sales-cloudflare.mjs` が既存の販売用buildと23項目の料金/リンク検証を再利用し、販売画面だけを `dist-cloudflare` へ出力する。今回の出力は40ファイル、537,476バイトと `_headers`。
- SQL、内部文書、バックアップ、秘密ファイルは公開パッケージに含めない。公開パス・サイズ・SHA256を公開対象外のmanifestに記録する。
- 静的配信のみ。独自Workerコード、R2やDBのbinding、DNS routeを持たない。検索対象外/no-sniff/referrerの設定を既存Netlifyから引き継ぐ。
- 既存の固定バージョンWrangler `4.160.0` とlockfileを再利用する。有料サービスを追加しない。
- 初回の配備は固定名のWorkerが存在しないことを確認してから行う。名前が既に使用中なら停止し、他のWorkerを上書きしない。通常のpushは検証のみで、配備は専用のコミット指定時だけ行う。
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
3. 現在のAPIはNetlify/GitHubのOriginを許可している。今回の検証先からのOPTIONSが403のままであることを確認する。全ドメイン許可や旧Originへの偽装プロキシで回避しない。正式URLが決まったら、その1件だけを対象にAPI許可先とAuthの戻り先を準備する。
4. 実ユーザーのログイン・復旧メール・管理者権限、見積り/注文/素材/顧客確認、本人設定の保存を検証する。設定APIは現在v1で、今回本番関数は配備しない。
5. 料金9画面、契約保存、実バックアップ、本番R2/独自ドメイン、追加migration等の既存残件を完了する。実通知・有料AI・決済を勝手に起こさない。
6. 旧URLのリンク・通知・再送/復旧経路を照合し、戻せる状態で切り替える。その後にNetlifyの残し方を判断する。Cloudflareへ画面を置くだけで顧客URLやコード権利の引継ぎが完成するとは扱わない。

## 検証結果

ローカルの料金同期、build内の既存23項目、40ファイルの公開範囲・サイズ、Wrangler配備前検証は合格。実配備・実HTTPS・画面確認の結果は取得後に追記する。
