# HP販売の切替・復旧手順（2026-11-16 JST）

本書は実行準備であり、切替完了の記録ではない。対象は `tyhymvgjkoebetyypspj` のHP販売だけ。バンド、他の販売サービス、TrendBlog、現在のDNSを一括で変更しない。

## 固定した候補

- [release-candidate.json](../sales-hosting/release-candidate.json) に、コミット `90178af9150285fed86ed197f17aec7dad83d339` の6関数・全ローカル依存ファイル・3migrationのSHAを記録。候補はローカルの全該当ファイルをGitHubの同一コミットと照合したもの。過去のプレビュー配備を本番切替済みと扱わない。
- JWT設定は `website-api` と `website-worker` がtrue、`website-customer-access`、`website-order-api`、`website-preview`、`website-sales-setup` がfalse。falseの関数も内部の本人・管理者確認を維持する。
- 公開フロントは `f83de541-4bb2-4ccf-9f7f-df01e482fb1f`、配備元は `5be610022d37aa1b3424d70b274a00f442162687`。今回フロントを再配備していない。

## 実行前に必要なこと

1. [バックアップ手順](../customer-hosting-v2/BACKUP_OPERATIONS.md)どおりに実環境の保全・別保管・空環境での復元を終える。合成DBの47テストやコードの保存を代用しない。
2. `sho-customer-sites-production` がStandard・非公開であることを検証。2026-11-16 02:30 JSTの既存REST APIによる作成要求はHTTP 403で拒否された。作成済みとは扱わない。メタデータ閲覧用APIとS3オブジェクト用鍵は別の権限である。
3. 上記バケットだけに限定したObject Read & WriteのS3鍵を安全なSecrets入力で設定。チャットや公開Gitに貼らない。プレビュー用の鍵を流用しない。
4. 本人が承認したドメインの所有・DNS・HTTPS・配信Workerを検証し、標準URLを固定。ドメイン購入は未承認。`workers.dev`等を永久納品先にしない。
5. 本番振込先へ差し替え、契約原案と実バックアップの確認記録を本人が承認。テスト銀行 `0000000` のまま販売条件を有効化しない。

## 切替の順序

1. 対象プロジェクト・各関数version/SHA・migration履歴・注文/ジョブ数・取得時刻を確認する。候補manifest記録から変わっていれば差分を再レビューする。進行中の処理があれば更新を止め、整合した保全点を確保する。
2. 未適用の3migrationをmanifest順に適用する。既存の同名オブジェクトがあれば再実行せず履歴と実体を照合。全体の成否・RLS・RPC ACL・初期停止状態を確認する。
3. 既存のレガシー制御が止まる状態で、manifestの6関数を依存込みで配備し、JWT設定を保存する。関数ごとの配備は原子的ではないため、配備途中を利用者に開放しない。
4. `CUSTOMER_R2_ACCOUNT_ID`、`CUSTOMER_R2_BUCKET`、`CUSTOMER_R2_ACCESS_KEY_ID`、`CUSTOMER_R2_SECRET_ACCESS_KEY`、`CUSTOMER_BASE_DOMAIN`、`CUSTOMER_HOSTING_DOMAIN_READY` を対象・実検証と照合する。値をログに出さない。最後に `WEBSITE_CUSTOMER_HOSTING=cloudflare-r2` の切替を行う。
5. 匿名/別顧客/非管理者を拒否すること、旧公開経路が勝手に再開しないこと、原本が非公開であること、R2公開pointerとDBが一致することを確認する。アップロード・有料AIの初期停止と費用枠を維持する。
6. 許可した架空注文で申込み→見積り→本人のLINEへの許可された送信→同意記録→架空入金確認→素材→制作→管理者/顧客承認→HTTPS公開→更新→非公開→復旧を検証する。実メッセージ・有料AI・課金が必要な段階は対象と上限を明示してから行う。
7. 検証結果を確認してから販売開始。APIが200だったことだけで注文から公開まで合格としない。

## 戻し方

- 送信・制作・公開を止め、新規の注文や承認を受け付けない。未解決の公開処理を別処理で上書きせず、DBとR2の操作IDを照合する。
- 現状の `sales-hosting/runtime/` が、Cloudflareからの未対応書込みを409で止める接続用コード。API52/顧客54/注文17/プレビュー14の動作へ戻すときは、それぞれ固有の`_shared`を取り違えない。設定関数3は配備記録と照合する。
- Worker46の全4ファイルは [runtime-baseline/website-worker.json](../sales-hosting/runtime-baseline/website-worker.json) に保存。これはソースだけの復旧用で、DB/Auth/Storage/R2バックアップではない。復旧配備では新しいversion番号になる。
- 関数復旧後も、新設テーブルや契約記録を自動DROPしない。書込みが発生した後は、確定したURL・見積り・同意・入金情報を守り、実バックアップと照合して別途復旧を判断する。
- `WEBSITE_CUSTOMER_HOSTING`を空に戻すとレガシー経路が再度選ばれる可能性があるため、フラグだけを消して運用再開しない。

## 一次資料・実行証拠

- [全体検査結果](https://github.com/sho-support/sho-support.github.io/actions/runs/43741391002)
- [R2作成APIと必須権限](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/)
- [R2トークンの権限とバケット限定](https://developers.cloudflare.com/r2/api/tokens/)
- [Supabaseバックアップの範囲](https://supabase.com/docs/guides/platform/backups)
