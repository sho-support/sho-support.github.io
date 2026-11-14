# 暗号化バックアップと復旧手順

2026-11-13。**ツールと合成データでの復元試験は存在するが、本番の全バックアップは未取得・未復元。**

## 保全対象

| 対象 | 必要な保全 | この時点の状態 |
|---|---|---|
| Supabase DB・Auth | roles/schema/data、Auth等のデータ、カスタム権限・RLS・トリガー | 本番の安全なDB接続と出力先の設定が必要 |
| Supabase Storage | バケット設定・パス一覧・実ファイル・サイズ・SHA256 | QA専用PNGの保存/復元は実サービスで確認。顧客素材全件は未取得 |
| R2 | リリースの全ファイル・manifest・公開pointer・site対応 | 架空サイトの実リリース復元は確認。正式顧客は0件 |
| GitHub | 顧客の非公開原本・正確なcommit・利用権情報 | ソース保管だけでDB/公開環境が復旧するとは扱わない |
| 基盤設定 | Auth設定、外部連携、DNS、バケット、必要Secrets名と再設定手順 | 値をGitや公開証跡に書かない。必要な再発行・本人操作を復旧手順へ残す |

SupabaseのDBバックアップにはStorageの実ファイルは含まれない。CLIの標準schema dumpはAuth・Storage等の管理スキーマを除外するため、既存の独自RLS・トリガー等を別に確認する。通常のSQL出力だけを「Auth含め完全復旧済み」と報告しない。

## 初回の本番取得手順

1. 注文・サイト・Storage/R2の件数、対象プロジェクトとコードSHA、取得開始時刻を非公開作業記録へ残す。進行中の制作・公開・素材更新がある間に一致を保証しない。必要な短時間の更新停止は事前に確認する。
2. Supabase公式CLI 3.1.0とPostgreSQL 17互換のdumpを使用。接続文字列とDBパスワードはSecretsまたは本人のローカル安全な環境変数で渡す。チャット、シェル履歴、デバッグログへ表示しない。
3. 公式の `db dump` のrole-only、schema、data-only/use-copyを分けて保存。CLI v3では `--remote` が正式。管理スキーマの独自変更は公式diff/既存migrationと実DBを照合し、`managed-customizations.sql` に保存する。関数定義・ACL/RLSを落として復元を成功扱いしない。
4. Storageの対象バケットをページ末尾まで列挙し、実ファイルを取得、全件SHA256照合する。R2の正確な公開版と原本commitも同様に保全する。別事業の素材を削除・移行しない。
5. 以下の構造へ配置し、対象件数が元の一覧と一致することを確認。manifestには取得時刻とページング完了の根拠を別記する。

```text
db/roles.sql
db/schema.sql
db/data.sql
db/managed-customizations.sql
platform/restore-notes.md
storage/manifest.json
storage/objects/... 実ファイル
r2/manifest.json
r2/objects/... 公開ファイル・リリース情報
github/manifest.json
github/objects/... 原本と利用権情報
```

`storage/r2/github`の各manifestは次の形式を使用する。0件ならentriesは空にできるが、元環境も0件であることを確認する。

```json
{"schema":1,"project_ref":"tyhymvgjkoebetyypspj","entries":[{"path":"objects/実ファイル名","bytes":68,"sha256":"実ファイルから計算した64桁のSHA256"}]}
```

6. リポジトリの外にある本人管理の非公開ディレクトリでキーを生成する。キーはバックアップ本体・保存先と分け、パスワード管理ソフト等に別途保全する。キー紛失時は復号不能。

```bash
node customer-hosting-v2/seal-backup.mjs keygen /private-key-dir/backup-key.bin
node customer-hosting-v2/seal-backup.mjs pack /private-input-dir /private-output-dir/backup.sho.enc /private-key-dir/backup-key.bin
node customer-hosting-v2/seal-backup.mjs unpack /private-output-dir/backup.sho.enc /private-restore-dir /private-key-dir/backup-key.bin
```

これらはパスの例。実行前にディレクトリを本人管理の場所に置き換える。ツールはネット接続・アップロード・DB復元・既存ファイル上書きを行わない。元の実一覧との一致までは判定できず、`source_completeness_verified:false` と報告する。35MiBを超える初期パッケージは停止するため、容量超過を検出したまま成功扱いしない。

7. 暗号化ファイルを、元のSupabase/Cloudflareとは異なる本人管理の非公開保管先へ保管する。**保管先とアクセス権が未確定のため、この転送は未実施。**公開GitHubリポジトリや公開Actions artifactに顧客バックアップを置かない。
8. ダウンロードしてハッシュ照合・復号し、新しい空の復旧先で公式順序のroles→schema→data→カスタムRLS等を適用する。本番へ直接restoreしない。新規有料リソースは本人承認後に作る。
9. Authログイン、匿名/別顧客の拒否、Storage非公開、公開pointerとDBの一致、画像・リンク・6画面幅を確認する。外部Secretsは復元先へ安全に再設定する。顧客通知はモックで止める。

## 保持と頻度の原案

最初の2件は公開/更新の直前・直後に完成版を保存、週1回にDB・素材・基盤記録を保全。直近4週と直近3公開版を標準世代案とする。稼働中pointerが参照する版や解約時の引き渡し対象は削除しない。初期は自動削除を有効化せず、容量・参照・契約を確認して実行する。

頻度・保存期間は契約原案にすぎず、運用開始・別保管・本番復元試験の完了までは顧客へ実績として案内しない。合成PostgreSQLのpg_dump/pg_restore試験と、Supabase全体の復旧検証を区別する。

## 公式資料

- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
- https://supabase.com/docs/reference/cli/supabase-db-dump
- https://developers.cloudflare.com/r2/api/tokens/
