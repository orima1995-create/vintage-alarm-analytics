# VINTAGE ALARM ANALYTICS — Cloudflare Worker

VINTAGE ALARM専用の非公開アクセス解析ダッシュボード。

## 現在の目的

アクセス数を眺めるためではなく、

`X / YouTube / 検索 → 入口ページ → 次の興味`

が成立したかを確認する。

## 主な表示

- 1H / 3H / 24H / 7D / 30D
- Visits / Page views
- X Visits / YouTube Visits / Organic Search
- Pages per Visit
- Watch Entry Share
- Traffic Trend 折れ線
- Acquisition Trend 折れ線
- Entry Pages 横棒
- Traffic Mix ドーナツ
- Site Flow
- SNS → WATCH ENTRY（SNS別の入口回数を時計ページごとに集約。全SNSを分母に割合を補助表示）
- Campaign Funnel（折りたたみ）
- Referrer host / path
- Country / Device
- MAPPING AUDIT / UNMAPPED path
- LOW SAMPLE 警告

主要KPIとグラフを先に表示し、Campaign Funnel、流入元などの監査用テーブル、
SEO / GEOツールは必要なときだけ開ける折りたたみへまとめている。

Campaign Funnelの投稿情報はブラウザのlocalStorageにのみ保存し、GitHubやCloudflareへ書き込まない。
X / YouTubeを選び、投稿URL・投稿日時・リンク追加日時・対象ページ・手入力指標を登録できる。リンク追加日時をTraffic Trend / Acquisition Trend上のマーカーとして利用する。既存のplatform未指定レコードはXとして読み込む。

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

## ホスト移行基準線

2026-09-10を旧GitHub Pagesから `https://vintagealarm.github.io/` への移行日として固定する。
Traffic Trend / Acquisition Trendには `HOST MIGRATION` マーカーを表示し、既存のX / YouTube施策マーカーと同じ時間軸で判別できるようにする。
これはJSTの日単位の基準線であり、正確な切替時刻を示すものではない。旧ホストと新ホストは別計測として保持し、移行をまたぐ数値を同条件の連続データとして比較しない。

## ChatGPT / AI向け read-only export

ダッシュボード本体のBasic AuthやCloudflare API tokenを共有せず、集計データだけを一時的に読み出すための経路を用意する。

流れ:

1. ダッシュボード右上の `AI COPY` を押す。
2. 現在選択中のwindowに対するread-only exportをブラウザ内で取得する。
3. 集計JSONそのものがクリップボードへコピーされる。
4. そのJSONをChatGPTへ貼る。

`workers.dev` のURLをChatGPT側Web取得が拒否する環境でも分析できるよう、通常運用はURL共有ではなくJSONコピーを使う。

手動でも、Basic Auth済みのブラウザで `/api/ai-share-link?window=7d` を開けば同じURLを取得できる。

対応window:

- 1h
- 3h
- 24h
- 7d
- 30d

`ttl` を秒で指定できる。最小5分、最大7日。省略時は24時間。

例:

`/api/ai-share-link?window=7d&ttl=86400`

export対象:

- Page views / Visits
- Pages / Entry Pages
- Channels
- Referrer host / path
- External entry flow
- Internal site flow
- SNS → WATCH entry
- Country / Device
- Traffic / Acquisition trend
- 直前同期間

含めないもの:

- Cloudflare API token
- Dashboard password
- IP address
- Cookie
- raw User-Agent
- Search Console / Google生成AIのImport snapshot

Search Console / Google生成AIのCSV Importは現時点でブラウザlocalStorageだけに保存されるため、Worker側exportには含まれない。取得不能なデータを自動取得済みとして扱わない。

署名鍵はWorker内だけにある `DASHBOARD_PASSWORD` と `CF_API_TOKEN` から専用鍵を導出し、HMAC-SHA256でwindowと有効期限に結び付ける。どちらのSecretもURLやレスポンスには出さない。署名付きURLはread-onlyだが、有効期限内はURLを知る相手が閲覧できるため、必要な相手以外へ共有しない。

## URL表示名

Worker内のPAGE_NAMESで管理する。

- TOP
- HISTORY
- OWNER'S NOTES
- Basis Alarm
- Pierce Duofon
- Cyma Time-O-Vox
- Cyma OWNER'S NOTE
- Smartwatch / HISTORY

未知Pathは既存名称へ丸めずUNMAPPEDとして警告する。

## 注意

- X Link clicksとCloudflare X Visitsは同一指標ではない。
- YouTube Views / Likes / 平均視聴率とCloudflare YouTube Visitsも同一指標ではない。
- YouTubeアプリやWebViewでRefererが失われるアクセスはDirect / Unknownになり得る。
- Page viewsとVisitsは別定義。
- Cloudflare GraphQLのAdaptive datasetは長期間・複雑なqueryほどsampling解像度が変わり得るため、30D集計は最大7日単位に分割してWorker側で合算する。
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
