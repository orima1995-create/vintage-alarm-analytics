# VINTAGE ALARM ANALYTICS — Cloudflare Worker

VINTAGE ALARM専用の非公開アクセス解析ダッシュボード。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/orima1995-create/orima1995-creator.github.io/tree/main/cloudflare/analytics-dashboard)

## 役割

- Cloudflare Web Analytics / RUMをGraphQL APIから読む
- URLを時計名・ページ名へ変換する
- 24時間 / 7日 / 30日と直前期間を比較する
- Page views / Visitsを分離する
- Referrerを X / SNS、Organic Search、Direct / Unknown、AI Assistant、Other Referralへ分類する
- Country / Deviceを表示する
- Cloudflare API tokenをブラウザやGitHub Pagesへ露出させない

## セキュリティ

Worker自身をBasic Authで保護する。
API token・Account ID・パスワードはCloudflare Worker Secretにのみ保存し、GitHubへコミットしない。
全レスポンスにno-store、noindex系ヘッダーを付ける。

## 必要なCloudflare API Token

Cloudflare公式ドキュメントに従い、カスタムAPI Tokenへ以下を付与する。

- Account
- Account Analytics
- Read

対象アカウントだけに絞る。

## 推奨デプロイ

上の Deploy to Cloudflare ボタンを使う。
このサブディレクトリを独立Workerとして読み込み、必要なSecretをセットしてデプロイする。

必須:
- CF_API_TOKEN
- CF_ACCOUNT_ID
- DASHBOARD_PASSWORD

CLIを使う場合:

```bash
cd cloudflare/analytics-dashboard
npm install
npx wrangler deploy
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put DASHBOARD_PASSWORD
```

## URL表示名

Worker内の friendlyPageName() で管理する。
新しいOWNER'S NOTEを公開したらここへ追加する。

現在:

- TOP
- HISTORY
- OWNER'S NOTES
- Pierce Duofon
- Cyma Time-O-Vox
- Cyma OWNER'S NOTE
- Smartwatch / HISTORY

## 注意

Web AnalyticsのPage views / VisitsとSearch Consoleの表示回数・クリックは別指標。
公開・計測・流入・検索露出を同一の成果として扱わない。
