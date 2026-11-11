# SHO WEB SUPPORT / 2026-11-12 接続検証

対象ブランチ: `architecture/customer-hosting-v2`。本番DNS・既存販売サイト・バンドサイト・Supabase本番は変更しない。

## 本人による初期設定

- CloudflareのUser API Tokenの発行前概要を画像で確認。
  対象は個別アカウント1つ、Workers Scripts編集、Workers R2 Storage読み取り、Account Settings読み取り。
  有効期限表示は2026-12-12、IP制限なし。
- GitHub Repository Secretsへ `CLOUDFLARE_ACCOUNT_ID` と `CLOUDFLARE_API_TOKEN` を保存した旨の連絡と、2件の名前が並ぶ画面を確認。
- トークン値はチャットで受け取っておらず、Secretsの値を取得・表示しない。

## 今回実行する確認

GitHub Actionsの `inventory` を明示起動し、既存WorkerとR2のメタデータをGETのみで読む。
保存された値の存在と、Cloudflare API認証・権限の成功は別に判定する。
Workerやバケットを作成・変更せず、実接続結果が返るまで成功扱いしない。
入力時の余計な空白・改行でアカウントID確認を誤って拒否しないよう、CLIで前後の空白を除去する。

## 直前の検証証跡

- 最終基準コード: `23ae4785235786420427c9b725428bdaf7bbb3d9`
- https://github.com/sho-support/sho-support.github.io/actions/runs/42965130780
- 単体81件、ローカルworkerd/R2 6件、Supabaseラッパー3件、販売画面510項目が合格。
- 実Cloudflareへの読み取りとテスト配備は上記CIではスキップされており、未検証だった。
