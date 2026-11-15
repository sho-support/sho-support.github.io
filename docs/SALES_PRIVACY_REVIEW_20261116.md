# HP販売の実DB権限確認（2026-11-16 JST）

## 読取だけで確認したこと

- 販売者情報は保存済み。値・氏名・所在地・電話・メールアドレスをGitや証跡へ掲載していない。
- `website_settings` はRLS有効。anon/authenticatedにSELECTのテーブル権限はあるが、行ポリシーがないためブラウザから直接読めない。実DBの読み取り専用トランザクションでanon roleと架空のauthenticated subjectを使い、どちらも読める行が0件であることを確認した。確認後はROLLBACKした。
- `website_orders` はanon/authenticatedにSELECT権限がなく、RLSも有効。管理者用の設定APIは本人/管理者認証を別途確認する。
- `website_intakes` と `website_sites` は所有サイト判定を使う。管理者判定は `website_admins.user_id=auth.uid()`、参加者判定はサイトと `auth.uid()` の対応であり、ユーザーが編集できるmetadataを使わない。匿名の読取結果も0行だった。ただし現在サイトは0件のため、本番の別顧客データを入れたクロステナント試験ではない。別顧客・無権限拒否は隔離HTTP/SQL試験で確認した。
- 注文・サイト・稼働中ジョブはすべて0件。商用条件は無効、バックアップの本人確認記録は未承認、本番振込先なし、テスト振込先あり、公開用の新規スキーマ未適用。

## Supabase Advisorの残る通知

通知ゼロとは報告しない。実データへのアクセス権を増やして通知だけを消す対応はしない。

| 通知 | 観測と扱い |
|---|---|
| RLS Enabled No Policy（INFO、5テーブル） | 注文・設定・閲覧統計・確認事項・再構築tokenのテーブル。RLSがありポリシーなしの場合はクライアントの行アクセスを拒否する。サーバー専用データを公開するポリシーを追加しない。 |
| Extension in Public（WARN、pg_net） | 実DBでpublicに配置、`extrelocatable=false`。単純なALTER EXTENSION SET SCHEMAで動かせる状態ではない。既存の再構築/通信処理を含む影響確認と保全が必要で、今回は変更していない。 |
| Leaked Password Protection Disabled（WARN） | 未有効化。公式資料ではPro以上の機能。無料プランに存在しない設定を有効化済みとは扱わず、料金プランを変更していない。 |

ログイン/再設定画面は8文字以上で受付け、表示切替等の6幅検査186件に合格した。Authの実サーバー設定を今回変更・検証したものではなく、実メール到着や実パスワード変更の証明ではない。

## 参照・修正案の資料

- [RLS有効・ポリシーなしの通知](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [publicの拡張機能に関する通知](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public)
- [パスワード強度と漏えいパスワード検知](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [追加した画面試験の実行結果](https://github.com/sho-support/sho-support.github.io/actions/runs/43765504325)
