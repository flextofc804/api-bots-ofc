# MediaHub — Media Extraction API & Admin Control Panel

Self-hosted REST API + dark-themed admin dashboard that extracts and downloads media from **TikTok**, **Instagram** and **YouTube** (video & audio) using **100% local scraping** — no paid API keys, no third-party subscription services.

## Architecture

```
mediahub/
├── server.js                  # Express bootstrap, middleware, graceful shutdown
├── src/
│   ├── config.js              # Env-driven configuration
│   ├── scrapers/
│   │   ├── index.js           # Engine orchestrator (yt-dlp → native fallback)
│   │   ├── tiktok.js          # Universal-data / SIGI_STATE / item API scraping
│   │   ├── instagram.js       # __a=1 endpoint + embed-page scraping
│   │   └── youtube.js         # InnerTube player API (ANDROID/WEB clients)
│   ├── services/
│   │   └── binaries.js        # yt-dlp / ffmpeg detection & wrappers
│   ├── routes/
│   │   ├── api.js             # POST /process, GET /download, GET /health
│   │   └── admin.js           # /admin/stats, /admin/logs, /admin/controls…
│   └── utils/                 # logger, JSON storage, cache, jobs, metrics, validation
├── public/
│   ├── index.html             # Tailwind + Lucide dark dashboard
│   └── app.js                 # Live polling, tables, controls, extraction tester
└── data/                      # Auto-created JSON persistence (logs, history)
```

## Extraction engines (ordered)

1. **yt-dlp** — used automatically if the binary is on `PATH` (or `YTDLP_PATH`).
2. **Native scrapers** — pure Node `fetch` scraping, always available:
   - **TikTok**: `__UNIVERSAL_DATA_FOR_REHYDRATION__` / `SIGI_STATE` JSON, item detail API, short-link resolution, watermark-free stream rewriting (`/playwm/` → `/play/`).
   - **Instagram**: `?__a=1&__d=dis` JSON endpoint with embed-page fallback.
   - **YouTube**: InnerTube `player` API with ANDROID client first, WEB fallback.

Optional local **ffmpeg** enables true MP3 conversion on the fly (`&convert=mp3` on the download stream); without it, the original audio track is streamed instead.

## Run

```bash
npm install
npm start          # http://localhost:3000
```

### Deploy to Vercel (serverless hosting)

The repo ships with `api/index.js` (serverless adapter) and `vercel.json` (rewrites + static bundling). Storage automatically switches to `/tmp` on serverless.

```bash
npm i -g vercel
vercel --prod
```

Or import the repository at [vercel.com/new](https://vercel.com/new) with zero configuration.

Optional environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `ADMIN_TOKEN` | *(empty = open)* | Protects all `/api/v1/admin/*` routes (`X-Admin-Token` header) |
| `YTDLP_PATH` | auto-detect | Explicit yt-dlp binary path |
| `FFMPEG_PATH` | auto-detect | Explicit ffmpeg binary path |
| `MAX_CONCURRENT_JOBS` | `4` | Worker capacity before HTTP 429 |
| `CACHE_TTL_MS` | `600000` | Extraction cache TTL |

## API

### `POST /api/v1/process`

```json
{ "url": "https://www.tiktok.com/@user/video/123", "platform": "auto", "format": "video" }
```

Response:

```json
{
  "success": true,
  "platform": "tiktok",
  "title": "…",
  "duration": 21,
  "thumbnail": "https://…",
  "download_url": "/api/v1/download?u=…",
  "file_size": "3.4 MB"
}
```

### `GET /api/v1/download?u=<token>&name=<file>&convert=mp3`

Proxied media stream (host allowlisted) with `Content-Disposition`; streams MP3 when `convert=mp3` and ffmpeg is present.

### `GET /api/v1/admin/stats`

`total_downloads`, `active_jobs`, `storage_used`, `uptime`, CPU/RAM, bandwidth, worker pool, engine status, per-platform counters.

### `GET /api/v1/admin/logs?limit=100&level=error&search=…`

Recent execution logs and error traces (ring buffer persisted to `data/logs.json`).

### `GET /api/v1/admin/downloads?platform=&status=&search=`

Download activity history with search/filter.

### `POST /api/v1/admin/controls`

```json
{ "action": "clear_cache" | "toggle_maintenance" | "restart_workers" | "purge_logs" | "clear_history" }
```

## Dashboard

Open `http://localhost:3000/` — live CPU/RAM bars, uptime, bandwidth, worker pool, per-platform counters, searchable/filterable activity table with status badges, system controls, an inline extraction tester, and a live log console.

## Legal note

This tool is for personal, educational use with content you own or have rights to. Respect each platform's Terms of Service.
