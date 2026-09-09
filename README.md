# VINTAGE ALARM ANALYTICS — Cloudflare Worker

VINTAGE ALARM専用の非公開アクセス解析ダッシュボード。

## 現在の目的

アクセス数を眺めるためではなく、

`X / 検索 → 入口ページ → 次の興味`

が成立したかを確認する。

## 主な表示

- 1H / 3H / 24H / 7D / 30D
- Visits / Page views
- X Visits / Organic Search
- Pages per Visit
- Watch Entry Share
- Traffic Trend 折れ線
- Acquisition Trend 折れ線
- Entry Pages 横棒
- Traffic Mix ドーナツ
- Site Flow
- Campaign Funnel
- Referrer host / path
- Country / Device
- MAPPING AUDIT / UNMAPPED path
- LOW SAMPLE 警告

Campaign Funnelの投稿情報はブラウザのlocalStorageにのみ保存し、GitHubやCloudflareへ書き込まない。
投稿時刻を登録するとTraffic Trend / Acquisition Trend上のマーカーとして利用する。

## データ

Cloudflare Web Analytics / RUMをGraphQL APIから読む。

時間粒度は選択期間に応じて細かいbucketを試し、利用できない場合は粗いbucketへフォールバックする。

- 1H: 5分 → 15分 → 1時間
- 3H: 15分 → 5分 → 1時間
- 24H: 1時間 → 15分
- 7D / 30D: 日 → 1時間

## セキュリティ

WorkerはBasic Authで保護する。

- CF_API_TOKEN
- CF_ACCOUNT_ID
- DASHBOARD_PASSWORD

はCloudflare Worker Secretにのみ保存する。
API token・Account ID・パスワードをGitHubへコミットしない。

## URL表示名

Worker内のPAGE_NAMESで管理する。

- TOP
- HISTORY
- OWNER'S NOTES
- Pierce Duofon
- Cyma Time-O-Vox
- Cyma OWNER'S NOTE
- Smartwatch / HISTORY

未知Pathは既存名称へ丸めずUNMAPPEDとして警告する。

## 注意

- X Link clicksとCloudflare X Visitsは同一指標ではない。
- Page viewsとVisitsは別定義。
- Search Consoleの表示回数 / Click / CTR / QueryとCloudflare訪問データを混同しない。
- Campaign Funnel内のCloudflare側数値は選択期間の比較値であり、投稿単位の完全帰属ではない。
- LOW SAMPLE中は数件差を傾向として断定しない。


## Search Console Discovery PoC

Search Console is the next upstream layer above Cloudflare traffic.

The dashboard now has a `DISCOVERY / SEARCH CONSOLE` section. When configured, it reads:

- key-page URL Inspection status
- SEO impressions
- SEO clicks
- CTR
- average position
- current 28-day vs previous 28-day comparison
- daily rows
- top pages / queries
- searchAppearance as a PoC
- a conservative diagnostic label

### Required setup

Cloudflare runtime variable:

- `GSC_SITE_URL=https://orima1995-create.github.io/orima1995-creator.github.io/`

Cloudflare secret:

- `GSC_SERVICE_ACCOUNT_JSON`

The service account JSON must never be committed to GitHub.

The service account must have access to the exact Search Console property. The Worker requests only:

`https://www.googleapis.com/auth/webmasters.readonly`

URL Inspection is read-only and checks the version currently known to the Google index; it is not a live indexability test.

### Evidence rule

A zero in Search Console is not automatically an SEO failure.

The dashboard first separates:

1. index status
2. impressions
3. clicks / CTR
4. Cloudflare search entries

Only after those are separated should the diagnosis drill down into page / query / position / device / country.
