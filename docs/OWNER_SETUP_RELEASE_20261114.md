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

Netlify専用プラグインは検索で見つからなかった。最初のGitHub認証は `Authentication Error: Invalid state key` で停止したが、その後本人の手動操作でログインが完了し、操作権返却後の既存プロジェクト画面で認証済み状態を確認した。認証待ちは解消済み。現在の公開停止原因は以下の利用枠であり、ログインの再試行を繰り返さない。

## Netlifyの公開停止原因を実画面で確認

- 既存プロジェクトは `sho-web-support`、本番公開対象は `netlify-sales-staging`、自動公開は有効。現在公開中のコミットは `0eeae81775c86e0c708280fc61286ba88b435b6e`。最新Git HEADが公開済みという意味ではない。
- 最新 `9c7f4da` は `Skipped due to account credit usage exceeded`。公開履歴には本番公開停止の案内があり、`Trigger deploy` は無効。再pushやZIP投入を繰り返しても利用枠は回復しない。
- Freeプランの表示は月300クレジット、請求期間は11月5日〜12月4日。使用内訳は本番公開50回/750クレジット、Webリクエスト0.2、転送0.1、合計750.3。300を超える履歴となった経緯は未確認であり、追加料金が発生したとは解釈しない。
- 残り29.7/30は運用用クレジット。既存公開サイトの維持用であり、本番公開やAgent Runnersには使用不可。画面は公開サイトが引き続き稼働中と明記しているため、「サイト全体が停止」とは報告しない。
- 運用用クレジットの期限は2026年12月5日。期間表示と月次リセットの公式説明から、無料枠の次回更新目安は12月5日と判断する。正確なリセット時刻・タイムゾーンは画面で確認できていない。期限日を過ぎれば自動的に最新コミットが公開されるとも断定しない。
- 公式資料ではFreeの追加クレジット購入は不可。次の周期まで待つか、有料プランへ変更する。Personalの公式表示は月9米ドル/1,000クレジット。本人の契約画面での税・請求額・開始日・更新条件は未確認。有料変更・支払方法登録・自動チャージは実行していない。

確認先：

- https://app.netlify.com/teams/sho-2g7kpko/billing/general
- https://app.netlify.com/projects/sho-web-support/deploys
- https://docs.netlify.com/manage/accounts-and-billing/billing/resume-paused-projects/
- https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
- https://www.netlify.com/pricing/

## 次の操作

1. 認証済みのNetlifyセッションを使い、利用枠の回復を確認する。無料のままなら12月5日が更新目安。有料変更は本人の明示承認と実際の契約条件確認が必要。金額確認前に契約・支払方法登録・自動チャージを行わない。新しいチーム/サイトの作成で上限を回避しない。
2. GitHubで `netlify-sales-staging` のHEADを再確認し、CI合格の限定リリース `9c7f4da` と意図しない差分がないか確認する。実利用枠回復後、既存 `sho-web-support` でGit連携の再公開を1回行い、結果を確認する。開発ブランチの大きなPRは一括mergeしない。
3. Git連携を使用できず手動公開が必要な場合だけ、既存サイトへ準備済みZIPを公開する。新規プロジェクト用ドロップゾーンへ投入しない。アーカイブ内は静的公開ファイル38個。SQL・バックアップ・秘密ファイルは含まない。細かな修正ごとに本番公開せず、ローカル/CI検証後にまとめて反映する。本番公開は公式資料上1回15クレジット。
4. 公開後に設定ページHTTP200、モジュール/スタイル、管理画面リンク、匿名時のログイン誘導、管理者の読取/下書き保存を確認する。本人が氏名・住所・電話・連絡先・振込先を入力する。バックアップ未実施のまま実施確認のチェックを入れない。
5. 以後の正式ドメイン・本番R2・実バックアップ・移行と受注試験は `SALES_FINAL_CHECK_20261113.md` を続ける。設定ページの公開だけで販売開始完了とは報告しない。

公開用アーカイブの生成元は上記コミット。現在の作業用ZIPは `/workspace/shared/sho-sales-settings-release.zip`。場所が消えた場合は同じコミットから `node scripts/build-sales-netlify.mjs` で再生成する。ZIPの生成時刻でSHAが変わるため、再生成時は再計算する。現在のサイズ・SHAは `qa/owner-setup-release-20261114.json`。

## ドメインの事前照会

Verisignの公式RDAPで `sho-websites.com` と `sho-sites.net` はHTTP404だった。登録オブジェクトが見つからないことだけを確認した。レジストラで購入できること・予約/プレミアム指定・初年度/更新税込額は未確認。名前と実見積りを本人が確認するまで購入しない。既存 `sho-support.com` のDNS・メール・バンドは変更しない。
