# HP販売：実データの保全・復元証跡（2026-11-18 JST）

## 完了したSQLバックアップ

対象は `sho-web-support` (`tyhymvgjkoebetyypspj`)。 [実行44322113678](https://github.com/sho-support/sho-support.github.io/actions/runs/44322113678)、ソース `a0dd4fffa6ba1598322fc00103b08533bfccb498` で実データを取得し、外部ネットワークから隔離した空のPostgreSQL 17へ復元した。

- 元の65テーブルを列挙し、永続データ64テーブルの件数・内容SHA256が一致した。
- 残る `net._http_response` はpg_netのTTL付き応答キャッシュ。拡張機能の所属を検査したうえで、空に再生成する対象として明示した。HTTPリクエストキューは除外していない。
- 所有者・RLSポリシー・強制RLS・テーブル等の実効ACL、カスタム関数の所有者/権限/定義、トリガー、シーケンス状態が一致した。権限が暗黙の初期値である場合と、同じ初期値が明示されている場合を等価に扱う。
- 拡張機能に属する7オブジェクトの所有者・ACLと、pg_netの1シーケンスの状態を補足して復元した。元の役割パスワードおよび期限付きCLIロールは含めない。
- 暗号化SQLコンポーネントを本人専用の非公開保管先へ保存。保存データのSHA256照合、本人用復旧キーによる復号、内部のdump/rolesのSHA256照合を完了した。
- 元のDBパスワード、元のアプリテーブル、元のスキーマ、実顧客サイトは変更していない。暗号化済みデータを渡すために新規作成した所有者専用Large Objectだけを書き、別保管後にその1件を削除し、不在を確認した。公開Git・公開Actions artifactへのデータ添付はない。
- [機械可読の証跡](qa/sales-backup-sql-20261118.json)。暗号化ファイル1,032,730 bytes、SHA256 `3b859e22bbb557d5a9771313e647b0e824814e72ebf3bdd50937064edb9ebfe0`。

暗号化方式はAES-256-GCM、データ暗号化キーは本人のRSA-3072公開鍵に対するOAEP/SHA256で保護する。復旧用秘密鍵は別ファイルで本人専用の非公開保管先へ保存済み。秘密鍵をGit・実行環境・元DBへ置いていない。本人がパスワード管理ソフト等へ別保管したことまでは未確認。

## SQLコンポーネントの内容と復元順

`sales-hosting/backup/private-delivery.mjs` の `openPrivateDelivery` が、固定プロジェクト・実行番号・ソースSHA・受取人・認証タグを検証して復号する。復号したJSONにはPostgreSQLカスタム形式の `archive`、`roles`、それぞれのSHA256、`managed_sequences`、`extension_relation_security_sql`、非公開の照合用メタデータがある。値はBase64から戻し、記録されたSHA256と一致することを確認する。

復元は新しい空の環境だけで行う。PostgreSQL 17と必要な拡張機能を用意し、Supabaseの復元用bootstrap役割を準備 → roles → pg_restoreのSQL → 拡張機能の所有者/ACL補足 → pg_netシーケンスの状態補足 → データ・RLS・権限等の比較、の順。テスト済みの実装は `sales-hosting/verify-database-restore.mjs`。HTTPワーカーは外部へ送信できないよう隔離する。実環境へ直接適用しない。

## 完了と扱わない項目

- Supabase Authサービスを起動して既存利用者がログインする試験は未実施。SQL上のAuthデータ復元と区別する。
- SQLコンポーネントにStorage/R2のファイル本体や外部サービスの秘密鍵は含まれない。
- 現在のStorageは2バケット・9ファイル・4,186,232 bytes。ファイル本体の別保管・復元を引き続き検査する。
- 本番全体のバックアップ・空環境復元ゲートは引き続き **未完了**。正式URL、正式振込先、契約条件の確定もこの検査で完了したとは扱わない。

## 公式資料

- [Supabaseのバックアップと復元](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [PostgreSQL拡張機能のdump対象とACL](https://www.postgresql.org/docs/17/extend-extensions.html)
- [PostgreSQL Large Objectの所有権・アクセス権](https://www.postgresql.org/docs/17/lo-implementation.html)
