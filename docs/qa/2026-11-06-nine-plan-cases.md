# SHO WEB SUPPORT | 3プラン×3ケース QA記録
日付: 2026-11-06
対象: Supabase project tyhymvgjkoebetyypspj / netlify-sales-staging

## テスト振込先
- テスト銀行 / テスト支店 / 普通 0000000
- 本物の銀行口座ではないため、振込は禁止。
- website_settings.bank_transfer_test に保存。
- order_codes は空配列（一般注文へ誤送信しないため）。
- 正式見積りで使う website_settings.bank_transfer は未設定のまま維持。

## 実施した9ケース (DBトランザクション内・自動ロールバック)
1. One / unlimited / ¥22,000〜 / ID1000 / PASS
2. One / none / ¥15,000〜 / ID1001 / PASS
3. One / none / ¥15,000〜 / ID1002 / PASS
4. Semi / rock / free3 / ¥22,000〜 / ID1003 / PASS
5. Semi / premium / free3 / ¥22,000〜 / ID1004 / PASS
6. Semi / cyber / free3 / ¥22,000〜 / ID1005 / PASS
7. Full / free3 / ¥30,000〜 / ID1006 / PASS
8. Full / free3 / ¥30,000〜 / ID1007 / PASS
9. Full / free3 / ¥30,000〜 / ID1008 / PASS

テスト内容:
注文レコード作成 → 入金待ちへのステータス変更 → 数字だけのSITE IDによる案件作成 → ヒアリングデータ登録 → building状態 → 制作ジョブqueuedの登録 → 全4テーブルの参照整合性と料金・プラン照合。

9ケースすべてSQLのチェックに合格。例外ブロックによる自動ロールバックを実施し、終了後の件数は orders=0 / sites=0 / jobs=0 / intakes=0 と再照合済み。
**実際の注文APIに対してブラウザから注文したわけではない。実AI生成、GitHubへの成果物作成、プレビューのブラウザ表示、メール・LINEの送受信、現実の入金、正式URLの公開は未検証。**

## 販売前に必ず検証する項目
- フォーム→注文API→LINE連携→正式見積り→入金確認→案件作成→AI生成→PC/スマホプレビュー→お客様承認→公開までのE2E
- 3プランそれぞれの実際の出力デザイン、画像、文字サイズ、URL、404、リンク
- 実在する正式公開ドメインの調達と検証。無料URLという販売文言と、システム側のサービス提供者ドメイン禁止ルールの整合
- 「テスト銀行」は本番正式振込先として設定しない。本番振込先の設定は実口座決定後
- Netlifyデプロイ後の実機動作（ステージングGitHub編集だけで公開反映されたと判断しない）
- Supabaseの漏えいパスワード保護警告

## 判定
9ケースのDB整合性: PASS
本番9回の注文→完成サイト自動生成: NOT RUN
販売可能判定: 未取得
