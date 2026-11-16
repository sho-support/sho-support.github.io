# HP販売：LINE受付テストの分離と残る本人設定（2026-11-16 JST）

[受付テスト画面](https://sho-web-support-preview.zodiac-suu.workers.dev/admin/readiness.html)で、既存管理者が「テスト文を公式LINEで開く」を押し、入力済みの注文IDと連携コードを残したまま送信する。注文IDは `9000001001`。振込は不要。受付返信と画面再読み込み後のLINE連携表示を確認する。本人による実機送受信は未確認。

## 今回反映した内容

- 予約テスト注文は、旧管理経路・Originなしの管理API・新しい公開処理のいずれでも、正式見積り、入金確認、URL予約、同意記録、ヒアリングURL再送に進めない。ログインと管理者確認を行った後に409 `line_receipt_test_only` で止める。
- LINE返信は本番口座の有無にかかわらず「接続テスト専用」。明示された許可リストに一致するときだけテスト口座を表示する。許可リストがない場合も実注文の案内へ戻さず、テスト用口座が未設定と返信する。
- 注文一覧ではテスト専用カードとして表示し、正式見積り・入金確認・案件作成の操作を出さない。実注文の3種類の件数からも除外する。
- 正本のLINEソースに残っていた、数字だけの注文IDを認識しない古い正規表現と、実在しない相対importも修正した。実配備では既存のプロバイダー認証ヘルパーをそのまま保存して使用する。
- `website-customer-access` はv55、`website-line-webhook` はv21へ配備。全7ファイルを読み戻して検査済みソースと一致することを確認。署名検証、管理者認証、JWT設定は保持した。DB migration・有料AI・本番公開への切替は行っていない。

## 確認できた範囲

[検査済みソースのCI](https://github.com/sho-support/sho-support.github.io/actions/runs/43844824494)で、単体147件、workerd14件、Supabaseラッパー3件、組込みSQL43件（ネイティブ限定2件スキップ）、PostgreSQL本体47件、SQL/R2通し11件、実HTTPハンドラー22件が成功した。

実配備用のエントリーポイントを動かす隔離検査24件も成功。署名付きの架空LINE入力、連携コード不一致、別LINEからの再連携拒否、通常の数字注文IDの受付、旧管理経路でのテスト注文拒否、既存ヘルパーの全バイト保持を確認した。外部LINEへの実トーク送信ではない。

同CIで6画面幅の契約156件・維持費/受付テスト画面372件・パスワード198件が成功し、320px/1366pxのテスト注文カードを目視した。戻りリンクのタップ領域が44px以上あることも6画面幅で検査済み。最終の320px/1366px画像を再度目視した。[配備後の実配信検査](https://github.com/sho-support/sho-support.github.io/actions/runs/43844824570)では57静的検査、5 APIの認証保持、署名なしWebhookの401拒否も確認した。配備内容は[機械可読記録](../sales-hosting/line-test-isolation-deployment.json)を参照。

以前の実LINE接続検査はWebhook v20の記録。v21のHMAC処理は変更していないが、その過去の記録をv21で再検査済みとは扱わない。管理者用画面の「LINE接続を確認する」はLINEから署名付き空Webhookを送る接続検査で、顧客へのトーク送信ではない。

## 残る本人設定と止まっている理由

### 1. 本番用R2：接続検証完了

本人が作成した `sho-customer-sites-production` と本番バケット限定キーを使い、[実環境の検証](https://github.com/sho-support/sho-support.github.io/actions/runs/43886319809)に成功した。

- RESTメタデータでStandard・r2.dev無効・有効なカスタムドメイン0件を確認した。作成APIの再実行や公開設定変更はしていない。
- Supabaseに保存したキーで、予約済みの架空ID `9000001002` のランダムな検証用オブジェクトだけを条件付き作成し、HEAD・SHA-256・全バイトの読み戻しを検査した。最後に同じオブジェクトだけを削除し、HEADの404を確認した。公開pointerや顧客データには触れていない。
- 同じキーでプレビュー用バケットの検証用パスをHEADし、403拒否を確認した。キーの値・長さ・ハッシュは出力していない。
- 保存したアカウントIDとバケット名には前後の空白があった。共通S3トランスポートと管理者用準備確認でこの2項目だけをtrimするよう修正し、保存済み設定のまま再検証に成功した。認証キーの値は変更していない。準備確認関数v9は配備・全ファイル照合済み。商用バックエンド6関数は修正済み候補であり、切替は未実施。
- 検証の一時CI権限は解除し、専用関数v6は常時403を返す閉鎖済みソースへ置換した。全配備ソースを読み戻して照合した。汎用resource-qaは閉じたまま。

[検証記録](qa/sales-production-r2-connectivity-20261116.json)と[閉鎖記録](../sales-hosting/production-r2-verification.json)を保存した。[修正後の全体CI](https://github.com/sho-support/sho-support.github.io/actions/runs/43886319719)も成功。単体147件、Supabase実ラッパー4件、PostgreSQL本体47件、実HTTPハンドラー22件と6画面幅のUI検査を再確認した。

追加のキー再入力は不要。`WEBSITE_CUSTOMER_HOSTING` は無効のまま保持している。

### 2. 正式URLと保全

顧客用標準URLのドメインの選択・所有・DNS/HTTPS確認が必要。未承認のドメイン購入はしていない。バンド用ドメインを変更せず、プレビューURLを永続納品URLとして固定しない。

実DB/Auth/Storage/R2の別保管と空環境への復元も必要。実環境の接続・全量取得・本人管理の別保管先・空環境への復元は、まだ一式の実行証拠を確認していない。合成DBの暗号化復元試験、Edge Functionのソース控え、GitHubのコード保管を実データ全件のバックアップとして代用しない。

これらの準備後に、3migrationと互換バックエンドを[切替手順](SALES_CUTOVER_RUNBOOK_20261116.md)で反映し、受付→制作→SHO承認→顧客確認→公開/納品の実サービス通し試験へ進む。本番販売開始には実口座と販売条件の承認も必要。テスト銀行0000000と保存済み販売者情報は現在のまま保持する。

## 一次資料

- [Cloudflare R2：S3のバケット・限定キー作成](https://developers.cloudflare.com/r2/get-started/s3/)
- [Cloudflare R2：作成APIの必要権限](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/)
- [実データの保全・復元手順](../customer-hosting-v2/BACKUP_OPERATIONS.md)
