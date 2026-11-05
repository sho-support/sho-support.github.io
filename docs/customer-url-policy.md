# SHO WEB SUPPORT — お客様URL固定・納品運用基準

更新日: 2026-11-05

## 決定事項

- **名刺・看板・チラシに掲載する正式URLは、サービス提供者が管理できる独自ドメインのみ。** `github.io`、`pages.dev` などホスティング事業者が所有するURLを正式納品URLとして扱わない。
- 制作元GitHubリポジトリと正式URLは分離する。GitHubはコード管理・必要に応じた公開先として引き続き利用可能。
- 既に公開した正式URLは、サーバー移転・リポジトリ変更・制作担当変更があっても、DNSとホスティング設定を切り替えて維持する。
- **最も移管しやすい選択肢はお客様名義の独自ドメイン。** 運営管理サブドメインを標準提供する場合は、ドメインの維持費・管理期間・サービス終了時の取り扱いを利用条件に明記してから販売する。
- 未取得・未設定のドメイン名は広告や契約で確定URLとして記載しない。

## 公開前チェック（全3プラン共通）

1. お客様が正式URLの文字列を承認済みであること。スペル、ハイフン、末尾ドメインを確認する。
2. ドメインの登録名義、更新期限、支払者、DNS管理者、サービス終了時の扱いを記録する。
3. GitHub Pagesであれば、リポジトリのカスタムドメイン（CNAME）と正式URLが一致すること。ドメインを先に検証し、DNS設定を完了する。
4. 正式URLのHTTPS接続、証明書、リダイレクト後のホスト名を検証する。
5. 画像、CSS、JS、全ページの内部リンク、スマホ表示を確認する。
6. 本番URLが完成するまで、印刷物・QRコード・SNS固定リンクへの掲載を案内しない。
7. 管理画面で「公開」を実行し、公開先のURLが承認された正式URLと一致することを確認する。
8. 公開後もドメイン更新・HTTPS・リンクを定期的に点検する。

## 既存コードでの保護

- `supabase/functions/_shared/website.ts` の `normalizeCustomerHostname` は無料ホスティングURLやテストドメインを拒否。
- `requireStablePublicationUrl` はGitHub PagesのCNAME一致と正式URLのHTTPS到達性を検証。
- `website-api` および `website-customer-access` は正式公開時に検証を要求。
- 公開後のドメイン変更は自動で許可せず、個別移行手続きにする。

## サブドメイン提供の技術的注意

- GitHub Pagesはリポジトリごとにカスタムドメインを設定可能。各サブドメインを個別にDNS登録・検証する。
- GitHubはワイルドカードDNSを推奨していない（ドメイン乗っ取りリスク）。
- Cloudflare Pagesはワイルドカード形式のカスタムドメイン（`*.example.com`）をサポートしない。将来の多数サイト運用には、個別ドメイン設定またはCloudflare Workersなど別構成の設計が必要。
- **DNSが変わってもドメイン所有・更新が継続する限りURLを維持できる**。ただし所有権喪失、更新忘れ、停止、サービス終了まで含む永久保証はできない。

## 販売開始前の未完了項目

- 運営管理の標準ドメインを選び、実際に取得・DNS管理を設定する。
- サブドメインの発行・更新・解約ルール、費用負担を契約書と注文導線に反映する。
- テストサイトを実ドメインで公開し、DNS/HTTPS/画像/リンクを確認する。
- GitHub Pagesから別ホストへの移転を1件試し、正式URLが変わらないことを確認する。
- フルオーダー5ページの実AI生成と、注文から納品までの通し検証を完了する。

## 公式参考

- https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages
- https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/verifying-your-custom-domain-for-github-pages
- https://developers.cloudflare.com/pages/platform/known-issues/
- https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/
