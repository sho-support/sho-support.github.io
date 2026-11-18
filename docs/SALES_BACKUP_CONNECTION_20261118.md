# HP販売：実バックアップ接続の準備（2026-11-18 JST）

状態：本人がSession pooler URIを `SUPABASE_BACKUP_DB_URL` に保存済みと報告。DBパスワードは不明で、別Secretへの保存は未確認。既存パスワードのリセットを必要としない、限定APIトークンによる一時接続の経路を追加した。実接続・実バックアップ取得・別保管・空環境への復元は未完了。

## 本人が用意する設定

Supabaseアカウントのログイン用パスワードと、プロジェクト作成時のDBパスワードは別。DBパスワードが不明な場合、既存アプリへの影響を調べずに「Reset database password」を押さない。パスワード・完成した接続文字列はチャットへ送らない。

現在のDBパスワードはSupabase管理画面で再表示できない。作成時に保存した記録があれば確認できるが、今回、本人がその値を受領・保管していた記録は確認できていない。本人が覚えているという前提にしない。

### DBパスワードが不明な場合

保存済みURIはそのまま使い、次のトークン1つをGitHub Actions Repository Secretへ追加する。既存の `SUPABASE_BACKUP_DB_PASSWORD` は不要。R2トークンとは別。

1. [Supabase Access Tokens](https://supabase.com/dashboard/account/tokens) で新しいトークンを作成する。
2. 名前は `hp-backup-read-check`。対象は `sho-web-support`（`tyhymvgjkoebetyypspj`）だけ。権限は Database の Read-write のみ。全アカウント権限のLegacyトークンは使用しない。期限を選べる場合は短期間を選び、今回の保全作業後に失効させる。
3. [GitHubの新規Secret設定](https://github.com/sho-support/sho-support.github.io/settings/secrets/actions/new) のNameを `SUPABASE_BACKUP_ACCESS_TOKEN`、Secretを生成したトークン値にして保存する。値をチャットへ送らない。

トークンにDatabase Read-write権限が必要なのは、Supabase管理の一時ログイン情報を発行するため。実際の接続は公式beta API `/v1/projects/{ref}/cli/login-role` に `read_only:true` を渡す。固定プロジェクトだけを対象に、リダイレクト・意図しないロール・長すぎる有効期限・過大な応答を拒否する。想定する一時ロール以外を受け取ったら停止し、権限の拡大やrootパスワードへの切り替えは行わない。

一時接続情報の発行は認証ロールを作成・更新する操作なので、証跡の `temporary_login_issued` と `configuration_changed` に記録する。既存のpostgresパスワード・アプリ設定・JIT設定・SSL強制設定・ネットワーク制限は変更しない。共有されうるCLIログインロールの一括DELETEも行わない。有効期限はAPIが返す値（30〜3600秒の範囲）を検査する。beta APIの実接続成功はまだ未確認であり、この経路を用意しただけでバックアップ可能・完了とは判定しない。

### DBパスワードが分かる場合

別経路として次の2つのGitHub Actions Repository Secretを使える。スマートフォンではURIを編集せず、Connect画面の文字列をそのままコピーする。パスワードを別のSecretで渡すため、本人が特殊文字をURIエンコードする必要はない。

- [対象リポジトリの新規Secret設定](https://github.com/sho-support/sho-support.github.io/settings/secrets/actions/new)
- Name：`SUPABASE_BACKUP_DB_URL`／Secret：Connect画面のSession poolerの接続URI。`[YOUR-PASSWORD]` のままでよい。
- Name：`SUPABASE_BACKUP_DB_PASSWORD`／Secret：DB作成時のパスワード。そのままの文字列で保存し、前後の空白除去などの加工をしない。
- 対象プロジェクト：`tyhymvgjkoebetyypspj`、東京リージョンの共有pooler、ポート5432、DB `postgres`。

これはSupabase Edge Function SecretsやR2のキーを上書きする操作ではない。

## 読み取り専用の実接続検査

`.github/workflows/sales-backup-preflight.yml` は固定のHP販売ブランチ上で検査する。通常のpushではオフライン契約テストだけを実行する。本人の登録後、`sales-hosting/backup/` 内の検査依頼記録を更新し、コミットメッセージへ `[verify-hp-backup-connection]` を付けたpushだけで実接続を行う。実行の再試行は自動では行わない。

検査は、固定プロジェクト・固定リージョンのSession pooler以外を拒否する。接続URIのオプションにかかわらずTLS証明書を検証し、読み取り専用のセッションおよびトランザクションで、PostgreSQLバージョン・DB名・件数だけを確認する。一時接続の場合は `supabase_read_only_user` にロールを切り替える。URI・APIトークン・一時パスワード・行データ・プロバイダーのエラー詳細をログへ出さない。トランザクションをROLLBACKし接続を終了する。トークンが登録されている場合は一時接続を優先し、失敗しても既存パスワードへ自動で切り替えない。

この接続検査が通っても、バックアップ作成済み・復元試験済みとは扱わない。実バックアップは[保全と復元の手順](../customer-hosting-v2/BACKUP_OPERATIONS.md)に従い、暗号化して本人管理の非公開保管先へ保存する。公開Git・公開Actions artifactに実データを置かない。既存のバンド用データ・公開環境・他サービスの設定は変更しない。

## 2026-11-18 の確認結果

- 変更後の8項目のオフラインテストはローカルおよびGitHub CIで成功。
- [保存済み設定による実接続検査](https://github.com/sho-support/sho-support.github.io/actions/runs/44304835649) は `DATABASE_PASSWORD_REQUIRED` で接続前に停止。固定の対象URI検査は通過したが、利用できるDBパスワードは得られなかった。URIの再登録は要求しない。
- 同実行では限定トークン経路は未使用。一時ログイン情報の発行・DB接続・データ出力・復元・既存パスワード変更は行われていない。
- 次の本人操作は `SUPABASE_BACKUP_ACCESS_TOKEN` の登録。その後に実接続を検査する。

## 公式資料

- [Supabaseの限定APIトークン](https://supabase.com/docs/guides/platform/personal-access-tokens)
- [Supabaseの一時ログイン情報発行API](https://supabase.com/docs/reference/api/v1-create-login-role)
- [Supabaseの接続方法](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabaseのバックアップと復元](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [GitHub ActionsのSecret設定](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
