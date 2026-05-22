---
name: agent-reach
description: 让 AI 代理拥有跨平台互联网检索与阅读能力，覆盖 Web、GitHub、YouTube、Twitter/X、Reddit、Bilibili、小红书等场景。当用户要求跨站搜索、读取社媒内容、阅读代码仓库、抓取视频字幕或检索公开网络信息时使用。
trigger: 用户要求搜索互联网内容、跨多个平台查资料、查看 Twitter/X/Reddit/YouTube/GitHub/Bilibili/小红书 内容、读取网页正文、抓取公开视频字幕、搜索公开网络信息
do-not-trigger: 用户只需要普通网页浏览器操作、只在本地文件中搜索、只讨论 agent-reach 原理但不需要实际使用、任务与互联网内容获取无关
user-invocable: true
context: inline
tags:
  - search
  - web
  - github
  - youtube
  - twitter
  - reddit
  - bilibili
  - xiaohongshu
---

# Agent Reach

让你的 AI 代理拥有看见整个互联网的眼睛。这个技能适合做跨平台信息检索、网页阅读、公开内容提取和多来源交叉验证。

## 使用原则

- 优先使用目标平台最直接的读取方式，不要无谓绕路。
- 如果某个渠道不可用，先换同类可行方案，再告诉用户限制。
- 如果某个平台需要 Cookie、代理或登录，明确告诉用户缺什么，不要假装已经拿到权限。
- 不要在当前项目工作区里为这个技能创建临时文件；临时输出应放到系统临时目录。

## 常见能力

- Web 正文读取
- Web 搜索
- GitHub 仓库 / Issue / 代码搜索
- Twitter/X 搜索、时间线、线程读取
- YouTube / Bilibili 视频信息与字幕提取
- Reddit 帖子搜索与阅读
- 小红书、抖音、微信公众号、LinkedIn 等渠道扩展读取

## 推荐工作流

### 1. 先判断用户要什么来源

- 如果用户给了明确 URL，优先直接读取该 URL。
- 如果用户只给主题或关键词，先搜索，再选最相关的结果继续深入。
- 如果用户要求交叉验证，至少引用两个不同来源。

### 2. 按渠道选择方式

### Web 任意 URL

```bash
curl -s "https://r.jina.ai/URL"
```

### Web 搜索

```bash
mcporter call 'exa.web_search_exa(query: "query", numResults: 5)'
mcporter call 'exa.get_code_context_exa(query: "code question", tokensNum: 3000)'
```

### Twitter/X

```bash
xreach search "query" -n 10 --json
xreach tweet URL_OR_ID --json
xreach tweets @username -n 20 --json
xreach thread URL_OR_ID --json
```

### YouTube

```bash
yt-dlp --dump-json "URL"
yt-dlp --write-sub --write-auto-sub --sub-lang "zh-Hans,zh,en" --skip-download -o "/tmp/%(id)s" "URL"
yt-dlp --dump-json "ytsearch5:query"
```

### Bilibili

```bash
yt-dlp --dump-json "https://www.bilibili.com/video/BVxxx"
yt-dlp --write-sub --write-auto-sub --sub-lang "zh-Hans,zh,en" --convert-subs vtt --skip-download -o "/tmp/%(id)s" "URL"
```

### Reddit

```bash
curl -s "https://www.reddit.com/r/SUBREDDIT/hot.json?limit=10" -H "User-Agent: agent-reach/1.0"
curl -s "https://www.reddit.com/search.json?q=QUERY&limit=10" -H "User-Agent: agent-reach/1.0"
```

### GitHub

```bash
gh search repos "query" --sort stars --limit 10
gh repo view owner/repo
gh search code "query" --language python
gh issue list -R owner/repo --state open
gh issue view 123 -R owner/repo
```

### 小红书

```bash
mcporter call 'xiaohongshu.search_feeds(keyword: "query")'
mcporter call 'xiaohongshu.get_feed_detail(feed_id: "xxx", xsec_token: "yyy")'
mcporter call 'xiaohongshu.get_feed_detail(feed_id: "xxx", xsec_token: "yyy", load_all_comments: true)'
```

### 抖音

```bash
mcporter call 'douyin.parse_douyin_video_info(share_link: "https://v.douyin.com/xxx/")'
mcporter call 'douyin.get_douyin_download_link(share_link: "https://v.douyin.com/xxx/")'
```

### 微信公众号

```bash
python3 -c "
import asyncio
from miku_ai import get_wexin_article
async def s():
 for a in await get_wexin_article('query', 5):
  print(f'{a[\"title\"]} | {a[\"url\"]}')
asyncio.run(s())
"
```

### LinkedIn

```bash
mcporter call 'linkedin.get_person_profile(linkedin_url: "https://linkedin.com/in/username")'
mcporter call 'linkedin.search_people(keyword: "AI engineer", limit: 10)'
```

### RSS

```bash
python3 -c "
import feedparser
for e in feedparser.parse('FEED_URL').entries[:5]:
 print(f'{e.title} — {e.link}')
"
```

## 执行要求

- 遇到渠道异常时，先建议运行 `agent-reach doctor` 检查可用状态。
- 如果某渠道依赖 Cookie、代理、API Key 或本地登录，先说明依赖，再让用户提供必要信息。
- 如果用户只是要快速阅读网页正文，优先用 Jina Reader 路径，不要先走复杂安装流程。
- 如果用户需要的是浏览器点击、表单填写、真实网页交互，不要误用本技能，应改用浏览器操作类技能。

## 故障提示

- Twitter/X 抓取失败：检查 Cookie、代理和 `undici` 依赖。
- Bilibili / Reddit 受限：可能需要代理或改用搜索能力间接获取。
- 微信公众号文章：不能简单用普通网页抓取方式替代专用读取流程。
- 某平台读不到：先告诉用户当前限制，再给出降级方案。
