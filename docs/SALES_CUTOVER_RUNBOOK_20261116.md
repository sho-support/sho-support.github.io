# HP販売の切替・復旧手順（2026-11-16 JST）

本書は実行準備であり、切替完了の記録ではない。対象は `tyhymvgjkoebetyypspj` のHP販売だけ。バンド、他の販売サービス、TrendBlog、現在のDNSを一括で変更しない。

実環境の最新照合、Authの隔離復旧、復元DBでのmigration検査は[保全と切替の記録](SALES_RECOVERY_AND_CUTOVER_20261119.md)を参照。商用配備と切替直前の照合は、未入金の取り消しを含む[11月20日候補manifest](../sales-hosting/release-candidate-20261120.json)を基準にする。旧候補の版と復旧証跡は引き続き履歴として参照できる。

## 固定した候補

- 11月20日候補は、7関数・依存38ファイル・3migrationと、切替前へ戻す37ファイルを固定した。追加の `website-line-webhook` は、取り消し後に同じ注文IDのLINE受付で注文を再開させないために含める。切替前の7関数の版・JWT設定・配備bundleのハッシュを実環境と照合した。[隔離DB・画面の検証](https://github.com/sho-support/sho-support.github.io/actions/runs/44672871412)・[隔離LINEの検証](https://github.com/sho-support/sho-support.github.io/actions/runs/44672871499)
- [release-candidate.json](../sales-hosting/release-candidate.json) に、コミット `c3c3af8114773a22b3f4d442dc0888908d02ee1e` の6関数・依存を含む37ファイル・3migrationのSHAを記録。候補はローカルの全該当ファイルをGitHubの同一コミットと照合したもの。接続テストの分離修正後、現行のcustomer-accessはv55となったため、その配備SHAも候補manifestの切替前照合へ更新。過去のプレビュー配備を本番切替済みと扱わない。
- JWT設定は `website-api` と `website-worker` がtrue、`website-customer-access`、`website-order-api`、`website-preview`、`website-sales-setup` がfalse。falseの関数も内部の本人・管理者確認を維持する。
- 販売画面の確認先は [販売プレビュー](https://sho-web-support-preview.zodiac-suu.workers.dev)。11月20日の管理画面・無料試作・合意済みの契約文面の配備元と版は、[販売プレビューの配備記録](../sales-hosting/preview-deployment.json)を参照。静的60項目、5 APIの事前通信と認証・入力拒否、署名なしWebhookの401を確認した。[実環境の配備検証](https://github.com/sho-support/sho-support.github.io/actions/runs/44677238024)

## 実行前に必要なこと

1. [バックアップ手順](../customer-hosting-v2/BACKUP_OPERATIONS.md)どおりに実環境の保全・別保管・空環境での復元を終える。合成DBの47テストやコードの保存を代用しない。
2. `sho-customer-sites-production` は本人作成後にStandard・非公開を実検証済み。[検証記録](qa/sales-production-r2-connectivity-20261116.json)を切替時点の対象と照合する。過去の作成APIの403を現在のバケット不存在と扱わない。
3. 上記バケット限定のObject Read & Write鍵は本人がSecrets保存済み。実際の書込み・メタデータ・全バイトの読戻し・削除と、プレビューバケットHEADの403拒否を検証済み。ID/バケット名の前後空白だけを除去する修正を候補へ含めた。鍵自体は加工せず、チャットや公開Gitに貼らない。
4. `sho-websites.com` は2026年11月20日に本人が取得した。実DNS・HTTPS・配信Workerを照合済みで、標準URLは `https://s<サイトID>.sho-websites.com/` とする。[専用ゾーン設定と検証結果](../customer-hosting-v2/DNS_CUTOVER_CHECKLIST.md)
5. 本番振込先へ差し替え、契約原案と実バックアップの確認記録を本人が承認。テスト銀行 `0000000` のまま販売条件を有効化しない。

## 切替の順序

1. 対象プロジェクト・各関数version/SHA・migration履歴・注文/ジョブ数・取得時刻を確認する。候補manifest記録から変わっていれば差分を再レビューする。進行中の処理があれば更新を止め、整合した保全点を確保する。
2. 未適用の3migrationをmanifest順に適用する。既存の同名オブジェクトがあれば再実行せず履歴と実体を照合。全体の成否・RLS・RPC ACL・初期停止状態を確認する。
3. 既存のレガシー制御が止まる状態で、manifestの7関数を依存込みで配備し、JWT設定を保存する。LINE受付を含めて配備完了を照合したうえで、無料試作・返金条件・未入金取消しを含む販売画面の配信版も照合する。関数ごとの配備は原子的ではないため、配備途中を利用者に開放しない。
4. `CUSTOMER_R2_ACCOUNT_ID`、`CUSTOMER_R2_BUCKET`、`CUSTOMER_R2_ACCESS_KEY_ID`、`CUSTOMER_R2_SECRET_ACCESS_KEY`、`CUSTOMER_BASE_DOMAIN`、`CUSTOMER_HOSTING_DOMAIN_READY` を対象・実検証と照合する。値をログに出さない。最後に `WEBSITE_CUSTOMER_HOSTING=cloudflare-r2` の切替を行う。
5. 匿名/別顧客/非管理者を拒否すること、旧公開経路が勝手に再開しないこと、原本が非公開であること、R2公開pointerとDBが一致することを確認する。アップロード・有料AIの初期停止と費用枠を維持する。
6. 許可した架空注文で申込み→見積り→本人のLINEへの許可された送信→同意記録→架空入金確認→素材→制作→管理者/顧客承認→HTTPS公開→更新→非公開→復旧を検証する。未入金取消しは別の架空注文で行い、見積りの再送、同意記録、案件作成が止まり、以前の見積りを閲覧できることを確認する。実メッセージ・有料AI・課金が必要な段階は対象と上限を明示してから行う。
7. 検証結果を確認してから販売開始。APIが200だったことだけで注文から公開まで合格としない。

## 戻し方

- 送信・制作・公開を止め、新規の注文や承認を受け付けない。未解決の公開処理を別処理で上書きせず、DBとR2の操作IDを照合する。
- migrationの途中で失敗したら、成功済みの版と失敗した版を履歴・実体の双方から読む。アップロードと有料AIの停止を確認し、隔離DBで原因を確かめてから次の適用を判断する。正式関数の配備とホスティングモードの切替は保留する。
- 現状の `sales-hosting/runtime/` が、Cloudflareからの未対応書込みを409で止める接続用コード。API52/顧客54/注文17/プレビュー14の動作へ戻すときは、それぞれ固有の`_shared`を取り違えない。設定関数3は配備記録と照合する。
- Worker46の全4ファイルは [runtime-baseline/website-worker.json](../sales-hosting/runtime-baseline/website-worker.json) に保存。これはソースだけの復旧用で、DB/Auth/Storage/R2バックアップではない。復旧配備では新しいversion番号になる。
- 関数復旧後も、新設テーブルや契約記録を自動DROPしない。書込みが発生した後は、確定したURL・見積り・同意・入金情報を守り、実バックアップと照合して別途復旧を判断する。
- 11月20日候補の `before.rollback_files` には、LINE受付を含む切替前の7関数を復元するファイル位置とSHA-256がある。各関数の内部パス・依存を個別に再構成し、JWT設定と一緒に確認してから復旧する。取り消した注文と既に提示した見積りの記録はDBに残す。
- `WEBSITE_CUSTOMER_HOSTING`を空に戻すとレガシー経路が再度選ばれる可能性があるため、フラグだけを消して運用再開しない。

## 一次資料・実行証拠

- [本番R2の実接続・限定キー検証](https://github.com/sho-support/sho-support.github.io/actions/runs/43886319809)
- [空白対応後の全体検査](https://github.com/sho-support/sho-support.github.io/actions/runs/43886319719)

- [全体検査結果](https://github.com/sho-support/sho-support.github.io/actions/runs/43741391002)
- [R2作成APIと必須権限](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/)
- [R2トークンの権限とバケット限定](https://developers.cloudflare.com/r2/api/tokens/)
- [Supabaseバックアップの範囲](https://supabase.com/docs/guides/platform/backups)
