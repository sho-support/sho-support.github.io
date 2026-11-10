# SHO WEB SUPPORT 実環境照合と開発記録

確認日 2026-11-11。対象ブランチは `architecture/customer-hosting-v2`。

## Cloudflare認証

Googleログイン、パスワード認証、端末での本人確認を経てCloudflareへ戻ったが、画面に
`Unable to sign in. Try again or use your email and password.` と表示された。
画面から拒否の原因は特定できていない。Workers一覧、R2の実名・設定、OAuth権限、予算通知設定は未確認。

公式資料による代替経路は、Google登録の既存アカウントに専用パスワードを設定してログインする方法。
新規パスワードの設定は本人操作で行う。APIトークンの作成にもパスワードが必要になる場合がある。
GitHub ActionsとWranglerを使う経路も、初回のCloudflare認証・権限設定は必要。

- https://developers.cloudflare.com/fundamentals/user-profiles/login/
- https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/

## 実際のSupabase状態

`sho-web-support` は `ACTIVE_HEALTHY`。website系14テーブルのRLS有効を確認。
RLSポリシーなし5件、public内pg_net、漏えいパスワード保護無効という診断は継続している。
ポリシーなしのテーブルを一律に公開していない。今回のDB確認は読み取りのみ。

取得した実配備バージョンは次のとおり。

| Function | Version | JWT検証 | 配備バンドルSHA256 |
|---|---:|---|---|
| website-api | 46 | true | 18c23eea0492eedbd709ba553573c8d96c20ecc661d3e1bf0d56c87465e6cfb4 |
| website-customer-access | 49 | false | 8c5ac3f50a11ce46a67243c8df89e91208dd25ccf9252f686d074198977cc950 |
| website-worker | 42 | true | b8f80600f0114e493c1d932400d91da3690ade75fe3e7f853d0334aa71d8d0a2 |

GitHubの該当コードと実配備版は一致しない。次のデプロイでは実配備との差分を取り込んで回帰を防ぐ必要がある。
特に共有 `website.ts` はFunctionごとの配備バンドルにも差があり、古い共有ファイルによる一括再配備は危険。

以前の引継ぎにある「2か所の顧客向け公開経路」は現行配備と区別する。
現行 `website-api` は `review_action.publish` を403、`admin_transition.live` を409で拒否する。
`website-customer-access` の `admin_publish_site` は管理者を検証してからGitHub Pages公開を実行する。
`website-api` には非公開切替、プレビュー保護、ドメイン変更などのGitHub Pages操作と、到達しない旧公開コードが残っている。
現行 `website-worker` の追跡スクリプトはNetlify上へ移っており、GitHub Pages参照という以前の記録は更新が必要。
Cloudflare統合時は、公開だけでなく非公開化・ドメイン変更・プレビュー・生成・通知を同時に整理する。

## 今回の実装

- 全ファイルの保存とSHA256照合が終わった後に、顧客とリリースに結びつく完了マニフェストを保存する。
- 公開時にも全ファイルの存在、サイズ、記録したダイジェストを照合する。index.htmlだけ残った途中失敗版は公開できない。
- R2の条件付きPUTによる同時公開の競合拒否を維持する。
- HTMLをUint8Arrayで渡して検査を回避する経路と、JS等に旧管理URLを埋め込む経路を閉じる。
- 同名CSS・JS・画像の更新や切戻しで古いキャッシュが混ざるのを避けるため、全公開アセットを再検証する。
- 検証済みリリースを全ファイルの実ダイジェスト照合付きでエクスポートする。
- `preview-worker.mjs` は専用workers.devホストと架空ID `9000001000` だけを受け付ける。公開用Workerにはホスト書換えを追加していない。
- `configure-preview.mjs` は確認済みテストバケット名と正確なホスト名を受け取り、既存DNSへのルートを持たない設定を作る。
- GitHub Actionsに単体テスト、ローカル実行環境テスト、ビルド検査、販売画面6幅の検査を用意する。
- 実デプロイは手動実行入力と環境変数による有効化の両方が必要。認証・既存資源の照合が完了するまで無効状態で扱う。
- NetlifyのGit連携ビルドはこの開発ブランチを除外する。Netlifyの仕様上、build hookはignoreを回避するため別途管理が必要。

## 検証結果

- 変更前のNodeテスト41件が合格。
- 変更後の単体テスト54件が合格。
- ローカルworkerdとR2を使う検査は親テスト1件とサブテスト5件が合格。
  未承認版非公開、条件付きPUTの競合拒否、旧版復元、別の空バケットへの復元、未完了版拒否を実行した。
- `wrangler deploy --dry-run` が合格。Cloudflareへのアップロードは実行していない。
- 既存販売ビルド内の回帰検査23件が合格。
- 実配備ソースをローカルで実行し、未認証・管理者以外による公開／AI起動の拒否5件を検証した。
  外向き通信と書き込み処理は失敗させるモックを用いた。Supabaseゲートウェイを通る実API試験ではない。
  本番エンドポイントへの未認証POST試験は、実装不備時の状態変更リスクを理由に自動承認レビューが拒否したため未検証。
- 販売トップ `https://sho-web-support.netlify.app/` はHTTP 200。残クレジットと配備コミットは未確認。
- この作業環境はAF_UNIXソケットを作れず、ローカルChromium起動が失敗した。画面検査はGitHub Actionsで実施し、実行結果と画像を確認する必要がある。
- 上記ローカルR2の復元試験は、本番Cloudflareや別プロバイダーへのバックアップ運用の検証とは区別する。

## 販売前に残る必須事項

1. Cloudflare認証を解決し、既存Worker・R2バケット・非公開設定・権限を確認する。
2. テストWorkerへ実デプロイし、R2読み書き、HTTPS、未公開保持、更新、切戻しを実サービスで検証する。
3. Supabaseの現行配備差分を保持しつつ、生成から承認・公開・非公開化までをCloudflareへ統合する。
   最新承認とリリースの固定、権限、公開ロック、DB更新失敗の回復、通知の重複抑止が必要。
4. 顧客専用ドメイン、公開維持費と契約条件を確定する。
5. 3プランの受注から納品までの通しテスト、本番バックアップと復元、実機確認を完了する。

変更範囲はcustomer-hosting-v2、専用GitHub Actions、開発ブランチのNetlifyビルド除外設定、販売画面の検査コード。
