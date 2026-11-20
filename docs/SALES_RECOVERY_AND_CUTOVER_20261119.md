# HP販売の復旧確認と販売開始条件

2026-11-19 JST。対象は **sho-web-support** と **architecture/sales-cloudflare**。作業開始時のHEADは `9140e8b2ccd056bf1b9dc03709a38c11bf6f1ccd`。

11月20日に本人が `sho-websites.com` を取得し、配信Worker・DNS・公開HTTPSの実接続を確認した。[取得と配信基盤の照合](../customer-hosting-v2/DNS_CUTOVER_CHECKLIST.md)

## 実環境と固定候補の照合

| Edge Function | バージョン | JWT検証 | コードの照合 |
| --- | ---: | --- | --- |
| website-api | 56 | true | runtimeの4ファイルと一致 |
| website-worker | 50 | true | runtime-baselineの4ファイルと一致 |
| website-order-api | 21 | false | runtimeの3ファイルと一致 |
| website-customer-access | 59 | false | runtimeの4ファイルと一致 |
| website-preview | 18 | false | runtimeの3ファイルと一致 |
| website-sales-setup | 7 | false | 全16ファイル取得。固定候補との差は共通R2モジュール1ファイル |
| website-line-webhook | 25 | false | runtimeの3ファイルと一致 |
| website-sales-readiness | 9 | false | 現行bundleと全2ファイルのハッシュを取得 |

商用6関数の現行bundleハッシュは[固定候補manifest](../sales-hosting/release-candidate.json)の切替前ハッシュと一致。固定元 `c3c3af8114773a22b3f4d442dc0888908d02ee1e` の6関数・依存を含む37ファイルと、3migrationのblob SHA・SHA-256・バイト数も確認した。

照合時点で商用3migrationはHosted Supabaseで未適用。公開用テーブルは未作成、稼働中の制作ジョブは0件。販売者情報は4項目の下書きがあり、振込先はテスト銀行・普通0000000。本番口座、契約承認、バックアップの承認は未登録。

## LINE受付の実機テスト

2026-11-19 JSTに注文 `9000001001` で合格。本人が公式LINEにテスト文を送り、同じ注文IDとテスト銀行・普通0000000の受付返信を受け取った。Hosted Supabaseの読み取りでLINE連携済み、受付専用フラグ、テスト口座の許可を照合した。注文は正式見積りなし・顧客サイト未作成で、公開URLの予約テーブルも未作成だった。送信後の関数確認時はv25が稼働していた。[当日の実機テストに使った手順](SALES_ACCEPTANCE_START_20261116.md)

## 隔離環境で実施した復旧と移行

- 保存済みのSQLを外部接続のない空のPostgreSQL 17.12に復元し、永続64テーブルの内容と件数が元の指紋に一致した。pg_netの応答キャッシュは空で、HTTPキューの再生は抑止した。Storageの9ファイルと暗号化済み保全の既存記録も照合した。[保全・復元証跡](SALES_BACKUP_RESTORE_20261118.md)
- Auth v2.197.0をこの復元DBで起動した。架空の8文字パスワードを持つアカウントを隔離DBの複製に引き継ぎ、同じパスワードで再ログインとセッション更新が通った。誤パスワードと旧署名のトークンは拒否され、既存のアプリ管理者判定も通った。復旧先での実利用者の再ログインは未検証。
- 固定された3migrationを復元DBで試した。意図してエラーを発生させたトランザクションが全件取り消されることと、各件を順に確定しても既存行の内容が変わらないことを確認した。新規8テーブルのRLSとサーバー専用RPCの権限が機能し、アップロード・有料AIは初期停止だった。

### 招待とパスワード再設定メール

2026-11-19 JST。新しい架空DBとAuth v2.197.0を外部につながらない環境で起動した。ローカルSMTPで招待と再設定の2通を受け、現在のCloudflare販売画面のHTTPSパスワード設定先とポータルへの戻り先を確認した。招待後の初回ログイン、再設定後の新パスワードでのログイン、旧パスワードと使用済みリンクの拒否まで合格。現行の再設定関数v11と管理API v56に販売画面の戻り先が記録されていることを読み戻した。戻り先と認証を含むアプリの隔離テスト24件も合格。Hosted Supabaseの実SMTPによる配信と復旧先への設定移行は未検証。[SupabaseのAuthローカル試験手順](https://supabase.com/docs/guides/auth/testing-auth-flows)

## 外部設定の復旧で確認する対象

| 対象 | 復旧時の確認 |
| --- | --- |
| Auth | サイトURL、招待・再設定先、8文字の最小長、SMTP、必要な認証プロバイダー、復旧先の署名鍵とAPIキー。Hosted Supabaseの実SMTPでの着信とHTTPSの戻り先、復旧先での既存利用者による再ログインを検証する。 |
| Supabase Storage | 非公開バケット、権限、DBメタデータと保存済み9件を組み合わせ、対象者だけが素材にアクセスできることを復旧先で確認する。 |
| Edge Functions | バージョン、全ソース、固有の依存、JWT設定と関数内権限、Secretsの保存元を照合する。 |
| LINE | 現在のHP販売チャネルで本人による受付・返信・DB連携を確認済み。認証方法・署名・Webhook・運営者通知先は復旧先で照合する。現行v25での署名付き空Webhookの再確認は未実施。 |
| GitHub | 非公開原本の管理権限、固定コミットからの読み出し、取得した原本からの再公開。GITHUB_PAGES_TOKENは原本操作にも使う。 |
| Cloudflare | 専用ゾーン、DNS、HTTPS、配信Worker、非公開R2、バケット限定キー、公開pointerとDBの一致。既存の本番R2接続試験を再利用する。 |

Secretの値は各サービスの管理画面・非公開の保存元で取り扱う。復旧用設定と外部サービス認証の範囲は[Supabaseの復元ガイド](https://supabase.com/docs/guides/self-hosting/restore-from-platform)を参照。

## 後継ソースの修正と検査範囲

- Cloudflareの販売画面について、切替前は仮注文と制作・公開の各操作を409で止める。新規注文IDは現行の数字のみの形式で発行する。
- ヒアリングと再送、顧客確認、プレビュー、更新フォームのリンクを現在のCloudflare販売フロントへ案内する。顧客サイトの正式URLは専用ドメイン上で固定する。
- 販売者情報を下書き保存しても、既存のテスト口座と受付専用注文の許可リストを保持する。
- 顧客配信用の設定例に、検証済みの本番R2バケット名を反映した。ドメイン欄は例示用の値を使用している。
- 3プランで実HTTPハンドラーを使い、受付、見積り、同意記録、架空入金確認、素材受付、制作キュー、承認、ローカルR2配信、更新フォーム、非公開を検査した。LINE連携・素材メタデータ・制作成果物は架空。更新版の公開と巻き戻しはローカルR2のパイプラインで検証した。

後継ソースは `07713e57f46206d26d14d987b4d4a62f6ceeb80a` に固定した。[後継候補manifest](../sales-hosting/release-candidate-20261119.json)に6関数・依存37ファイル・3migrationと、切替前へ戻す34ファイルの参照先・ハッシュを記録した。切替直前に実環境と照合する。

## 11月20日の切替前照合

- Hosted Supabase `sho-web-support` は正常稼働。商用6関数の版・JWT設定・配備bundleのSHA-256が後継候補manifestの切替前記録と一致した。固定コミットの37ソースと3migrationは現行作業ブランチの内容と一致し、復旧用34ファイルもSHA-256が一致した。[後継候補manifest](../sales-hosting/release-candidate-20261119.json)
- 商用3migrationは履歴に未登録。追加予定の8テーブルは0件、顧客サイト・制作ジョブは0件、注文はLINE受付専用の1件だけで正式見積りなし。販売者情報4項目の保存とテスト銀行・普通0000000の許可設定を確認した。正式振込先、契約承認、バックアップ実施の承認は未登録。取得したのは件数と設定の有無だけ。[LINE受付の範囲](SALES_ACCEPTANCE_START_20261116.md)
- 取得済みの `sho-websites.com` を隔離テストに設定し、3プランの見積り・同意・架空入金確認・承認・配信・更新・巻き戻しを検証した。PostgreSQL相当の隔離DB、ローカルR2、架空の通知を使って30件合格。独立したPostgreSQL接続を要する並行予約1項目はこの実行ではスキップ。Hosted Supabaseでの受付から納品までの試験は未実施。[公開HTTPSの実接続結果](https://github.com/sho-support/sho-support.github.io/actions/runs/44662782026)

## 本人の確認対象と原案

| 項目 | 原案 | 確認すること |
| --- | --- | --- |
| 顧客専用ドメイン | `sho-websites.com` を取得・接続済み。標準URLの例は `https://s1000.sho-websites.com/`。 | 登録者メールの確認状況と最終請求額は未確認。[公開HTTPSの照合](../customer-hosting-v2/DNS_CUTOVER_CHECKLIST.md) |
| 制作と維持 | 制作15,000円／22,000円／30,000円〜。公開から12か月込み、2年目から税込6,000円／年。満了30日前までに案内し、申込みと入金で次の12か月。公開後30日は合意範囲内の無料調整。 | 見積りに合計、制作範囲、納期、支払期限、継続条件を記載。 |
| 内容更新 | LIVE 1,000円／回、通常2,500円／回、月8回まで7,000円／月。対象のセミ・フルは3か月無料。 | 月8回の上限と無料期間の適用範囲。 |
| 解約・引き渡し | 入金前は無料。着手前は発生済みの実費、着手後は完了作業と外部実費に応じて精算する。完成ファイルと素材の利用条件、設定説明を渡し、満了後30日を引き渡し確認期間とする。 | 返金計算、30日後の削除範囲、顧客管理型への移管時の費用。 |
| 販売者情報・銀行 | 保存済みの4項目を確認し、開業時に必要な事業用電話だけ差し替える。 | 本番口座への切替は販売開始前の管理画面で実施。現時点はテスト口座を維持。[販売準備設定](https://sho-web-support-preview.zodiac-suu.workers.dev/admin/sales-settings.html) |

11月19日にCloudflare Registrarで `sho-websites.com` が登録可能と表示された。初年度US$11.17、通常更新年US$11.17。Verisign RDAPでも登録レコードなし。日銀の同日17時の1ドル159.70円を使うと約1,784円。決済時の円額には税・カードの換算レートと手数料が反映される。取得前に登録可否と総額を再確認する。[候補名の検索結果](https://www.cloudflare.com/domains/search?q=sho-websites.com)・[Cloudflare公式価格](https://pricing.registrar.cloudflare.com/?q=com)・[日銀の外国為替市況](https://www.boj.or.jp/statistics/market/forex/fxdaily/fxlist/fx261119.pdf)

販売者情報を請求時の開示方式にする場合は、契約判断前に提供できる対応を整える。正式見積りへの同意前に、総額、支払時期・方法、提供時期、解約条件を確認できるようにする。消費者契約の解約料は法令上の平均的な損害額を超える部分が無効となるため、返金条件は提供作業と費用で確認する。[通信販売ガイド](https://www.no-trouble.caa.go.jp/what/mailorder/)・[最終確認画面の資料](https://www.caa.go.jp/notice/assets/consumer_transaction_cms203_240315_02.pdf)・[消費者契約法の資料](https://www.caa.go.jp/policies/policy/consumer_system/meeting_materials/assets/consumer_system_cms101_210325_02.pdf)

### 保存済みAPIでのドメイン登録権限の確認

11月19日 JST。共有ブラウザのCloudflareサインインは403。GitHub Actionsに保存済みのトークンで別途確認したところ、対象アカウントのWorkers APIは200、`sho-websites.com` のRegistrar登録可否を照会するAPIは403（Cloudflareエラー10000）だった。トークンはWorkers配備に使える。発行時に確認した権限はWorkers Scripts編集、Workers R2 Storage読み取り、Account Settings読み取り。[最初の接続記録](../customer-hosting-v2/INTEGRATION_STATUS_20261112.md)・[今回のAPI確認](https://github.com/sho-support/sho-support.github.io/actions/runs/44547923210)

この確認時点では未購入。APIで登録するには対象アカウントの Registrar Write 権限と、Cloudflareに保存した既定の支払い方法、既定の登録者情報、登録規約への同意が必要。11月20日に本人が管理画面から1年分を取得した。[Cloudflare Registrar API](https://developers.cloudflare.com/registrar/registrar-api/)・[ドメイン登録手順](https://developers.cloudflare.com/registrar/get-started/register-domain/)

## 切替の判断

残るのは外部連携を含めた全基盤復旧、正式口座と契約承認、商用migrationと正式関数への切替、架空注文での実サービス通し試験。現行の後継候補ではホスティングモードの切替がCloudflare販売画面の一般受付にも影響するため、実環境の切替は販売条件の承認と切替手順に沿って行う。正式見積りはテスト口座を拒否し、受付専用注文は制作や公開へ進まない。契約原案の内容はチャットで先に確定できる。[切替の順序](SALES_CUTOVER_RUNBOOK_20261116.md)

### 11月20日午後の照合と販売準備

- 13時台の読み取りで、販売者情報4項目、テスト銀行・普通0000000、LINE受付テストの連携と口座の許可設定を照合。正式受注・顧客サイト・制作ジョブは0件。商用3migrationと正式口座、正式販売条件・保全実施の承認は未登録。
- 本人が、振込前は無料でキャンセルでき、承認したものの公開・納品後はお客様都合の返金を原則不可とする方針を採用した。[採用した方針と精算条件](SALES_OWNER_SETUP_20261116.md)
- 着金前の注文の取消し、取消しと案件作成が重なった場合の処理、LINE再受信での状態維持を隔離環境で確認した。候補の7関数・38ファイルと3migrationは固定コミットに一致し、現在配備中の7関数の版・JWT設定・bundleハッシュと復旧ファイルを照合した。[11月20日候補](../sales-hosting/release-candidate-20261120.json)・[DBと操作画面の検証](https://github.com/sho-support/sho-support.github.io/actions/runs/44672871412)・[LINEの検証](https://github.com/sho-support/sho-support.github.io/actions/runs/44672871499)
- 本人側に今必要なのは、Cloudflareから登録者メールの確認依頼が届いている場合の確認。実際の確認状況は未確認。正式口座と販売条件の保存は、切替前に新しい版の本人設定画面で行う。[登録者メールの確認手順](https://developers.cloudflare.com/registrar/troubleshooting/#email-verification-required)

### 11月20日の販売準備設定の修正

設定関数 `website-sales-setup` の下書き保存処理を修正し、v8を実環境に配備した。配備前の16ファイルを照合し、保存処理1ファイルだけを変更。模擬DBで、テスト振込先とLINE受付許可の保持、未ログイン・非管理者の拒否、テスト振込先での販売承認拒否を確認した。配備後は16ファイルと認証設定を読み戻し、保存済み販売者情報・テスト振込先・LINE受付許可・契約と保全の設定を配備前と照合した。実注文・顧客サイト・制作ジョブは0件で、正式口座・販売承認は未登録。[配備元の保存処理](../sales-hosting/runtime-baseline/website-sales-setup-test-bank-save.ts)

既存の販売プレビューへ、最新の管理画面、無料試作、料金表の画像保存、合意済みの返金条件を反映した。管理画面と46ファイルの内容照合を含めて静的60項目、5 APIの事前通信、未ログイン時の拒否、未署名LINE webhookの401を確認した。反映後にテスト口座・LINE受付用の許可設定と販売承認の状態を再照合した。実サービスの公開・納品までの通し試験は引き続き未実施。[管理画面](https://sho-web-support-preview.zodiac-suu.workers.dev/admin/sales-settings.html)・[配備と検査結果](https://github.com/sho-support/sho-support.github.io/actions/runs/44677238024)
