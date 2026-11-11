# テスト公開基盤への接続

2026-11-11。設定前の手順であり、実接続や本番切替の完了記録ではない。

## ダッシュボード認証が使えない場合

Cloud Browserのメール・パスワード認証は `POST /api/v4/login` の403で終了した。
Google認証も先に失敗している。原因は特定できておらず、認証試行を繰り返さない。
ユーザー自身の端末のログイン状態はCloud Browserへ引き継がれない。

代替経路はCloudflare APIとGitHub Actions。初回の本人操作で権限を作成し、秘密の値を
GitHubのActions Secretsへ直接登録する。パスワード、APIトークン、S3 Secretをチャット・Issue・コードへ記載しない。
通常の公開コード更新は開発ブランチのコミットとCIで処理する。

## 初回に確認する情報

1. Cloudflareの対象アカウントID、既存Worker一覧、R2バケットの正式名を確認する。
2. 使用するバケットがテスト専用で、R2管理ドメインとカスタムドメインのいずれからも公開されていないことを確認する。
3. 同名Workerが存在すれば、テスト専用と確認できるまで上書きしない。
4. テストWorker名は `sho-customer-sites-preview`。正式URLではない。
   `sho-customer-sites-preview.<アカウントのworkers.devサブドメイン>.workers.dev` の正確なホスト名を使用する。
5. 既存の本番DNS・メール・販売・バンドサイトへルートを追加しない。有料契約変更は別途承認を受ける。

## GitHub Actions設定

### 現在のカスタムポリシー画面での設定

`sho-customer-hosting-preview` という名前のUser API Tokenを作る場合は、
「最初から作成」の左の `+` → `Start with an Account policy` から設定する。
対象は既存R2バケットを作ったアカウント1つに限定する。「すべてのアカウント」を選ばない。
Accountポリシーに以下だけを付与する。EditとWriteはUI・API上の表記の違いがある。

| 権限 | 用途 |
|---|---|
| `Workers Scripts Edit` / `Workers Scripts Write` | Worker配備と既存Worker・workers.dev設定の確認 |
| `Workers R2 Storage Read` | 既存バケット・保存クラス・公開設定の確認 |
| `Account Settings Read` | 対象アカウントIDの確認 |

Workers編集権限は選んだアカウント内のWorkerへ及ぶ。テストWorkerだけに資格情報自体を
限定できたと主張しない。配備先はコード側で予約したテストWorkerに固定し、既存同名Workerは
照合するまで上書きしない。DNS・課金・他のサービスへの権限は追加しない。
初回テスト用トークンの有効期限は30日を推奨する。期限前の更新は別途管理する。
GitHubの実行元はスマホのIPと異なるため、今回のクライアントIP欄にスマホのIPを書かない。
発行前の概要を確認した後、トークンはGitHub Secretsへ直接登録する。

### 接続後に最初に行う読み取り確認

`inspect-cloudflare.mjs` はCloudflare APIのGETだけでアカウント、Worker数と同名テストWorkerの有無、
workers.devサブドメイン、テスト候補R2バケットの正式名・保存クラス・公開設定を確認する。
`r2.dev` 無効と全カスタムドメイン無効の両方を確認する。対象はdefault jurisdictionに限定する。
一般のWorker名、非対象バケット名、アカウント名・メール、カスタムドメイン名、認証情報はログへ出さない。

- `CLOUDFLARE_API_TOKEN` があれば、APIで見えるアカウントが1つの場合に限りIDを取得できる。
  複数・不明なら `CLOUDFLARE_ACCOUNT_ID` の明示を要求して止める。
- 明示コミット `[inspect-customer-preview]` はCIの `inventory` ジョブを実行する。
  または利用可能な手動起動で `inspect_preview=true`。`CF_PREVIEW_ENABLED` を有効化する必要はない。
- この確認だけでは資源を作成・削除・変更せず、候補の名前だけで配備先を承認しない。
- 実配備の直前にも同じ確認を行い、設定したバケットが非公開Standardでない場合や、
  設定ホストが実アカウントのサブドメインと異なる場合はアップロード前に止める。
- HTTP 403・429・5xxは自動再試行せず、応答本文や秘密のヘッダーは出力しない。

### Secretsと変数

| 種別 | 名前 | 内容 |
|---|---|---|
| Secret | `CLOUDFLARE_ACCOUNT_ID` | 確認したテスト対象アカウントID |
| Secret | `CLOUDFLARE_API_TOKEN` | 対象アカウントのWorker配備とR2 bindingに必要な最小権限。Global API Keyを使わない |
| Variable | `CF_PREVIEW_BUCKET` | 確認した非公開テストバケット名。現在の設定スクリプトは名前にpreviewを要求する |
| Variable | `CF_PREVIEW_HOST` | 上記の正確なworkers.devホスト名 |
| Variable | `CF_PREVIEW_ENABLED` | 上記の資源・権限確認を終えた後だけ `true` にする |

Environment名は `customer-hosting-preview`。ブランチを `architecture/customer-hosting-v2` に限定する。
本番用アカウントやバケットへの権限を混ぜない。共有アカウントのトークンでテストWorkerだけに
編集権限を限定できない場合、その範囲を隠さず確認し、独立したテストアカウント等を検討する。

現時点でこのworkflowは開発ブランチにのみ存在する。GitHubの仕様上、画面の「Run workflow」ボタンは
デフォルトブランチにもworkflowがあることを要求する。APIからの手動起動は今回未検証。
そのため、設定照合後にコミットメッセージへ `[deploy-customer-preview]` を明示する経路を用意した。
この経路も `CF_PREVIEW_ENABLED=true`、指定ブランチ、単体・ローカル実行・画面CIの合格が必要。
設定だけでは現在のコミットを再実行しない。`main` へ未検証の変更を入れて起動させない。

配備されたWorkerはR2の予約ID `9000001000` だけを読む。ファイルがなければ404になる。
HTTP 200を出すには、次項の保存経路で承認付きのテスト用リリースを保存・有効化し、HTTPSで確認する。
Workerのビルド成功だけで顧客サイトの公開試験完了とはしない。

## SupabaseからR2へ保存するモジュール

- `supabase/functions/_shared/customer-r2.mjs`: site ID単位のget/head/条件付きput。
- `supabase/functions/_shared/customer-r2.ts`: Edge Function Secretsからの生成。依存は `npm:aws4fetch@1.0.20` に固定。
- 保存処理は既存の `stageRelease` / `activateRelease` / `exportStagedRelease` と接続して試験済み。
  実R2のS3通信ではなく、署名は実ライブラリ、応答と状態は模擬サービスである。

必要なEdge Function Secrets:

| 名前 | 内容 |
|---|---|
| `WEBSITE_CUSTOMER_HOSTING` | `cloudflare-r2`。未設定なら初期化を拒否 |
| `CUSTOMER_R2_ACCOUNT_ID` | 対象アカウントID |
| `CUSTOMER_R2_BUCKET` | 保存する非公開バケット |
| `CUSTOMER_R2_ACCESS_KEY_ID` | バケット限定Object Read & Write権限のS3 Access Key ID |
| `CUSTOMER_R2_SECRET_ACCESS_KEY` | 対応するS3 Secret Access Key |

このS3キーはWrangler用のCloudflare APIトークンと別物である。
現モジュールはdefault jurisdictionのバケットを対象とする。EU・US・FedRAMPで作成したバケットなら、
専用endpointへの対応・試験を先に行う。実バケットのjurisdictionは未確認。
モジュールの保存と実配備は区別する。現在の本番Edge Functionはこのモジュールを呼び出していない。
呼び出す際は、認証済み管理者、DBの最新の顧客承認・品質検査と承認対象リリース、公開ロックを
確認してから `activateRelease` を実行する。ブラウザーからの承認フラグを渡して許可してはいけない。

自動再試行を行わず、通信切断や5xxの書き込み結果は不明として返す。
R2側で確定していた可能性があるため、DB更新失敗と同様に整合性回復を行うまで次の公開を止める。
リダイレクト先へ署名資格情報を送らない。顧客を越えるkey、無条件上書き、サイズ・ハッシュ不一致を拒否する。

## 本番反映前に残る作業

既存3Functionの現行配備差分を保持し、生成・承認・公開・非公開化・ドメイン設定を同時に統合する。
現時点ではGitHub Pages経路を置換済みとは扱わない。実R2、DBとの不一致回復、承認後の並行更新、
本番バックアップ、契約・維持費と正式ドメインを確認するまで、本番用のhosting switchを有効化しない。

## 公式資料

- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- https://developers.cloudflare.com/r2/api/tokens/
- https://developers.cloudflare.com/r2/api/s3/conditional-operations/
- https://developers.cloudflare.com/r2/examples/aws/aws4fetch/
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch
- https://supabase.com/docs/guides/functions/secrets
