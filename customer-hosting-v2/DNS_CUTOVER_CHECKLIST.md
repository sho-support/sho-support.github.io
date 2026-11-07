# SHO WEB SUPPORT / DNS移行・公開切替手順（実行禁止の事前手順書）
**まだ実行していない。** Cloudflare、XServer、Netlify、GitHub Pages、Resendの本番環境を変更しない。

## 移行方針
将来の無料URL: `https://s1000.sho-support.com/` （1000は不変SITE ID）。
全顧客を1個のWorker＋非公開R2に格納し、ホスト名で顧客を隔離する。入口ドメインをSHOが保有するため、配信先を後で変更しても同じURLを維持できる設計。

### 現行の保護対象
- `sho-support.com` ドメインの登録・管理先はXServer Domain側。現在のDNS委任情報とTTL、DNSSECを撮影・エクスポート。
- Resendで確認した `no-reply@sho-support.com` 用レコードを保護。
  - DKIMの `resend._domainkey` TXT
  - `rsend` CNAME → `rsend-apne1.forge.rmta.net`
  - `send` CNAME → `send.forge.rmta.net`
  - SPF、DMARC、MX、追加のTXT、CAA、確認用レコードも**現在のゾーンを完全に一覧化**。上記3レコードだけで十分とは断定しない。
- 根ドメイン `sho-support.com`、`www`、`sho-support.github.io`、Netlifyの販売サイトを別々に確認。
- Guns N' Loses公開URLは変更しない。

## 実施前チェック（すべてYESが必須）
1. Cloudflareアカウントの所有者権限と二要素認証を確認。ドメインの自動更新と支払いカードを確認。
2. XServer側の全DNSレコードを**コピーして2人で照合**（A/AAAA/CNAME/TXT/MX/CAA/SRV/NS/DS/TLSA等）。スクリーンショットのみでなく機械可読な記録も保存。
3. Cloudflare側のゾーンを作成してコピー。特にResendメール検証用レコードとSPF重複・DMARCの値を監査。
4. DNSSECのDSレコード/署名設定を調査。DNSSECが有効なのに委任元DSが旧DNSのままだとサイト・メールが停止するため、切替手順と復旧手順を明示。
5. SSLの `*.sho-support.com` カバレッジを確認。Cloudflare Universal SSLは通常第一階層まで。さらに深い階層は対象外なので使わない。
6. Workerが `s[0-9]{4,10}.sho-support.com` のみを配信することを確認。ルート `*.sho-support.com/*` の影響を受ける `www`、`send`、その他サービスは独立したDNSやルート競合をレビュー。不要なワイルドカード公開はさせない。
7. R2バケットは非公開。外部への公開URL、公開S3アクセスキー、クライアントからの直接上書きを有効にしない。
8. 仮のSITE IDで、HTTP 200、TLS証明書、CSS/画像、404、存在しないIDへのアクセス拒否、ブラウザオリジン分離、公開の切替・即時ロールバックをテスト。
9. ネームサーバー変更前に、XServer側へ戻す具体的な復旧手順とTTL/伝播の説明、問い合わせ先を準備。
10. 商用利用の料金、顧客へのURLの説明、解約時の素材引渡し、公開維持プランの契約文面を確定する。
11. Netlify販売サイトの最新デプロイとSupabase認証・メールリンクが現時点の設定で開けることを確認。
12. R2とSupabaseの別拠点バックアップを作成し、1件だけ実際に復元する。

## 切替手順（後日実行する作業）
1. Cloudflareゾーン・TLS・メールレコードの事前確認を済ませ、予定期間を確保。
2. 権威DNSのNSレコード変更を実施。DNSSEC手順も整合させる。
3. 販売サイト、www、Guns N' Loses、LINE、Supabaseのメール・パスワードリセット、Resend署名を複数ネットワークから検査。
4. `s1000.sho-support.com` の接続確認。動作が不完全な場合は顧客へ本番URLをまだ配らない。
5. Workerの公開制御はお客様承認前に「配信不可」。正式承認後にリリースのactiveポインタを有効化。
6. DNS委任後の72時間はHTTP、TLS、メールを重点監視。ログに個人情報・秘密鍵を出さない。
7. 異常時はまずWorker/R2のロールバック、DNS問題の場合はNS元戻しの手順へ。DNSの元戻しも伝播時間が必要で瞬時には戻らないことを案内する。

## 最終的なブロッカー
- Cloudflareはまだ接続されておらず、本番Worker・R2バケット・DNS・証明書は**未作成**。
- Cloudflare用の請求情報が必要か、既存のCloudflareアカウントがあるかは未確認。
- 既存サイトの独自ドメインを自動的に新方式へ切り替えてはいけない。
