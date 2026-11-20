# 顧客専用ドメインの本番準備

2026-11-20 JST。対象は顧客公開専用の `sho-websites.com` ゾーン。

## 取得と検証結果

- 本人のCloudflare画面に `Your domain is ready` と `sho-websites.com` が表示された。`.com` の登録記録も同日10:40 JSTの登録と2027年11月20日10:40 JSTの満了を返した。決済の円換算総額、自動更新の設定、登録者メールの認証状況は未確認。[VerisignのRDAP](https://rdap.verisign.com/com/v1/domain/sho-websites.com)
- 公開DNSで `hazel.ns.cloudflare.com` と `neil.ns.cloudflare.com` の委任およびゾーンのSOA応答を確認した。確認時点のDSは応答のAnswerに存在せず、ルートにA・AAAAの回答なし、`s1000.sho-websites.com` はNXDOMAIN。実配信と公開HTTPSはこれから検証する。[公開NSの照会](https://dns.google/resolve?name=sho-websites.com&type=NS)
- 検証用Workerと非公開R2 `sho-customer-sites-preview` は実動確認済み。本番R2 `sho-customer-sites-production` の非公開設定とバケット限定キーも実検証済み。[本番R2の接続記録](../docs/qa/sales-production-r2-connectivity-20261116.json)
- [Worker設定案](wrangler.example.jsonc) のドライランで、`CUSTOMER_BASE_DOMAIN=sho-websites.com` と本番用R2のバインディングを確認した。ループバックのTLS証明書と架空データで実WorkerにHTTPSを14回送信し、HTML/CSS、更新・巻き戻し、草案と別サイトの素材の拒否を確認した。2階層のホスト名は証明書検証で拒否された。既存の配信単体21件と3プランを含む公開パイプライン11件も合格。

## 本人確認に出す設定案

| 項目 | 設定 |
| --- | --- |
| 顧客URL | `https://s<サイトID>.sho-websites.com/`。例は `https://s1000.sho-websites.com/` |
| ワイルドカードDNS | 種別 `AAAA`、名前 `*`、アドレス `100::`、プロキシ有効、TTL自動 |
| Worker Route | `https://*.sho-websites.com/*` を `sho-customer-sites` に割り当てる |
| Workerの追加URL | `workers_dev=false`、`preview_urls=false` |
| HTTPS | 専用ゾーンのUniversal SSLとAlways Use HTTPSを使用 |

`100::` はWorkerへ誘導するためのプレースホルダー。Workerは `s` に続く4〜10桁のサイトIDを検査し、非公開R2の公開済みリリースだけを返す。Universal SSLの標準証明書が対象にする1階層のホスト名を使う。[ワイルドカードDNS](https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/)・[Workers Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)・[Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/enable-universal-ssl/)・[Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/)

## 承認後の専用ゾーン設定と検査

1. 本人が専用ゾーンのWorker配備・DNS・ルート・HTTPS設定を承認してから、Cloudflare上のゾーン名、アカウント、既存レコード・ルート・HTTPS設定の状態を控える。同名のWorkerやレコードがあれば先に用途を照合する。既存のWorker配備用トークンの記録には、DNSとWorker Routeの書込み権限が含まれていない。[DNS Write](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/)・[Workers Routes Write](https://developers.cloudflare.com/api/resources/workers/subresources/routes/methods/create/)
2. `sho-customer-sites` を配備し、専用ゾーンに表のルートとプロキシ付きレコードを設定する。配備とルート設定を分ける場合は、最初の配備は `routes` を空にする。設定後の配信ホストからCloudflareへの名前解決を確認する。
3. 顧客用ホストで公開証明書の検証とHTTPからHTTPSへの転送を確認する。未割当のサイトID、www、草案、非公開版は顧客コンテンツを返さないことを確認する。
4. 非公開本番R2にr2.devや公開カスタムドメインがないことを確認する。ブラウザへS3キーを渡さず、書込みはサーバー側の顧客prefixへ限定する。
5. 架空サイトを使い、HTML/CSS/画像、相対リンク、キャッシュ、承認前公開拒否、公開・更新・巻戻し、同時更新、他サイト横断拒否を実HTTPSで試験する。320/360/390/430/768/1366幅を確認する。
6. 正式URLが検証できた後だけ `CUSTOMER_BASE_DOMAIN` と `CUSTOMER_HOSTING_DOMAIN_READY` を同じ値に設定する。R2設定と公開モードは承認された本番反映の順序に従う。
7. 異常時は新規顧客の受注・公開操作を止め、既知の正常版へ戻す。URLや親ドメインを無断変更しない。DNSの変更前後・元に戻す値・TTLを非公開の運用記録へ残す。

## 販売開始前

料金9画面・正式見積り・事業者情報・振込先・解約/引き渡しを照合し、実データを別保管して空の環境へ復元する。最新の完了/未完了は `SALES_READINESS_STATUS_20261113.md` と `../docs/SALES_FINAL_CHECK_20261113.md` を参照。実決済・実顧客通知を試験用に発生させない。
