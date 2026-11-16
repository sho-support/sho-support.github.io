# HP販売リリース準備（2026-11-16 JST）

最新追記：本人が本番R2と限定キーを設定し、2026-11-16に実際の読書き・削除・非公開設定・プレビューバケットへの403拒否を確認した。ID/バケット名の前後空白は共通処理で対応済み。以下の以前の「本番R2未完了」は当時の記録。[現在の状況](SALES_TEST_ISOLATION_20261116.md)を優先する。

> 最新追記：[LINE受付の実機テスト開始手順](SALES_ACCEPTANCE_START_20261116.md)。公式LINEの認証・署名付き空Webhookは確認済み。管理者用の予約テスト注文1件を用意した。以下の0件という記録は作成前の確認時点を示す。制作から納品までの本番通し試験は引き続き未実施。

## 今回の作業

- 実DBのHP用10テーブルから88列・32個の主キー/一意/外部キー/CHECK制約だけを読み取り、架空データ専用の移行試験へ保存。販売者情報・顧客データ・鍵・Authレコードは取得も掲載もしない。
- 3件の未適用migrationを隔離DBへ適用し、トランザクション取り消し、下書き保持、既存制約保持、3プランの見積り/同意記録/案件作成、サーバー専用権限、課金・アップロード初期停止を検証。
- このfixtureはAuthの最小外部キースタブと合成Storageを使用。履歴index・既存RLS・既存trigger・データ全件は含めない。完全な本番バックアップや本番復元の証拠には使用しない。
- 全体テストを現在の `architecture/sales-cloudflare` ブランチにも有効化。従来の外部QA・プレビュー配備ジョブは旧ブランチ/明示マーカー限定のまま。
- 本番用 `sho-customer-sites-production` だけを対象とする準備処理を追加。既存権限でメタデータを検査し、不在時に空のStandardバケットを1回だけ作成要求する。オブジェクト書込み、公開化、Worker変更、鍵作成、DNS変更は行わない。権限不足・応答不明は証拠へ記録し、自動再試行しない。

## 検証の区別

コミット `90178af9150285fed86ed197f17aec7dad83d339` の[全体CI](https://github.com/sho-support/sho-support.github.io/actions/runs/43741391002)は成功。

| 検査 | 結果 |
|---|---|
| 単体テスト（R2準備7件を含む） | 129成功 |
| workerd/R2実装 | 14成功 |
| Supabaseラッパー | 3成功 |
| 組込みSQL | 43成功、ネイティブ限定2件スキップ |
| PostgreSQL 17本体（実DB列・制約の移行試験を含む） | 47成功、失敗/スキップ0 |
| SQL/R2通し試験 | 11成功 |
| 実HTTPハンドラーの隔離試験 | 21成功 |
| Chromium | 320/360/390/430/768/1366pxで既存6スイート成功 |

合成PostgreSQLのdumpを暗号化・復号し、別の空DBに復元してレコード・権限・Storage RLSが一致する試験も成功。これは本番データの取得/別保管/復元試験ではない。

コミット `5beb398e304d58440bc5653dc1b4f75fd4899b23` の[追加CI](https://github.com/sho-support/sho-support.github.io/actions/runs/43765504325)でも全体3ジョブが成功。ログイン/再設定画面の専用検査186件を6画面幅で追加実行し、8文字の入力、7文字の送信停止、確認欄の不一致、18pxの目アイコン、44pxのタップ領域、独立した表示切替、キーボード操作、リセット時の消去・再マスクが通った。Authはローカルモックであり、実パスワード変更・実メール送信は0件。Authサーバーの最小文字数設定を変更した検査ではない。

その後320px画像の目視で見つけた、見出しの最後の1文字だけが折り返す点を修正。[最終CI](https://github.com/sho-support/sho-support.github.io/actions/runs/43766274412)の全体3ジョブが成功し、見出しが1行に収まる検査を含むパスワード画面198件が合格。[Cloudflare配備](https://github.com/sho-support/sho-support.github.io/actions/runs/43766274382)も成功し、versionは `44f44dd9-ee83-4973-bf90-b0aed8aff9e3`。56静的検査と4 APIの接続・認証保持も確認した。

2026-11-16 02:30 JSTのR2準備結果は `permission_blocked / create / HTTP 403`。バケット未作成、オブジェクト書込み・鍵作成・公開設定変更・Worker変更はいずれも0。ワークフローの成功表示だけをバケット準備完了と読まない。今後の準備CLIは権限不足も非ゼロ終了にし、準備未完了を成功表示にしない。今回は同じ作成要求を再実行しない。

本番6関数の35依存ファイルと3migrationは[候補manifest](../sales-hosting/release-candidate.json)へ固定した。配備順序と戻し方は[切替手順](SALES_CUTOVER_RUNBOOK_20261116.md)に記録した。

実DBの `website_settings` はRLS有効・ブラウザ向けポリシーなしで、匿名role/架空の非管理者roleの読取結果はいずれも0行。保存した事業者情報の値は出力せず確認した。管理者判定は `auth.uid()` と管理者テーブルを使い、編集可能なユーザーメタデータは使っていない。[権限確認と既存警告](SALES_PRIVACY_REVIEW_20261116.md)も参照。

本番DBへのmigration、正式見積り送信、入金処理、顧客サイト公開、実バックアップ取得は今回まだ行っていない。テスト銀行は本番振込先に昇格しない。

## 現在の残件

1. 本番DB/Auth/Storage/R2の完全な別保管と空環境への復元確認。安全なDB接続と本人管理の非公開保管先が必要。
2. 本番用R2バケットと、そのバケットだけに限定したS3鍵の準備・検証。プレビュー用鍵を本番へ流用しない。
3. 標準URL用ドメインの決定・購入承認と、DNS/TLS設定。プレビューURLを永久納品URLとして案内しない。
4. 本番の振込先への差替えと、販売条件の承認。販売者情報は保存済み。開業時に事業用電話へ変更する予定。
5. 保全後の本番migration・正式バックエンド切替と、許可された架空注文による実サービス通し試験。

## 関連

- [本人設定の保存確認](SALES_OWNER_SETUP_20261116.md)
- [実バックアップ・復元手順](../customer-hosting-v2/BACKUP_OPERATIONS.md)
- [全体CI](https://github.com/sho-support/sho-support.github.io/actions/workflows/customer-hosting-v2-tests.yml)
- [R2作成API](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/)
- [R2権限](https://developers.cloudflare.com/r2/api/tokens/)
