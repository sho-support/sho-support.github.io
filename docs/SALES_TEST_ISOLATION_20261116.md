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

### 1. 本番用R2

登録済みのREST APIを使った前回の空バケット作成はHTTP 403で拒否された。作成済みとは確認できておらず、同じ権限で再試行はしていない。プレビュー用バケットやその限定キーを本番へ昇格しない。

1. [CloudflareのR2一覧](https://dash.cloudflare.com/bdb1bb4a771be8595d5564d5d78cb1d4/r2/overview)を開く。
2. 「バケットを作成」で `sho-customer-sites-production`、ストレージクラス **Standard** を指定する。
3. 公開URL・r2.dev・カスタムドメインは有効にせず、非公開のまま作る。
4. R2のAPIトークン作成で **Object Read & Write**、**特定のバケットのみ**を選び、このバケットだけを指定する。
5. 発行した2つのキーはチャットへ送らず、[対象プロジェクトのSecrets](https://supabase.com/dashboard/project/tyhymvgjkoebetyypspj/functions/secrets)へ設定する。

| Secret名 | 値 |
|---|---|
| CUSTOMER_R2_ACCOUNT_ID | bdb1bb4a771be8595d5564d5d78cb1d4 |
| CUSTOMER_R2_BUCKET | sho-customer-sites-production |
| CUSTOMER_R2_ACCESS_KEY_ID | 今回作成したバケット限定キーのAccess Key ID |
| CUSTOMER_R2_SECRET_ACCESS_KEY | 同じキーのSecret Access Key |

キー設定だけでは本番受付を開始しない。`WEBSITE_CUSTOMER_HOSTING` は別の切替手順で最後に有効化する。

### 2. 正式URLと保全

顧客用標準URLのドメインの選択・所有・DNS/HTTPS確認が必要。未承認のドメイン購入はしていない。バンド用ドメインを変更せず、プレビューURLを永続納品URLとして固定しない。

実DB/Auth/Storage/R2の別保管と空環境への復元も必要。現時点では安全なDB接続と本人管理の保管先が未設定。合成DBの暗号化復元試験、Edge Functionのソース控え、GitHubのコード保管を実データ全件のバックアップとして代用しない。

これらの準備後に、3migrationと互換バックエンドを[切替手順](SALES_CUTOVER_RUNBOOK_20261116.md)で反映し、受付→制作→SHO承認→顧客確認→公開/納品の実サービス通し試験へ進む。本番販売開始には実口座と販売条件の承認も必要。テスト銀行0000000と保存済み販売者情報は現在のまま保持する。

## 一次資料

- [Cloudflare R2：S3のバケット・限定キー作成](https://developers.cloudflare.com/r2/get-started/s3/)
- [Cloudflare R2：作成APIの必要権限](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/)
- [実データの保全・復元手順](../customer-hosting-v2/BACKUP_OPERATIONS.md)
