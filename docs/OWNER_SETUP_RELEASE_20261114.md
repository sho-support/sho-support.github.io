# 本人設定画面の公開準備と再開点

2026-11-14 JST。新しい顧客公開方式の本番移行を行う前に、本人情報・振込先を入力する管理者専用画面を独立して反映する作業。

## 準備・検証済み

- Netlify用の既存ブランチ `netlify-sales-staging` を `509e601eff52dfd2b7aa4c2cd08eb20af3361ecd` から `9c7f4dab3fa312d455968325ae1d951a8b5e3bfe` へ更新。
- 変更は `admin/sales-settings.html` の追加、既存の管理画面2か所からのリンク、実API拒否試験の不正update値の修正。正式顧客の公開や本番DB migrationの適用は行わない。
- 独立API `website-sales-setup` v1は前回配備済み。現在のSupabaseユーザーと管理者レコードを検証し、匿名読取・別Origin・送信/案件作成は拒否。画面の下書き保存は販売を有効化しない。
- GitHub CIのビルドと販売導線試験に合格。今回の実API拒否試験後も注文0・サイト0。振込先未登録。
- https://github.com/sho-support/sho-support.github.io/actions/runs/43502088589
- https://github.com/sho-support/sho-support.github.io/actions/runs/43502088169

## まだ公開されていない

GitHub更新後も `https://sho-web-support.netlify.app/admin/sales-settings.html` はHTTP404。自動デプロイが反映されているとは扱わない。現在の公開HTMLにはNetlifyのURL書換えと古い版との差分があり、GitのHEADと完全一致するとは報告しない。

Netlify専用プラグインは検索で見つからなかった。既存サイトへの公開作業のためブラウザでNetlifyを開き、本人がGitHub方式を選択。安全な認証フォームとGitHub Mobileの端末承認を経た後、Netlifyが `Authentication Error: Invalid state key` を表示した。新しいNetlify本体タブもログイン画面。原因は未確定で、パスワード違いと断定しない。自動再試行は行っていない。

## 次の操作

1. Netlifyの本人ログインを完了する。ログイン方式を勝手に変更しない。秘密値はチャットへ貼らず、安全な認証フォームまたは本人の手動操作を使う。認証後は新しいNetlify本体画面のサインイン済み表示で確認する。
2. 所有する既存サイト `sho-web-support` のデプロイ先・公開設定・利用クレジットと追加課金設定を確認する。新しいサイト・有料プランを作らない。
3. 既存サイトへ準備済みZIPを公開するか、Git連携が既に有効なら対象ブランチの最新コミットを選んで反映する。アーカイブ内は静的公開ファイル38個。SQL・バックアップ・秘密ファイルは含まない。
4. 公開後に設定ページHTTP200、モジュール/スタイル、管理画面リンク、匿名時のログイン誘導、管理者の読取/下書き保存を確認する。本人が氏名・住所・電話・連絡先・振込先を入力する。バックアップ未実施のまま実施確認のチェックを入れない。
5. 以後の正式ドメイン・本番R2・実バックアップ・移行と受注試験は `SALES_FINAL_CHECK_20261113.md` を続ける。設定ページの公開だけで販売開始完了とは報告しない。

公開用アーカイブの生成元は上記コミット。現在の作業用ZIPは `/workspace/shared/sho-sales-settings-release.zip`。場所が消えた場合は同じコミットから `node scripts/build-sales-netlify.mjs` で再生成する。ZIPの生成時刻でSHAが変わるため、再生成時は再計算する。現在のサイズ・SHAは `qa/owner-setup-release-20261114.json`。

## ドメインの事前照会

Verisignの公式RDAPで `sho-websites.com` と `sho-sites.net` はHTTP404だった。登録オブジェクトが見つからないことだけを確認した。レジストラで購入できること・予約/プレミアム指定・初年度/更新税込額は未確認。名前と実見積りを本人が確認するまで購入しない。既存 `sho-support.com` のDNS・メール・バンドは変更しない。
