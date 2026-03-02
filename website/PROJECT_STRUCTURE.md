# nobulex-web Project Structure

```
nobulex-web/
├── index.html          # Homepage
├── manifesto.html      # The Uncovenanted Agent Problem
├── eu-ai-act.html      # EU AI Act compliance guide
├── spec.html           # Redirect to GitHub spec
├── 404.html            # Not found (Vercel serves automatically)
├── styles.css          # Global styles
├── main.js             # Client-side JS (nav, copy, stats, help widget)
├── server.js           # Local dev server with /api/chat
├── package.json
├── vercel.json         # Vercel deployment config
├── sitemap.xml
├── robots.txt
├── .env.example        # GROQ_API_KEY for AI chat
├── .gitignore
│
├── api/
│   ├── chat.js         # Vercel serverless — AI help (Groq/OpenAI)
│   └── README.md
│
├── docs/
│   └── quickstart.html # Developer quickstart
│
├── images/
│   ├── nobulex-logo.png   # Brand logo (header)
│   ├── hero-visual.png # Hero section background
│   ├── favicon.svg
│   └── *.svg           # Section illustrations
│
├── videos/
│   ├── README.md       # Add hero.mp4 for custom video
│   └── hero.mp4        # (optional) Hero video
│
├── CONVERSION_STRATEGY.md  # Marketing/conversion notes
├── DEPLOY.md           # Deployment instructions
└── README.md           # Run locally
```

## Key Paths

- **Hero background:** `images/hero-visual.png` (fallback when no video)
- **Logo:** `images/nobulex-logo.png`
- **AI chat API:** `POST /api/chat` (needs `GROQ_API_KEY` in Vercel env)
