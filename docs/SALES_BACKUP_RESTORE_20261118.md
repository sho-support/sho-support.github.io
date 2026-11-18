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
- Storageの2バケット・9ファイル・4,186,232 bytesは、別の非公開QAバケットへの全件復元・SHA256一致・QA削除、暗号化した別保管、本人キーによる復号、全件の内部ハッシュ照合まで確認済み（2026-11-19）。
- 本番全体のバックアップ・空環境復元ゲートは引き続き **未完了**。正式URL、正式振込先、契約条件の確定もこの検査で完了したとは扱わない。

## 公式資料

- [Supabaseのバックアップと復元](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [PostgreSQL拡張機能のdump対象とACL](https://www.postgresql.org/docs/17/extend-extensions.html)
- [PostgreSQL Large Objectの所有権・アクセス権](https://www.postgresql.org/docs/17/lo-implementation.html)

## Storage/R2の実ファイル復元（同日追記）

[実行44324013481](https://github.com/sho-support/sho-support.github.io/actions/runs/44324013481)、ソース `c1bd916b010457cd6ed1145620946ff46fe293a5` で、Storageの2バケット・9ファイル・4,186,232 bytesを全件列挙し、新規の非公開QAバケットへコピーした。全件のサイズとSHA256を照合し、元ファイルの再読込SHA256も一致。元の一覧・設定は変更していない。QAバケットは削除し、元ファイル9件と一時バケット0件をDBから確認した。

本番R2バケットも先頭から末尾まで列挙し、前後とも0件だった。元のR2オブジェクトへの書込・削除は行っていない。0件という確認を、実顧客サイトのR2復元試験済みとは表現しない。

ファイル本体と元のメタデータを本人の公開鍵へ暗号化済み。暗号化コンポーネント7,455,309 bytes、SHA256 `ccac9521b0d7a9bb12b4e0d4a21a94d9228454f635bc88ca02e62c5e183a8320`。元プロジェクト上の新規・所有者専用Large Objectに一時保管し、通常ユーザー3役割で読取拒否、所有者のみのACLも確認した。2026-11-19に作業実行環境の接続が回復し、転送・本人キーによる復号・全9件のハッシュ照合・本人専用の非公開別保管を完了した。元の転送用Large Objectは、その1件の所有者・サイズ・SHA256を再確認してから削除し、不在を確認した。元の9ファイルはそのまま維持している。

検査用 `website-private-assets-backup` はv2の閉鎖コードへ戻し、全4ファイルの取得し直しで完全一致を確認した。既存のR2検査用・resource QAは再開していない。[実行44325277615](https://github.com/sho-support/sho-support.github.io/actions/runs/44325277615) で、新しいファイル検査用・既存のR2検査用・resource QAの全3入口について、GET、認証なしPOST、Origin付きGETがすべて403になることを確認した。資格情報は使用せず、元データへの変更は行っていない。[ファイル検査の証跡](qa/sales-backup-assets-20261118.json)。全基盤バックアップゲートは未完了のまま維持する。

## 2026-11-19：保存版と暗号化互換性の修正

ファイルコンポーネントの別保管を完了。保存版は7,455,309 bytes、SHA256 `c2126abfe3789b09d4e69d9031498a11aa2d529378233404347ff567bcd960e4`。上記の旧転送用ハッシュとは区別する。保存版は通常の `openPrivateDelivery(..., 'assets')` によるRSA-OAEP/SHA256とAES-256-GCMの検証に通り、内部の全9ファイルのサイズ・SHA256・合計4,186,232 bytesも一致した。

旧Edge出力は指定したOAEP/SHA256で開けず、OAEP/SHA1での鍵の取り出しとGCM認証が成立することを確認した。原データ破損ではなく暗号化処理の互換性の問題だった。既知の旧暗号文SHA256と本人キーを固定した一度限りの回復処理で、データ暗号化キーの保護をOAEP/SHA256へ変更し、暗号化された本文・認証タグ・全ファイルの内容が不変であることを確認した。通常の読取関数にSHA1へのフォールバックは追加していない。

今後のEdge側の生成は、SHA-256を鍵の取込時に明示するWebCryptoへ変更した。[実行44338163905](https://github.com/sho-support/sho-support.github.io/actions/runs/44338163905) で合成データ131,072 bytesと使い捨てRSA-3072キーだけを使い、実Edge環境のWebCryptoで暗号化 → Nodeの通常読取関数でOAEP/SHA256・AES-GCMの復号 → 全byte照合、改変認証タグの拒否に成功した。顧客データ・本人の復旧秘密鍵はこの検査に使用していない。SQLコンポーネントは別のNode生成経路で、既存の復号検査結果に変更はない。Authサービスログインと全基盤の復旧確認は引き続き未完了で、販売開始ゲートは解除しない。

新しい暗号化関数を組み込んだファイル取得用関数はv3の閉鎖コードへ更新し、全4ファイルの再取得による完全一致を確認した。合成暗号化検査用関数もv2の閉鎖コードへ戻し、全3ファイルの完全一致を確認した。[暗号化の相互運用検査記録](qa/sales-backup-crypto-20261119.json)。

[実行44338740794](https://github.com/sho-support/sho-support.github.io/actions/runs/44338740794) により、暗号化検査用を含めた全4入口のGET・認証なしPOST・Origin付きGETがすべて403となることを確認した。保存したSQLとファイルの両コンポーネントは非公開で別保管済み。元の転送用Large Objectは0件、元のStorageは9ファイル・4,186,232 bytes、QAバケットは0件のまま。全基盤復旧・Authサービスログイン・本番切替・販売開始の承認はこの結果で完了にしない。
