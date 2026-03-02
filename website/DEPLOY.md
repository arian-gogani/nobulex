# Deploying Nobulex Website

## Quick deploy

```bash
vercel
```

Or connect the repo in the [Vercel dashboard](https://vercel.com/dashboard).

---

## Pre-launch checklist

### 1. Environment variables (Vercel)

In **Project → Settings → Environment Variables**, add:

| Variable       | Value              | Notes                          |
|----------------|--------------------|--------------------------------|
| `GROQ_API_KEY` | `gsk_xxxxx`        | Get free key at [console.groq.com](https://console.groq.com) |

Without this, the AI help chat (?) will show fallback links instead of answering.

**Optional:** Enable [Vercel Analytics](https://vercel.com/analytics) in Project → Analytics for traffic insights.

### 2. Domain (optional)

If using a custom domain (e.g. `nobulex.dev`):

1. Add domain in Vercel → Project → Settings → Domains
2. Update these files with your domain:
   - `sitemap.xml` — all `<loc>` URLs
   - `robots.txt` — Sitemap URL
   - `index.html` — `og:image`, `og:url` meta tags

### 3. Custom hero video (optional)

Add `videos/hero.mp4` for a branded hero. Without it, a Pexels fallback is used.

---

## Project structure

- `api/chat.js` — Serverless function for AI chat (Groq)
- `index.html` — Homepage
- `404.html` — Not found page (Vercel serves automatically)
- Static assets in `images/`, `docs/`, etc.

---

## Local development

```bash
npm install
npm start
```

Open [http://localhost:3333](http://localhost:3333). Create `.env.local` with `GROQ_API_KEY` for the chat.
