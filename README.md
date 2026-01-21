# Media Radar

A corporate intelligence tool for tracking competition and admission news, managing deadlines, and generating content packages.

## Features

- **Multi-Source Ingestion**: RSS feeds and HTML pages.
- **Smart Inbox**: Review incoming items, approve/reject workflow.
- **Auto-Digest**: Extract facts, risks, and generate social media copy drafts.
- **Event Extraction**: Automatically find dates and deadlines from text.
- **Slack Integration**: Push approved updates to Slack.
- **Secure**: Simple internal password authentication.

## Tech Stack

- Next.js 15 (App Router)
- TypeScript
- Prisma (SQLite for local, PostgreSQL for production)
- Tailwind CSS
- Node.js (RSS Parser, Cheerio, Readability)

## Getting Started

### Prerequisites

- Node.js 18+ (Recommended 20 or 22)
- npm

### Installation

1. **Clone and Install**
   ```bash
   git clone <repo_url>
   cd media-radar
   npm install
   ```

2. **Configure Environment**
   Copy `.env.example` to `.env` (or create `.env`):
   ```bash
   DATABASE_URL="file:./dev.db"
   ADMIN_PASSWORD="secure_password_123"
   SLACK_WEBHOOK_URL="" # Optional
   INTAKE_TOKEN="secret-intake-token" # For cron jobs
   ```

3. **Database Setup**
   ```bash
   npx prisma migrate dev --name init
   # This will also run the seed script to populate initial sources.
   ```

4. **Run Locally**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000). Log in with `ADMIN_PASSWORD`.

## Environment Variables

- `DATABASE_URL`: Connection string for Prisma.
- `ADMIN_PASSWORD`: For the web interface.
- `INTAKE_TOKEN`: Secures the ingestion API.
- `WECOM_WEBHOOK_CANARY`: (Required for Canary/Gray Release) The webhook URL for the WeCom test group.
  - **Note**: Historically `WEWORK_WEBHOOK_URL` was used. The system supports a fallback, but please prefer `WECOM_WEBHOOK_CANARY`.

## Deployment

### Vercel (Recommended)

1. Push to GitHub.
2. Import project in Vercel.
3. **Database**: Use Vercel Postgres or Supabase.
   - Update `prisma/schema.prisma` to use `provider = "postgresql"`.
   - Update `DATABASE_URL` in Vercel Environment Variables.
4. **Environment Variables**: Set `ADMIN_PASSWORD`, `INTAKE_TOKEN`, `SLACK_WEBHOOK_URL`.
5. **Build Command**: `npx prisma migrate deploy && next build` (or run migration manually).

### Scheduled Ingestion (Cron)

This project includes a GitHub Action workflow `.github/workflows/ingest.yml` to trigger ingestion 3 times a day.

**Setup:**
1. Go to GitHub Repo -> Settings -> Secrets and variables -> Actions.
2. Add Repository Secrets:
   - `INTAKE_URL`: The full URL to your deployed API (e.g., `https://your-app.vercel.app/api/ingest`).
   - `INTAKE_TOKEN`: The same token set in your `.env`.

## Usage Guide

1. **Sources**: Go to `/sources` to manage RSS/HTML feeds.
2. **Inbox**: Check `/inbox` for new items. Click to review.
3. **Review**:
   - Verify extracted events (dates).
   - Edit the generated digest (Facts/Risks).
   - Click "Approve".
4. **Push**: Once approved, click "Push to Slack" to notify the team.

## Troubleshooting & Rollback

### Curl Transport Rollback
If you encounter issues with the `curl` transport:
1.  **Disable via Database**:
    Remove `"transport": "curl"` from the `crawlConfig` column for the affected source.
    ```sql
    -- Example
    UPDATE "Source" SET crawlConfig = json_remove(crawlConfig, '$.transport') WHERE name = 'Target Source';
    ```
2.  **Code Revert**:
    The `transport` field is optional. If removed, it defaults to `undici` (Node.js native fetch).

## 新增学校信息源（3 分钟小白教程）

### 1. 必填字段一览

在「Sources」页面新增一个 HTML 类型的信息源时，主要关心这些字段：

- `name`：学校 + 栏目名称，例如 `北京大学 通知公告`。
- `type`：选择 `HTML`。
- `url`：列表页 URL（例如 `https://www.gotopku.cn/tzgg/index.htm`）。
- `regionTag`：可选，用来标记区域，例如 `CN`。
- `categoryTag`：可选，用来标记类别，例如 `升学`、`竞赛`。
- `priority`：1–5，数字越大优先级越高，一般用默认值即可。
- `isActive`：是否启用，先保持勾选。
- `fetchIntervalMinutes`：抓取间隔，默认 60 分钟即可。

对于 HTML 源，最关键的是 `crawlConfig`（JSON 字段）：

- `listUrls`：数组，列表页 URL（可以只填一个）。
- `detailPattern`：用于匹配详情页链接的正则字符串。
- `selectors`：一组 CSS 选择器：
  - `title`：详情页标题元素。
  - `date`：发布时间元素。
  - `content`：正文内容容器（尽量只包含正文，不含导航/页脚）。
  - `attachments`：附件链接（如正文中“附件下载”区域里的 `a` 标签）。

### 2. 如何快速找到列表页 URL

1. 打开目标学校的招生/通知栏目，在浏览器地址栏中复制当前列表页 URL。
2. 如果有分页，通常形如：
   - 第一页：`.../tzgg/index.htm`
   - 第二页：`.../tzgg/index_1.htm`
   - 第三页：`.../tzgg/index_2.htm`
3. 把第一页的地址填入：
   - `url`
   - `crawlConfig.listUrls[0]`

> 小技巧：如果栏目点击标题后会跳转到 `.../tzgg/xxxxxxxxxxxx.htm` 这种详情页，通常列表页就是 `tzgg/index...htm`。

### 3. 如何验证 selectors（本地运行，limit=3）

新增或修改 `crawlConfig` 后，建议先在本地跑一个小范围 dry-run 验证：

```bash
npx tsx --env-file=.env scripts/pku_scan_attachments.ts
```

建议点：

- 这个脚本会：
  - 从某个列表页收集最多 200 条详情 URL；
  - 对每条详情页面解析正文和附件；
  - 只打印出前三条“带附件”的命中案例（limit=3），方便你快速检查。
- 你可以参考这个脚本里的逻辑，适配到新学校（例如复制一个新脚本，改成你的 `Source.name` 和 `startUrl`）。

验证时重点看：

- 标题是否正确（不是整页页面标题）。
- publish_date 是否正常（非当前时间，格式类似 `2025-01-01`）。
- attachments_count 与网页上的附件数量是否大致一致。
- 渲染出来的 WeCom 文本是否可读（没有大段菜单/脚注垃圾内容）。

### 4. 常见错误与处理方式

**1）列表抽不到：结果数量为 0 或远小于预期**

- 检查 `listUrls` 是否是正确的列表页，而不是详情页。
- 检查 `detailPattern`：
  - 可以先暂时删除 `detailPattern`，看能否发现大量链接；
  - 再用浏览器 DevTools 复制某条详情 URL，写出明确的正则，例如：
    - `tzgg/\\w+\\.htm`
    - `info/\\d+/\\d+\\.htm`
- 检查 `crawlConfig.listSelectors`（如果你配了）：
  - `item`：列表每一行的整体容器选择器；
  - `title`：标题文本所在元素；
  - `date`：日期元素。

**2）正文太短：日志提示 “Content too short.”**

- 检查 `selectors.content` 是否指向了错误的容器：
  - 可以在浏览器里右键“检查”，找到正文的大容器（例如 `.x-layout`, `.article-content`）。
  - 避免选到整个 `<body>` 或只选到一小块。
- 如果确实找不到合适的容器：
  - 可以先暂时删除 `content` 选择器，让系统用 Readability 自动提取正文；
  - 观察结果是否更好，然后再根据需要精细化选择器。

**3）附件误识别：没有附件 / 把普通链接当附件**

- 检查 `selectors.attachments`：
  - 推荐只选“附件区域”下的 `a` 标签，例如 `.attachments a` 或正文里“附件”段落附近的链接；
  - 避免写成通配（如 `.content a`），否则导航/站外链接也会当成附件。
- 系统自带的附件过滤：
  - 内部会按后缀（pdf/doc/docx/xls/xlsx/zip/rar）和 HEAD 检测判断是否为文件；
  - 如果学校的附件是登陆页或二跳页面（如 `login.html`），无法当成文件附件，只会当普通链接处理。

### 5. 可复制的 crawlConfig 模板

下面是一个可以直接复制的模板，把里面的 URL 和选择器改成目标学校的即可：

```json
{
  "listUrls": ["https://www.example.edu.cn/tzgg/index.htm"],
  "detailPattern": "tzgg/[0-9a-fA-F]{32}\\.htm",
  "listSelectors": {
    "item": ".list li",
    "title": "a",
    "date": ".date"
  },
  "selectors": {
    "title": ".x-layout h1, .article-title",
    "date": ".x-layout .time, .article-date",
    "content": ".x-layout .article, .article-content",
    "attachments": ".x-layout .article a, .article-content a"
  }
}
```

- 推荐先从一个已经跑通的学校复制一份 `crawlConfig`，只改：
  - `listUrls`
  - `detailPattern`
  - 少量 `selectors`（根据实际 HTML 结构调整）。

212→### 6. 批量生成 985/211 高校数据源草案
213→
214→在本地生成“国内 985/211 高校通知公告列表页”的初始数据源清单（CSV + JSON）：
215→
216→```bash
217→node scripts/build_cn985211_sources.js
218→```
219→
220→脚本会在项目根目录下生成：
221→
222→- `cn985211_sources.csv`
223→- `cn985211_sources.json`
224→- `missing.csv`（记录未成功识别的学校及原因）
225→
## Advanced Crawling Configuration

To add a complex HTML source (e.g., University Admission Site), you can configure specific crawling rules in the Source settings (or via `prisma/seed.ts`).

**Configuration Format (JSON):**
```json
{
  "listUrls": ["https://zsb.lzu.edu.cn/zszc.htm"],
  "detailPattern": "info/\\d+\\.htm",
  "selectors": {
    "title": ".article-title",
    "date": ".article-date",
    "content": ".article-content",
    "attachments": ".article-content a"
  }
}
```

- **listUrls**: Array of URLs to crawl for discovering new links.
- **detailPattern**: Regex string to match detail page URLs found on the list page.
- **selectors**: CSS selectors to extract content.
  - `title`: Article title.
  - `date`: Publish date.
  - `content`: Main body text (HTML).
  - `attachments`: Links to attachments.

## License


Private / Internal Use.
