# 顧客専用ドメインの本番準備

2026-11-20 JST。対象は顧客公開専用の `sho-websites.com` ゾーン。

## 取得と検証結果

- 本人のCloudflare画面に `Your domain is ready` と `sho-websites.com` が表示された。`.com` の登録記録も同日10:40 JSTの登録と2027年11月20日10:40 JSTの満了を返した。決済の円換算総額、自動更新の設定、登録者メールの認証状況は未確認。[VerisignのRDAP](https://rdap.verisign.com/com/v1/domain/sho-websites.com)
- 公開DNSで `hazel.ns.cloudflare.com` と `neil.ns.cloudflare.com` の委任およびゾーンのSOA応答を確認した。確認時点のDSは応答のAnswerに存在せず、ルートにA・AAAAの回答なし、`s1000.sho-websites.com` はNXDOMAIN。実配信と公開HTTPSはこれから検証する。[公開NSの照会](https://dns.google/resolve?name=sho-websites.com&type=NS)
- 検証用Workerと非公開R2 `sho-customer-sites-preview` は実動確認済み。本番R2 `sho-customer-sites-production` の非公開設定とバケット限定キーも実検証済み。[本番R2の接続記録](../docs/qa/sales-production-r2-connectivity-20261116.json)
- [Worker設定案](wrangler.example.jsonc) のドライランで、`CUSTOMER_BASE_DOMAIN=sho-websites.com` と本番用R2のバインディングを確認した。ループバックのTLS証明書と架空データで実WorkerにHTTPSを14回送信し、HTML/CSS、更新・巻き戻し、草案と別サイトの素材の拒否を確認した。2階層のホスト名は証明書検証で拒否された。既存の配信単体21件と3プランを含む公開パイプライン11件も合格。

## 配信用Workerの配備とゾーンの権限

11月20日 JST。本人の「専用ドメインの配信設定OK」を受け、`sho-customer-sites` をCloudflareに新規配備した。稼働版 `849b6abe-0491-41a1-af2b-986bb72614fc` が100%、`workers.dev` とプレビュー用URLはいずれも無効。`CUSTOMER_BASE_DOMAIN=sho-websites.com`、本番R2バインディング、バケットの非公開設定、`sites/` 配下が空であることをCloudflare APIで照合した。[初回配備と実機照合](https://github.com/sho-support/sho-support.github.io/actions/runs/44658591143)

専用ゾーンは対象アカウント内で `active`。同じトークンでDNSレコード、Worker Route、Universal SSL、Always Use HTTPSの事前照会はいずれも403だった。接続処理は書き込み前に停止し、本人による管理画面での設定に切り替えた。[APIからの接続処理](https://github.com/sho-support/sho-support.github.io/actions/runs/44659094557)

## 承認済みの専用ゾーン設定

| 項目 | 設定 |
| --- | --- |
| 顧客URL | `https://s<サイトID>.sho-websites.com/`。例は `https://s1000.sho-websites.com/` |
| ワイルドカードDNS | 種別 `AAAA`、名前 `*`、アドレス `100::`、プロキシ有効、TTL自動 |
| Worker Route | `https://*.sho-websites.com/*` を `sho-customer-sites` に割り当てる |
| Workerの追加URL | `workers_dev=false`、`preview_urls=false` |
| HTTPS | 専用ゾーンのUniversal SSLとAlways Use HTTPSを使用 |

`100::` はWorkerへ誘導するためのプレースホルダー。Workerは `s` に続く4〜10桁のサイトIDを検査し、非公開R2の公開済みリリースだけを返す。Universal SSLの標準証明書が対象にする1階層のホスト名を使う。[ワイルドカードDNS](https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/)・[Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)・[Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/enable-universal-ssl/)・[Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/)

## Cloudflareの管理画面で使った手順

1. `sho-websites.com` の **DNS → Records → Add record** で表のAAAAレコードを保存する。同じ名前のレコードが存在する場合は先に内容を照合する。[DNSレコードの追加](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/)
2. **Workers & Pages → sho-customer-sites → Settings → Domains & Routes → Add → Route** でゾーン `sho-websites.com` を選び、表のパターンを追加する。[Worker Routeの追加](https://developers.cloudflare.com/workers/configuration/routing/routes/#set-up-a-route-in-the-dashboard)
3. `sho-websites.com` の **SSL/TLS → Edge Certificates** でUniversal SSLの状態を確認し、Always Use HTTPSをオンにする。[HTTPS転送の設定](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/)

## 実ドメインの接続確認

11月20日 JST。本人の設定後、画面で Always Use HTTPS がオンになっていることを確認した。`s1000.sho-websites.com` は公開DNSでA・AAAAともに応答し、HTTPは同じパスのHTTPSへ301転送された。外部のランナーでは証明書チェーンとホスト名の検証を有効にして接続し、TLS 1.3と `*.sho-websites.com` を含む公開証明書を確認した。`s1000` と `s1001` の `/healthz` は200、未割当サイトの `/` と `www` の `/healthz` は配信Workerが404で返した。[公開HTTPSの検査結果](https://github.com/sho-support/sho-support.github.io/actions/runs/44662782026)

## 接続確認後の作業

1. 架空サイトを使い、HTML/CSS/画像、相対リンク、キャッシュ、承認前公開拒否、公開・更新・巻戻し、同時更新、他サイト横断拒否を実HTTPSで試験する。320/360/390/430/768/1366幅を確認する。
2. 正式切替の手順に沿って、検証した `sho-websites.com` を Supabase の `CUSTOMER_BASE_DOMAIN` と `CUSTOMER_HOSTING_DOMAIN_READY` に設定する。R2設定と公開モードも本番反映の順序に従う。[正式切替の手順](../docs/SALES_CUTOVER_RUNBOOK_20261116.md)
3. 異常時は新規顧客の受注・公開操作を止め、既知の正常版へ戻す。DNSの変更前後・元に戻す値・TTLを非公開の運用記録へ残す。

## 販売開始前

料金9画面・正式見積り・事業者情報・振込先・解約/引き渡しを照合し、実データを別保管して空の環境へ復元する。最新の完了/未完了は `SALES_READINESS_STATUS_20261113.md` と `../docs/SALES_FINAL_CHECK_20261113.md` を参照。実決済・実顧客通知を試験用に発生させない。
