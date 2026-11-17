# HP販売：実バックアップ接続の準備（2026-11-18 JST）

状態：スマートフォンで対象プロジェクトのConnect → Direct → Session pooler → URIまで表示済み。接続用の検査コードは準備済み。DB接続用Secretの本人登録、実接続、実バックアップ取得・別保管・空環境への復元は未完了。

## 本人が用意する設定

Supabaseアカウントのログイン用パスワードと、プロジェクト作成時のDBパスワードは別。DBパスワードが不明な場合、既存アプリへの影響を調べずに「Reset database password」を押さない。パスワード・完成した接続文字列はチャットへ送らない。

DBパスワードが分かる場合は、次の2つのGitHub Actions Repository Secretへ別々に保存する。スマートフォンではURIを編集せず、Connect画面の文字列をそのままコピーする。パスワードを別のSecretで渡すため、本人が特殊文字をURIエンコードする必要はない。

- [対象リポジトリの新規Secret設定](https://github.com/sho-support/sho-support.github.io/settings/secrets/actions/new)
- Name：`SUPABASE_BACKUP_DB_URL`／Secret：Connect画面のSession poolerの接続URI。`[YOUR-PASSWORD]` のままでよい。
- Name：`SUPABASE_BACKUP_DB_PASSWORD`／Secret：DB作成時のパスワード。そのままの文字列で保存し、前後の空白除去などの加工をしない。
- 対象プロジェクト：`tyhymvgjkoebetyypspj`、東京リージョンの共有pooler、ポート5432、DB `postgres`。

これはSupabase Edge Function SecretsやR2のキーを上書きする操作ではない。

## 読み取り専用の実接続検査

`.github/workflows/sales-backup-preflight.yml` は固定のHP販売ブランチ上で検査する。通常のpushではオフライン契約テストだけを実行する。本人の登録後、`sales-hosting/backup/` 内の検査依頼記録を更新し、コミットメッセージへ `[verify-hp-backup-connection]` を付けたpushだけで実接続を行う。実行の再試行は自動では行わない。

検査は、固定プロジェクト・固定リージョンのSession pooler以外を拒否する。接続URIのオプションにかかわらずTLS証明書を検証し、読み取り専用のセッションおよびトランザクションで、PostgreSQLバージョン・DB名・件数だけを確認する。URI・パスワード・行データ・プロバイダーのエラー詳細をログへ出さない。トランザクションをROLLBACKし接続を終了する。

この接続検査が通っても、バックアップ作成済み・復元試験済みとは扱わない。実バックアップは[保全と復元の手順](../customer-hosting-v2/BACKUP_OPERATIONS.md)に従い、暗号化して本人管理の非公開保管先へ保存する。公開Git・公開Actions artifactに実データを置かない。既存のバンド用データ・公開環境・他サービスの設定は変更しない。

## 公式資料

- [Supabaseの接続方法](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabaseのバックアップと復元](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [GitHub ActionsのSecret設定](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets)
