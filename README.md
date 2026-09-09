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



## Zero-cost SEO / GEO Inbox

追加課金経路を作らない方針に変更した。

Google Cloud / Service Account / Search Console APIは使用しない。
Search Console本体のExportを入力にして、分析だけをVINTAGE ALARM ANALYTICSで行う。

入力:

- 通常Search Performance CSV
- Google生成AI Performance CSV
- URL Inspection結果は主要ページだけ手動記録

ダッシュボード:

- SEO Impressions
- SEO Clicks
- CTR
- Average Position
- Google AI Impressions
- Index Status
- CSV時系列
- Page / Query等のドリルダウン
- 前回Import比較
- conservative diagnosis

Search ConsoleでExportする際はCSVを選ぶ。
複数CSVが出た場合は、展開後にまとめて選択してImportする。

ImportデータとIndex Statusは現在ブラウザlocalStorageへ保存する。
API token、Google Cloud project、Billing accountは不要。

### Data interpretation

Search ConsoleのChartとTableは集計方法が異なる場合がある。
全体KPIはDate系CSVを優先し、Page / Queryはドリルダウンとして扱う。

Google生成AI Performanceは通常SEOと別Snapshotとして保存する。
AI ImpressionとAI ReferralとAI Citationを同一指標にしない。

### Cost rule

VINTAGE ALARM ANALYTICSの現段階では追加月額0円を優先する。
Billing accountや有料APIを前提とする実装は採用前に明示的に再評価する。
