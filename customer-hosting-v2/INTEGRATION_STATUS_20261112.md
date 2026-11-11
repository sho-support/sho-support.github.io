# SHO WEB SUPPORT / 2026-11-12 接続検証

対象ブランチ: `architecture/customer-hosting-v2`。本番DNS・既存販売サイト・バンドサイト・Supabase本番は変更しない。

## 本人による初期設定

- CloudflareのUser API Tokenの発行前概要を画像で確認。
  対象は個別アカウント1つ、Workers Scripts編集、Workers R2 Storage読み取り、Account Settings読み取り。
  有効期限表示は2026-12-12、IP制限なし。
- GitHub Repository Secretsへ `CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` を保存した旨の連絡と、2件の名前が並ぶ画面を確認。
- トークン値はチャットで受け取っておらず、Secretsの値を取得・表示しない。

## 実APIで確認済み

GitHub Actions Run 43050040929の `inventory` が成功。APIのGETのみで以下を確認した。

- Worker 0件。同名テストWorkerなし。
- R2正式名 `sho-customer-sites-preview`、Standard、default jurisdiction。
- R2管理ドメイン無効、カスタムドメイン0件。非公開を確認。
- workers.devサブドメイン `zodiac-suu`。
- アカウントID/APIトークンの認証成功。アカウントIDはGitHubログ上でマスクされる。

この実行ではテスト配備はスキップ。販売画面ジョブはUbuntuの配布ミラー名の解決失敗で中断し、
510項目を再検証できなかった。単体81件・ローカルR2 6件・Supabaseラッパー3件は合格。
https://github.com/sho-support/sho-support.github.io/actions/runs/43050040929

## 実装済み・実サービス試験は次のCI結果で判定

`preview-target.json` に確認済みのテスト先と有効化フラグを保存。Secretsは追加しない。
明示的な配備コミット・開発ブランチ・全品質チェック・直前の非公開確認・Worker未存在確認を要求する。
既存本番のDNS、販売、バンド、Supabaseには書き込まない。

実R2用のremote binding検証スクリプトと、その同じ処理を実workerd/R2で検証する試験を追加。
予約ID以外への操作と不明な既存コンテンツの上書きを拒否し、書き込み回数・サイズ・残存数を制限する。
実R2と公開HTTPSでの成功は、これから走るpreviewジョブと証跡で別に確認する。
ブラウザ導入は、停止原因となった追加フォントのaptミラーへの依存を外して再実行する。

入力時の余計な空白・改行でアカウントID確認を誤って拒否しないよう、CLIで前後の空白を除去する。

## 直前の検証証跡

- 最終基準コード: `23ae4785235786420427c9b725428bdaf7bbb3d9`
- https://github.com/sho-support/sho-support.github.io/actions/runs/42965130780
- 単体81件、ローカルworkerd/R2 6件、Supabaseラッパー3件、販売画面510項目が合格。
- 実Cloudflareへの読み取りとテスト配備は上記CIではスキップされており、未検証だった。
