# Nobulex — The trust layer for the agent economy

Marketing site for [Nobulex](https://github.com/nobulexdev/nobulex), a protocol that makes honesty the only rational strategy for any autonomous system. Verifiable commitments for AI agents. Open source. MIT licensed.

## Run locally

```bash
npm install
npm start
```

Open [http://localhost:3333](http://localhost:3333).

### AI help chat

Create `.env.local` in the project root:

```
GROQ_API_KEY=gsk_xxxxx
```

Get a free key at [console.groq.com](https://console.groq.com). Without it, the help widget (?) shows fallback links instead of AI answers.

## Deploy

See [DEPLOY.md](DEPLOY.md) for Vercel deployment and pre-launch checklist.

## Project structure

| Path | Description |
|------|-------------|
| `index.html` | Homepage |
| `manifesto.html` | The Uncovenanted Agent Problem |
| `eu-ai-act.html` | EU AI Act compliance guide |
| `docs/quickstart.html` | Developer quickstart |
| `api/chat.js` | AI chat serverless function (Vercel) |
| `404.html` | Not found page |
