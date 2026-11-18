# HP販売：実バックアップ接続（2026-11-18 JST）

状態：本人が保存したSession pooler URIとプロジェクト限定トークンで実接続に成功。URI・DBパスワードの再入力は不要。DBの実バックアップ・空DBへの復元・暗号化した別保管と復号検査まで完了した。全基盤の復旧完了とは区別する。

## 保存済み設定と対象

- GitHub Actions Secret `SUPABASE_BACKUP_DB_URL`：`sho-web-support` の東京Session pooler、port 5432、database postgres。パスワードのプレースホルダーはそのまま利用する。
- `SUPABASE_BACKUP_ACCESS_TOKEN`：本人が登録した7日間のプロジェクト限定トークン。対象は `tyhymvgjkoebetyypspj` のみ、Database Read-writeのみ。Guns N’ Losesという所属組織名は確認済みのもので、対象プロジェクトを別事業へ切り替えたことを意味しない。
- 既存のpostgresパスワードは変更していない。`SUPABASE_BACKUP_DB_PASSWORD` は今回の経路では使用していない。接続文字列・トークン・パスワードをチャットへ貼らない。

## 実接続と安全な検査

[接続成功の実行44307189278](https://github.com/sho-support/sho-support.github.io/actions/runs/44307189278) で、公式一時ログインAPIによるread-only接続、TLSの証明書・ホスト名検証、読み取り専用トランザクション、固定プロジェクトを確認した。注文1件はテスト用、Auth利用者1件、Storageファイル9件だった。接続成功だけをバックアップ完了とは扱わない。

Supabase Root 2021 CAを公式Studioが案内する公開URLから取得し、PEMのSHA256、証明書フィンガープリント、CA属性、自己署名、有効期限を固定して検査する。`rejectUnauthorized:false` やTLS検証の無効化は使用しない。

read-only一時ロールは後続の再接続で認証に失敗したため、SQL dumpでは公式CLIと同じ `read_only:false` の期限付き `cli_login_postgres` を使用し、元DBを読む全セッションとトランザクションを明示的にread-onlyへ固定した。実際に返された一時接続の期限は300秒。既存のパスワード、JIT、SSL強制、ネットワーク制限は変更せず、共有されるCLIログインロールの一括削除も行わない。

## 実バックアップの確認結果

[SQL復元成功の実行44322113678](https://github.com/sho-support/sho-support.github.io/actions/runs/44322113678) で実データを取得し、ネットワーク隔離した空のPostgreSQL 17に復元した。64テーブルの永続データ、所有者、RLS、実効ACL、カスタム関数、トリガー、シーケンスを照合し、暗号化SQLを本人専用の非公開保管先へ保存した。保存後のハッシュ一致・本人用秘密鍵による復号も確認済み。

復元対象外にしたのはpg_netのTTL付きHTTP応答キャッシュのみ。補足した拡張機能の所有者/ACL、形式、復元順、未確認項目は [実データの保全・復元証跡](SALES_BACKUP_RESTORE_20261118.md) に記録した。元のアプリテーブルや他事業の既存データを変更していない。転送用に新規作成した所有者専用の暗号化Large Objectは、別保管後にその1件だけを削除した。

Storage/R2のファイル本体、実際のAuthサービスログイン、外部連携を含む全基盤の復旧がすべて通るまでは、`production_backup_and_empty_restore` を成功にしない。正式URL・正式口座・契約条件も別の未完了ゲートである。

## 公式資料

- [Supabase限定APIトークン](https://supabase.com/docs/guides/platform/personal-access-tokens)
- [Supabase一時ログインAPI](https://supabase.com/docs/reference/api/v1-create-login-role)
- [Supabase TLS](https://supabase.com/docs/guides/platform/ssl-enforcement)
- [Supabaseバックアップと復元](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
