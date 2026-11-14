# SHO WEB SUPPORT: 無料枠優先・100案件目標の容量計画

> 2026-11-13追記：過去の検討記録。現在の料金・専用ドメイン方針・販売可否は `SALES_READINESS_STATUS_20261113.md` と `SALES_DECISIONS_20261113.md` を優先する。既存 `sho-support.com` のDNSを顧客公開へ切り替えない。

2026-11-08 / 本番切替前の設計（新規有料契約なし）

## 決定方針（推奨）
- 顧客のホームページの**公開基盤はCloudflare Workers + R2 Standard**に統一する。
- まず Cloudflare Workers Free + R2 Standardの無料枠で開始。利用量・利用規約が変わればその都度再評価。
- Workers Paid（最低$5/月）への切替とR2 Standardの超過分請求は**同じCloudflareアカウント・URL・データ形式のまま**対応する。Cloudflareの「ドメインプラン」のFree/Proと「Workers課金プラン」は別物。
- 無料枠を使うために顧客ごとのCloudflareプロジェクトやWorkerを作らない。**1 Worker / 1 private R2 bucket / 1ワイルドカードDNS**でまとめて配信する。
- ドメインは最初の顧客にURLを案内する前に確定する。例は `https://s1000.<customer-domain>/`。別の取得済みドメインが望ましいが、その取得はまだしていない。既存`sho-support.com`を利用する場合は販売サイトのCookie・DNS・メールとの干渉を検証する。
- 顧客固有の独自ドメインを使う場合だけ Cloudflare for SaaS の custom hostname を検討。通常の `s1000.<our-domain>` はCloudflare for SaaSの100ホスト無料枠を消費する方式ではない。
- 「100件まで無料」を顧客向けの契約保証として明記しない。「100アクティブサイト程度を無料枠で管理することが社内目標」とする。

## 2026-11-08公式枠
| 項目 | Free | 拡張 |
|---|---|---|
| Workers | 100,000リクエスト/日、CPU 10ms/呼出 | Paid最低$5/月、月1,000万リクエスト含む（超過は従量） |
| R2 Standard保存 | 10GB-month/月 | $0.015/GB-month（無料枠超過分） |
| R2 Class A | 100万回/月 | $4.50/100万 |
| R2 Class B | 1,000万回/月 | $0.36/100万 |
| R2外向け転送 | 料金ゼロ | Standardで料金ゼロ |
| HTTPS | Cloudflare Universal SSL: ルートおよび第1階層のサブドメインを無料カバー | 下層サブドメインは追加証明書が必要になる場合あり |

注意: Worker無料枠はアカウント内の他Workers利用量と共有。R2無料枠超過はR2請求が発生するため、**完全0円保証にはならない**。R2は利用開始時にR2サブスクリプションの追加・請求方法登録が必要になる場合がある。監視メールは上限設定ではない。

## 初期運用ルール（目標100サイト）
- 通常のバンド／店舗／企業向け静的ホームページのみ。動画はYouTube埋込みなどの外部配信を基本にして、動画本体をR2に大量保管しない。
- 画像圧縮・WebP/AVIF・不要素材削除を必須にする。
- 1サイトあたり **現行リリース20MB以下を初期目標**。直前の2バージョンをR2に保管する場合、100サイト × 20MB × 3世代=6GB（容量上の試算、その他データは別）。
- ファイルサイズと画像合計は注文時の合意範囲を別途定める。大容量データが必要な案件は個別見積もり。
- お客様の頻繁な更新でもCloudflare Workerは**配信機能としての再デプロイ不要**。R2の対象サイトを新リリースへ切り替えるだけ。
- コンテンツ公開操作に運営者の最終承認を要求する。
- Worker無料枠が切れた時にFail openで他の顧客サイトやダミーOriginへ迂回しない。安全を優先し、**上限到達前にPaidへ切替**。

## 監視と強制エスカレーション
| 指標 | 黄色（調査開始） | 赤色（プラン変更前倒し） |
|---|---|---|
| Workers 24hリクエスト（アカウント合計） | 60,000 | 80,000 |
| R2保存量（容量月平均の予測値） | 7 GB-month | 8.5 GB-month |
| R2 Class B 月間予測 | 700万 | 850万 |
| Worker CPU time | 中央値/95%値増加 | 10ms制限接近・CPU limit errors |
| 実際の障害 | 5xxや1027が発生したら調査 | 顧客への影響を検知したら公開保護優先 |

※上限到達まで待つ設計ではない。アクセス急増時は警告前に一時的なエラーが起き得る。アラートは故障ゼロ保証ではない。自動アップグレードは**しない**（課金権限を持たせない）。管理者が通知・費用・状態を確認して切替。

## 実際の負荷試算（例）
- 100サイト×1日50閲覧×1閲覧5 Workerリクエスト = 25,000件/日
- 100サイト×1日100閲覧×1閲覧5 Workerリクエスト = 50,000件/日
- 100サイト×1日200閲覧×1閲覧5 Workerリクエスト = 100,000件/日（無料枠上限）
- 10サイト×1日2,000閲覧×1閲覧5 Workerリクエスト = 100,000件/日（10件でも無料枠上限）
- アセットのリクエスト数を最適化し、CDNキャッシュでR2読み取り費用を下げる。ただしWorker Routeに当たるリクエスト数自体は原則減らない。

## 100件より前に有料へ移すべきケース
- サイトの総容量・トラフィックが閾値を超える
- ブログ/EC/動画など、当初の静的サイト範囲を超える製品を販売する
- Workers無料枠のCPU制限が品質を損ねる
- 99件でも運営負担や監視・バックアップに見合うサポート費用が発生する
- 顧客の独自ドメインが多数増えてCloudflare for SaaSの無料ホスト名100件へ接近する

## Supabase Freeの運営上の注意（重要）
- Supabase Freeのプロジェクトは7日間の低アクティビティで一時停止され得る。**公開済み顧客ページはWorker + R2から配信できても、新規注文、管理画面のデータ取得、ログイン、更新依頼、AI制作は停止する可能性がある。**
- Freeは自動DBバックアップの対象外。注文/顧客/承認/公開状態のエクスポートと別保管を販売開始前に実装すること。外部バックアップが有効か定期的に復元検証する。
- 本番を無料で始める場合はSupabaseのpause警告メールと実利用の監視を行い、注文機会損失を許容できない場合は**顧客100人を待たずSupabase Pro（月$25から）**を検討する。同じSupabase内のプラン変更であり、顧客公開URLは変わらない。
- ユーザーが運営するアプリの実動作としてのアクセスが少ない場合に停止されるかは保証できない。自動的に「絶対停止しない」運用にはならない。

## 他の費用は別
- Netlify（販売ページ、必要ならPaid）、Supabase（顧客DB・APIの無料枠）、Resend（メール配信）、Gemini AI制作API、GitHub Actions、独自ドメインの年更新費、バックアップ保存先の費用はCloudflare Workers/R2の無料枠とは**別**。
- 商用運用の妥当性判断は、月ごとの実使用量・問い合わせ工数・生成API費用・アップグレードの採算を含める。
- 料金改定がある場合は公式表示や利用規約を確認してから進める。

## 残件・事前承認が必要なこと
1. 顧客公開専用ドメインを新規取得するか、現行`sho-support.com`の第1階層サブドメインを使うかを確定する。**1人目の正式顧客のURL発行より前**に決定。
2. CloudflareアカウントとDNSゾーンの有無、R2サブスクリプション・決済方法の要件を実画面で確認。
3. Worker＋R2テスト環境でHTTP/TLS、隔離、3世代版切替、障害時の復旧、速度、実ブラウザの検証。
4. Supabase `website-worker` の公開先をGitHub PagesからR2へ変更し、旧環境への公開が起きないことを確認。
5. ブラウザ・LINE・管理画面・料金案内の正式URLを統一し、3プランE2Eテスト合格後にのみ販売サイトを更新。
6. フリー枠の監視は実データで運用。管理者への通知・月間請求の予測値を確認する。

## 資料
- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/r2/get-started/
- https://developers.cloudflare.com/billing/understand/faq/
- https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/
- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/docs/guides/platform/free-project-pausing
- https://supabase.com/docs/guides/deployment/going-into-prod
