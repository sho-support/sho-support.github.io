# SHO WEB SUPPORT — Customer Hosting v2 / 事業用アーキテクチャ決定案
更新日 2026-11-07
状態: **提案・プロトタイプ**。稼働環境、DNS、データ移行は未実施。現行販売フローの公開先を勝手に変更しない。

## 結論
**お客様に渡すURLと、ホスティング先を分離する。**
無料URLの正式契約上の基準例: `https://s1000.sho-support.com/`（顧客ごとにブラウザのオリジンを分離）
- URLの所有者: SHO WEB SUPPORT（`sho-support.com` の登録・更新・DNS運用をSHOが継続）
- 1顧客1つの不変SITE ID。例: `s1000` はサイトID `1000`。サイト名を変更してもURLは変えない
- HTTPSとDNSはSHOが運用し、顧客にはホスト事業者固有URL（`github.io`, `pages.dev` 等）を案内しない
- ドメイン配下のサイトIDは商品としてのパーマリンク。事業終了・ドメイン失効・停止があれば保証できないため **永続保証はしない**
- 顧客自身の独自ドメインは顧客の名義・更新権限を優先。SSH・レジストラの所有を混同しない

## 技術構成（段階1: 既存販売機能と完全分離）
- 販売／管理UI: 現行Netlify（独自ドメインの本番設定は別途判断）
- 認証・注文・顧客権限・制作ジョブ: 現行Supabase、管理操作は権限検証を維持
- AI生成: 現行 `website-worker`。出力はHTML/CSS/JS/画像などの静的成果物と検査レポート
- 顧客サイトのデータ: **非公開Cloudflare R2**（Standardクラス）
- 顧客サイトのHTTP配信: Cloudflare Workersのワイルドカードルート（後で同等のゲートウェイへ移行可能）。**Pagesのワイルドカードカスタムドメインは未対応**なので使わない
- 入口: `*.sho-support.com` のCloudflareプロキシ＋Workersルート。ただしCloudflare管理下に対象ドメインを置く必要があり、既存のXServer DNSレコード（Resend DKIM/SMTP、販売サイト、www、SPF、DMARCなど）を**移行前に完全複製して確認**。現時点ではネームサーバー変更禁止
- 将来の顧客独自ドメイン: Cloudflare for SaaS（SSL、所有権確認、ホスト→SITE IDマッピング）。設定と実証完了まで顧客独自ドメインの自動提供は販売開始しない

## R2オブジェクト形式（リリースの不変性）
```
sites/1000/releases/<release-id>/index.html
sites/1000/releases/<release-id>/assets/styles.css
sites/1000/releases/<release-id>/assets/photo.webp
sites/1000/active.json
```
`active.json` は `{"status":"live","release":"0123456789ab"}` とする。
1. 保存はリリースIDごとの新しいパス（アップロード途中のものは公開しない）
2. HTML構文、リンク、アセット、画像、スマホ表示、CSP・危険なJSの検査
3. 対象リリースをR2へ全件アップロード、**実在チェック後**にのみ `active.json` を差し替える
4. 切り替え後はURL、HTTPS、内容、リンクを実際のゲートウェイでスモークテスト
5. 失敗時は `active.json` を前のIDに戻してロールバック。旧リリースは一定期間保存
6. 公開前の草案は `status:"draft"`、確認は認証付きの別URL/署名方式。公開Gatewayはドラフトを404とする
7. 配信中のバージョンと承認済みバージョンを監査ログに記録する。顧客が承認する前に本番URLへ出さない

## URLと契約
無料プラン/無料URLは `https://s<SITE-ID>.sho-support.com/` を公式URL候補とする。顧客ごとに異なるオリジンでlocalStorage・サービスワーカーを分離するため、同一ホストのパス区切り方式は採用しない。ただし、**親ドメインを指定するCookie（Domain=sho-support.com）はサブドメイン間で共有され得る**。管理・決済セッションに広域Cookieを使わず、必要なら顧客公開専用の登録ドメインを別途取得する。任意JavaScriptを許す場合はCookie汚染・クロステナントの追加検査が必須。
- `s1000` などのサイト識別子は変更不可。バンド名・会社名による別名は、ドメイン所有・SSL・リダイレクト検証後のオプションとする
- 独自ドメイン契約者はDNSと更新権限を顧客が保持する方針。SHOの管理代行の場合、顧客の登録者情報と移管手段を契約書に明示
- 解約時、期限内にZIP/静的サイト素材をエクスポートできる仕組みを提供し、移行を妨げない
- URLの維持条件: SHOがドメインを所有・更新しサービスを継続する期間。事故・レジストラ停止・DNS障害をゼロとは表明しない
- 保証・補償の範囲、バックアップと復元、サポート時間、修正回数、素材の権利、AIコンテンツの確認責任を販売規約に記載
- 完全無停止や「URL永久不変」「クレームゼロ」という広告文言は使わない

## 規模・コスト（2026-11-07確認の公式料金。実請求は利用量に依存）
- 顧客ごとの個別Pagesプロジェクトは作らない。**Cloudflare Pagesにはワイルドカードカスタムドメイン非対応**の制限があるため、配信はWorkers＋R2方式に統一
- Cloudflare Workers: Free枠は100,000リクエスト/日、CPU 10ms/リクエストなどの制限がある。超過時の拒否・従量課金に備えてPaid切替条件とアラートを事前設計
- R2 Standard: 無料 10 GB-month、Class A 100万/月、Class B 1,000万/月。超過後のストレージ$0.015/GB-month、Class B $0.36/100万、転送料原則無料
- 今回の簡易Readerは公開リクエスト1件につきマニフェストと本体のR2読み取り約2件。HTTPキャッシュ最適化・上限監視は本番前に設計
- Cloudflare for SaaSカスタムホストは無料プランで100件含まれ、追加ホスト約$0.10/件。例えば10,000独自ドメインなら、追加9,900件×$0.10 = **約$990/月（他料金別）**。このコストを初期価格に織り込む必要がある
- 10,000サイト×平均2MBの成果物なら保存約20GB（保存量のみで容量の試算、画像/バックアップ複製を含まない）
- 収益が伸びても無制限・無料・永久の提供を安易に約束しない

## 事業継続・クレーム防止
- ブランドドメインは自動更新・2FA・年1回登録者連絡先確認。停止前60/30/7日通知を自動監視する設計
- DNS変更・HTTPS証明書期限・URLのHTTP 200・主要アセットの200を定期監視（顧客数に応じてサンプリングから増やす）
- R2はストレージであってバックアップではない。別アカウント/別プロバイダーへの世代バックアップ、月次復元訓練が必要
- すべてのサイトに「承認済みリリース」「公開リリース」「直前の正常リリース」を保持
- 公開は原則運営者が実行。公開後の品質確認（PC・スマホ・SEO基本項目・リンク・問い合わせ先・自社広告の混入・noindex）を必須
- 本番で提供者が変わっても公開URLを維持できるよう、顧客向けURLに特定ベンダー名を入れない
- 障害が起きたときの連絡と復旧目標を明記し、顧客が勝手にURLを変更されないようにする

## 販売開始前のゲート（1つでも未完了なら顧客の実公開は禁止）
1. Cloudflare WorkersとR2 Standardバケットを作成し、`workers.dev` の非公開テストで検証。`sho-support.com`のDNSゾーン移転は全レコードのバックアップ・復元・移行テストが通るまで行わない
2. 手動作成のデモ用SITE IDで公開→更新→旧版へ戻すを実環境で確認（SSL、HTTP、レスポンスの隔離を含む）
3. 3プランの生成物で相対パスと画像参照を調整。生成されたHTMLに `github.io` 等の絶対URLがないことを検査
4. Supabaseに `hosting_provider`, `public_url`, `active_release_id`, `last_good_release_id`, `hosting_status` の管理モデルを用意。各操作の権限と履歴を検証
5. `website-worker` でR2へデータ保存する専用出版パイプライン（GitHubへのソースバックアップは可、GitHub Pagesへの公開は停止）
6. お客様レビュー→SHO公開をCloudflare Gatewayへ切り替える。公開URL、LINE本文、管理ページ、料金案内を新URL方式へ統一
7. R2 API障害、アップロード途中、同時公開、失効HTTPS、DNS未反映、顧客AからBへの横断アクセス、解約と復元を故障注入テスト
8. 独自ドメイン商品を提供するならCloudflare for SaaSの証明書・DNS・移管テストを先に通す
9. 本番公開時だけ販売ページのNetlifyを更新。コード変更ごとの自動Productionデプロイは切り離す
10. 利用規約・ドメイン所有／解約移管・月額保守の範囲・返金／停止・事故時通知の内容を作り、法務レビュー

## 変更しないもの
- 現時点のGuns N' Loses公式URL/独自ドメイン
- 既存Netlify販売サイトの本番設定
- Resend SMTP/DKIM/MXとSupabaseログイン
- お客様の現行データ・注文履歴・支払記録
- テスト口座（一般のお客様に送金案内しない）
- 現行Edge Functionの発行処理（実環境E2E合格までは置き換えない）

## 公式資料
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://developers.cloudflare.com/workers/configuration/routing/routes/
- https://developers.cloudflare.com/pages/platform/known-issues/
- https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/limitations/
- https://developers.cloudflare.com/pages/platform/limits/
- https://developers.cloudflare.com/pages/functions/bindings/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/
