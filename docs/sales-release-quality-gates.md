# SHO WEB SUPPORT 販売サイトの品質ゲート

作成日: 2026-11-05

## 目的
販売ページの見出し切れ、横スクロール、傾いた実例枠、価格・申込み導線の不具合を、納品前に機械的に検出する。単なる「ページがHTTP 200を返す」だけでは合格にしない。

## 自動テストの入口
- [販売サイト全体テスト](https://github.com/sho-support/sho-support.github.io/actions/workflows/qa-sales-flow.yml) : `tests/qa-sales-flow.cjs`
- [バンド向けLP専用](https://github.com/sho-support/sho-support.github.io/actions/workflows/qa-band-landing.yml) : `tests/qa-band-landing.cjs`
- [非公開お客様サイトのVisual QA](https://github.com/sho-support/sho-support.github.io/actions/workflows/qa-private-site.yml) : `tests/qa-private-site.cjs` / `tests/qa-full-staged.cjs`

## 販売サイト全体で自動確認する項目
1. 販売サイト・FAQ・制作方法・セミテンプレート10種・注文画面の事前選択状態・利用条件・プライバシー・旧サポートページを含む **26シナリオ** を検査。
2. **320 / 360 / 390 / 430 / 768 / 1366px** の6画面幅、計156描画パターン。
3. ドキュメント横幅は画面幅を超えない。**テキストノードの実描画範囲**も検査し、overflow:hiddenによる切り捨てを見逃さない。
4. 表示中の画像の欠損、ブラウザ側JavaScriptエラー、200でない画面応答を検出。
5. 参照される同一オリジンのHTMLリンクを実際にHTTP GETして200を確認。
6. 1ページ・セミ・フルのプラン選択・価格・テンプレート選択・注文確認画面の遷移を検査（**実際の注文作成・LINE送信・送金は行わない**）。
7. テンプレートプレビュー10種類に選択した `data-theme` が正しく適用されることを検査。
8. GitHub Actionsの**チェックアウト済みの該当コミット**をローカルサーバーで起動して検査し、旧バージョンがキャッシュされていても見逃さない。Push時にはGitHub Pagesの実公開サイトも別途検査する。
9. スクリーンショットと監査JSONをGitHub Actions artifactに保存（保存期間7日）。

## プルリクエスト運用
PRにもチェックを実行する設定は済んでいる。ただしGitHubのブランチ保護で **必須ステータスチェック** へ登録する操作までは未実施。したがって、この文書・CIだけで「失敗したらmainへマージされない」状態を保証しない。

## 入金前のURL固定・自動安全装置

- 正式見積り送信時に納品予定URL、管理権限・更新負担の確認を必須化。見積り通知はLINEに納品予定URLを含める。
- 入金確認済み操作時も、正式見積り送信日時・確定URLを検査する。見積り時と違うURLへの自動変更は拒否する。
- AIフルオーダーは生成時に内部の確認用URLや存在しないリンクを除去。GitHubへ公開する直前に全HTMLを検査し、リンク先不足・確認用トークンを検出したら公開を停止する。
- ブラウザの注文管理画面は、ログイン・LINE・銀行を**モック**に置き換えたテストで確認する。実送信や実決済の検証ではない。

## 販売・納品で別途必要な確認
- お客様の正式URLを独自ドメイン配下で確定し、所有者・更新費用・DNS・TLS・印刷物への掲載方法を確認。
- 管理者が振込先と正式金額を設定し、お客様LINEへの案内と入金確認を行う。実入金は必ず銀行で確認。
- 申込み→見積り→LINE→入金→ヒアリング→AI生成→SHO確認→お客様承認→実ドメインでの公開を**現実の画面で通し検証**。
- GitHub Pagesの商取引を主目的とするサイトの公開制限に注意。販売ページの運用が許容されるかはGitHubに問い合わせ、必要ならドメイン固定の上で移行。
- 特商法の表示（事業者情報の開示実務を含む）や注文最終確認画面は、最終的なサービスと契約成立時点に照らして法令適合を確認する。
- Android実機、iPhone Safari、PCでの実目視と、リンクのタップしやすさ・フォントの読める大きさも確認。Chromium結果だけで完全互換と判断しない。
- 製品のデザイン・機能の改良後は、QAを繰り返してから「完成」と言う。

## 一次資料
- https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- https://www.no-trouble.caa.go.jp/what/mailorder/guidelines.html
- https://www.no-trouble.caa.go.jp/qa/advertising.html-2
