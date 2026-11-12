# SHO WEB SUPPORT / 2026-11-12 接続検証

対象ブランチ: `architecture/customer-hosting-v2`。本番DNS・既存販売サイト・バンドサイト・Supabase本番は変更しない。

**現在の到達点：実Cloudflareのテスト配信・R2公開更新復元が成功。販売開始は未承認・未完了。**
最新の実環境再検証は Run 43058922407で合格。Workerの新規作成だけでなく、確認済みの版を照合した更新も実施した。
現在の配信版は `bdd2b1c8-8fa7-4949-9e1a-ab63b5b3cd37`。これを次回更新の照合基準として `preview-target.json` に記録する。
単体85件・ローカルworkerd/R2 8件・Supabaseラッパー3件、販売画面636項目・3プラン模擬申込71項目、
実R2の公開更新復元9項目、実HTTPSの6幅描画チェックが合格。
https://github.com/sho-support/sho-support.github.io/actions/runs/43058922407

現在の架空サイトの公開版は `e6b98198c7267a0ec9e4b0ff`。この再試験のscoped PUTは22回、GET/HEADは76回、
アップロードは10,997 bytes。請求使用量全体を測定した数字ではない。
原本証跡は `evidence/live-preview-update-20261112.json`。検証スクリプトのソースは
`a3aeda4cf312f45240581d11d1d9f72e2bcddb99`、実際のWorker配備ソースは
`3783c531803d215b72e8da8f07dbecc0337f42d6`。

初回更新の直後、Run 43058084289の試験は最初の表示確認で停止した。
その実行で原因を確定できるログは残らず、伝播遅延は推測に留まる。更新版の応答マーカーを待ち、
検証段階を区別するログを追加した後、Workerを再配備せずRun 43058922407で全項目が合格した。
停止を成功扱いしたり、原因を確定したと説明したりしない。

以下は実装・検証の履歴。Supabase本番の公開処理は依然として統合前。
画面修正コミット `0c4694195959b6b22ae36a2744b2b6bfcb976c30` のCI Run 43056715711で、
単体83件・ローカルR2 8件・Supabaseラッパー3件、販売画面636項目・3プラン模擬申込71項目が合格。
最後の320px申込画面とセミ受付画面も再取得して目視し、hidden行と撮影時のヘッダー位置が直ったことを確認した。
https://github.com/sho-support/sho-support.github.io/actions/runs/43056715711

テストWorkerの継続更新に向け、実配備のVersion ID一致を要求する照合を追加。
確認済みの旧版 `0d39602a-b03a-489d-8dcd-2cf30ae0b2bf` とAPIの現在配信版が一致する場合だけ配備する。
不明なWorker・過去の版だけの一致・複数版への分散配信・Worker消失を拒否する。
この照合を使った実更新・復元の結果は、次の配備CIで別に記録する。

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

## 実配備・実R2・HTTPS検証済み

- 実装コミット: `9c4e95a57d2909eef5ee6ebab8b2119fb01db1ab`
- https://github.com/sho-support/sho-support.github.io/actions/runs/43053315467
- Worker: `sho-customer-sites-preview` / version `0d39602a-b03a-489d-8dcd-2cf30ae0b2bf`
- テスト専用URL: https://sho-customer-sites-preview.zodiac-suu.workers.dev
- 単体83件、実ローカルworkerd/R2 8件、Supabaseラッパー3件が合格。
- 販売画面510項目が合格。実URLも6幅の自動描画チェックが合格。
- 実R2で未公開404、未承認拒否、HTML/CSSの公開・更新、同時更新の勝者1件、旧版復元、
  exportのハッシュ検証と新リリース復元、アップロード失敗時の旧版維持、公開HTTPからの書き込み・他顧客指定拒否の9項目が合格。
- 操作量: scoped PUT 22回、GET/HEAD 75回、アップロード10,997 bytes。
  この数字は検証ラッパー内のみ。公開HTTP・一覧取得・配備等は別であり、請求使用量の完全な計測ではない。
- 最終公開リリース: `ad6b3469330ea110e24e2e16`（コンテンツAの復元）。顧客注文・決済・通知なし。
- 証跡artifact: `customer-hosting-live-preview-proof` ID `13870526866`。

画面artifactを目視したところ、CIサーバーに日本語フォントがなく日本語が四角で表示されていた。
この画像を日本語レイアウト検証済みとは扱わない。撮影環境だけに公式Noto CJK Sans2.004の固定blobを導入し、
日本語フォント存在確認を通して販売画面・実HTTPS画面を再撮影する。
`[render-customer-preview]` は再撮影だけを許可し、Worker再配備・R2書き込み試験を繰り返さない。

## 本番の再照合・未解決

本番3Functionを再取得し、website-api v46 / website-customer-access v49 / website-worker v42と前回と同じbundle SHAを確認。
本番には書き込んでいない。customer-accessの実公開、apiの非公開化・ドメイン変更、workerのGitHub Pages処理が残る。
生成HTMLには現行Netlifyの追跡スクリプトが注入されており、そのままでは新方式のpreflightが拒否する。
顧客承認は現状boolのみでリリース・Gitコミットと未結合。並行制作や承認後の変更を防ぐ統合が必要。
公開・復元で同じポインタ内容へ戻る際のETag再一致（ABA）への対策も本番前の未検証事項。
DBの公開ロック・操作IDによるfencingを含め、遅れて到着した条件付き書き込みが復旧後の状態を壊さないことを試験する。
既存APIは英数字のSITE IDを受け付けるが、新Readerの公開IDは数字のみ。既存DBのIDを破壊せず、
固定の顧客公開IDへ対応づける設計と検証が必要。
正式顧客ドメイン・維持契約・S3本番接続・DB整合性回復・別系統バックアップ・3プランの全工程試験は未完了。
架空サイトの承認試験を、Supabaseの実顧客承認や販売開始の完了とは扱わない。
Cloudflare GitHub Appのアクセス対象縮小、課金画面のBudget Alertの再確認は未実施。
管理画面認証ループの原因は特定できず、GitHub Actions/API経由を実証済みの代替経路とした。

本番Supabaseを再取得して `ACTIVE_HEALTHY`、Postgres 17.11.0.003を確認。
主要テーブルのRLSポリシーはauthenticatedのSELECTのみ。管理者は自身の管理者行だけを読め、
サイト・制作ジョブ・ヒアリングは `has_website_site_access(site_id)` による制限を確認した。
同関数と `is_website_admin` はSECURITY INVOKERであり、anon/authenticatedのpublicスキーマCREATE権限はない。
素材用 `website-intake-files` は非公開、上限7,000,000 bytes、許可形式はJPEG/PNG/WebP/GIF/AVIF。
これらの読み取り確認だけで全機能・全権限を検証済みとはしない。

診断の残件：RLS有効でポリシーなし（INFO）、public拡張・漏えいパスワード保護（WARN）、
外部キーのインデックス・主キー・未使用インデックス（INFO）。本番設定やデータを変更していない。
個別の影響と対策はSupabase統合時に確認する。
診断資料：https://supabase.com/docs/guides/database/database-linter
認証資料：https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

商用設計の根拠を再確認：Cloudflare Developer Platform固有条項はコンテンツのホストを認める一方、
素材の権利・顧客へのサポート責任を利用者側に置き、workers.dev/pages.devの変更権も定める。
正式URLは自社または顧客が所有するドメインで別途確定する。Cloudflareのアカウント・サービスアクセス権を
顧客へ再販売する構成とは区別して契約を整える。個別契約の法的適合を保証する確認ではない。
https://www.cloudflare.com/terms/
https://www.cloudflare.com/service-specific-terms-developer-platform/

## 日本語での画面再検証済み

- フォント・撮影環境コミット: `8e3d2ef7e96a6bde76ca499ace19acb1cc813f24`
- https://github.com/sho-support/sho-support.github.io/actions/runs/43054314972
- 公式Noto Sans CJK JP固定blobの一致と、fontconfigから日本語フォントが利用できることをCIで確認。
- 単体83件・ローカルR2 8件・Supabaseラッパー3件、販売画面510項目、実HTTPSの6幅チェックが合格。
- 実HTTPSの320/360/390/430/768/1366pxを全て目視し、日本語描画・重なり・横スクロールがないことを確認。
- 販売画面は36枚を再取得。320pxの申込、販売、テンプレート、Premium作例と1366pxの販売画面を目視。
  320pxの申込見出しで末尾「み」だけの折り返しがあり、「お申込み」を一塊にする修正を追加した。
- この再撮影ではpreviewジョブをスキップ。Workerの再配備・R2試験ファイルの追加なし。
- Chromiumのみ。Firefox・WebKit・実端末での確認は未実施。

## 申込の重複防止修正・3プラン模擬試験（次のCIで判定）

受付済みの確認画面で同意チェックを外して戻すと、ボタンが再び有効になるコードを発見した。
成功状態をメモリにも保持し、同意変更・再読込後も受付済み注文を再送信しないよう修正。
実価格とキャンペーンは変えない。1ページ・セミ・フルと1ページ月額更新の4シナリオを追加し、
APIをブラウザ内だけの模擬台帳へ置き換えて保存、受付表示、同意変更後のロック、再読込、
応答を失った後に同じrequest IDで再試行することを検証する。実Supabaseの注文・通知・決済は呼ばない。
この作業環境のChromium起動はsocket権限エラーで停止したため、ローカルで合格とは扱わずGitHub runnerで実行する。

- 申込重複防止コミット: `ef22327ef7e7b43a08adaad09c32645abc69ac7c`
- https://github.com/sho-support/sho-support.github.io/actions/runs/43055780959
- 単体83件・実ローカルR2 8件・Supabaseラッパー3件、画面510項目と模擬申込55項目が合格。
- 追加40枚の画面から320px見出しの修正、セミの22,000円・3か月更新無料、1ページ月額更新込み22,000円を目視。
- 同じ確認で、hidden属性の行がdisplay:gridに負け、空の追加相談行や対象外のテンプレート行が見える問題を発見。
  申込と最終確認の両方を修正し、関連21画面・6幅でhidden属性が実際に非表示であることも検査する。
  受付画面の撮影時にはスクロール位置を先頭へ戻し、stickyヘッダーが画像の途中に写る状態を避ける。
- 実R2試験の原本JSONを `evidence/live-preview-20261112.json` に保存。実行時のソースコミットと未検証範囲を保持する。

## 直前の検証証跡

- 最終基準コード: `23ae4785235786420427c9b725428bdaf7bbb3d9`
- https://github.com/sho-support/sho-support.github.io/actions/runs/42965130780
- 単体81件、ローカルworkerd/R2 6件、Supabaseラッパー3件、販売画面510項目が合格。
- 実Cloudflareへの読み取りとテスト配備は上記CIではスキップされており、未検証だった。
