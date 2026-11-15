# HP販売：最初の実機テスト（2026-11-16 JST）

## 現在開始できること

[接続・受入テスト画面](https://sho-web-support-preview.zodiac-suu.workers.dev/admin/readiness.html)へ、既存の管理者アカウントでログインする。

1. 「最初の実機テスト：LINE受付」の **テスト文を公式LINEで開く** を押す。
2. LINEで、入力済みの注文ID・連携コードを残したまま送信する。リンクを開くだけでは送信されない。
3. 注文ID `9000001001` と「テスト用・架空口座」の受付返信を確認する。
4. テスト画面を再読み込みし、連携済みの表示を確認する。実機の返信が届いたかも確認する。

これはLINE受付までの試験。制作・あなたの承認・顧客確認・正式URLでの公開までを完了した試験ではない。0000000はテスト口座であり、実際の契約・請求・振込は発生しない。

テスト注文は管理者作業として1件だけ作成し、通常の採番を消費しない予約範囲 `9000001001` に限定した。`qa_purpose=line_connection_acceptance_only` を保存し、その注文だけをテスト銀行の許可リストへ追加。連携コードは非公開の設定に保存し、管理者認証後の画面だけがリンクを取得する。コードはGit・CI artifact・公開ページへ書かない。商用URL予約のプロトコルはこの予約範囲を拒否する。新しいフロントの一般注文受付を止める409の制御は維持している。

## 実サービスで検査済み

- [LINE接続検査](https://github.com/sho-support/sho-support.github.io/actions/runs/43769822519)で、既存チャネル情報からの15分トークン認証、HP販売の公式LINE照合、Webhook受信先、有効化、LINEからの署名付き空Webhookをすべて確認した。
- メッセージの実送信は0件。顧客や管理者宛のトーク送信APIは呼んでいない。実機の受信確認は上記の本人テストで行う。
- 認証方式は既存のstateless方式。固定トークンだけを見る最初の検査結果 `LINE_TOKEN_MISSING` は、LINE未接続の根拠として扱わない。
- 通知先は既存の非公開設定に保存済みであることを、値を出さず確認した。
- 疎通検査用の一時CI権限は、結果取得後に無効化する。通常は本人確認済みの管理者だけが接続確認を実行できる。

## 制作・承認・納品の状態

必要な状態遷移・見積り固定・顧客確認・承認・公開/更新/復旧の実装はあるが、本番の互換関数から新実装への切替と3migrationは未実施。実顧客の注文から納品までが動作済みとは報告しない。

制作完了通知と確認URLが旧サイトへ固定されていた箇所を候補ソースで修正した。Cloudflareモードでは新しい管理画面・プレビュー・テンプレートを使い、旧モードでは既存のリンクを維持する。これは本番Worker46へまだ適用していない。[候補manifest](../sales-hosting/release-candidate.json)は修正済みソースへ更新した。

残る本番準備は、R2本番用バケット・バケット限定キー、正式ドメイン・DNS/HTTPS、実バックアップと別保管/復元、本番口座と契約条件の承認、互換性を確保した切替。既存APIはR2バケット作成で403となるため、本人がCloudflareで空の `sho-customer-sites-production` を非公開のまま作る方法でも解消できる。認証キーはチャットへ貼らず、指定のSecrets設定へ登録する。

## 証拠・一次資料

- [修正後の全体CI](https://github.com/sho-support/sho-support.github.io/actions/runs/43769822529)
- [実LINE検査の機械可読記録](qa/sales-line-connection-20261116.json)
- [LINE Messaging API](https://developers.line.biz/ja/reference/messaging-api/)
- [LINE Webhook受信と署名確認](https://developers.line.biz/ja/docs/messaging-api/receiving-messages/)
