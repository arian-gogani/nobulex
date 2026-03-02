# Nobulex Website — Fixes & Upcoming Features Catalog

Generated from codebase analysis. Use this as a pre-launch checklist.

---

## Done ✓

*(Nothing marked done yet — use this section as you complete items.)*

---

## Must fix now (broken)

### 1. Wrong npm package name in code examples
- **Current:** `@nobulex/core` and `npm install @nobulex/core`
- **Should be:** `@nobulex/core` and `npm install @nobulex/core`
- **Files to update:**
  - `index.html` — lines 143, 153 (code block + npm copy button)
  - `docs/quickstart.html` — lines 60, 64 (import + npm copy button)
  - `main.js` — line 103 (`NPM_PACKAGE` constant used for stats fetch)

### 2. Community and Downloads stats show "—" with no numbers
- **Location:** Hero section, Problem section, Properties section (3 places each)
- **Cause:** Stats are fetched from GitHub API (`agbusiness195/stele`) and npm (`@nobulex/core`). Either the repo/package doesn't exist, is private, or the fetch fails.
- **Options:**
  - **A)** Put real numbers once the package is published and repo is public
  - **B)** Remove the Community and Downloads stat blocks entirely until you have real data
  - **C)** Replace with static placeholder text (e.g. "Coming soon" or "0" until launch)

---

## Needs content (currently empty or placeholder)

### 3. `images/nobulex-logo.png`
- **Status:** ✅ **EXISTS** — File is present at `images/nobulex-logo.png` (72KB)
- **Also used:** Header logo on all pages, `og:image` meta tag
- **Action:** None needed — verify it loads correctly in production

### 4. `videos/hero.mp4`
- **Status:** ❌ **MISSING** — Only `videos/README.md` exists; no `hero.mp4`
- **Current behavior:** `main.js` falls back to a Pexels video when `hero.mp4` fails to load
- **Options:**
  - Add `videos/hero.mp4` for branded hero video
  - Or remove the video element and use a static background (fallback already works, so not critical)

### 5. `docs/quickstart.html`
- **Status:** ✅ **EXISTS** — Guides link works
- **Action:** None — page exists

### 6. `manifesto.html`
- **Status:** ✅ **EXISTS** — Linked from multiple places, page exists
- **Action:** None — page exists

### 7. `eu-ai-act.html`
- **Status:** ✅ **EXISTS** — Linked in regulatory section, page exists
- **Action:** None — page exists

### 8. SPEC.md link
- **Status:** ⚠️ **404** — Links to `https://github.com/agbusiness195/stele/blob/main/SPEC.md`
- **Note:** Fetch returned 404; repo may be private or SPEC.md may not exist yet
- **Files:** `index.html` (line 127), footer (line 334), `spec.html` (redirects to GitHub)
- **Options:**
  - Ensure `SPEC.md` exists in the stele repo and is accessible
  - Or host the spec locally (e.g. `spec.html` with actual content instead of redirect)

---

## Should improve before launch

### 9. Manifesto quote link
- Quote says "THE Nobulex MANIFESTO" and links to `manifesto.html`
- **Status:** ✅ `manifesto.html` exists — no fix needed

### 10. "Join developers building the trust layer" — no way to join
- **Location:** Hero section (`hero__social-proof`)
- **Issue:** No email signup, Discord, or other CTA to actually join
- **Suggestions:**
  - Add email/newsletter signup form
  - Add Discord link
  - Link to GitHub Discussions more prominently
  - Or rephrase to "Coming soon" if community isn't ready

### 11. Enterprise contact feels informal
- **Location:** Get Started section — "We'll respond within 48 hours" links to GitHub Discussions
- **Suggestion:** Add a dedicated enterprise contact (e.g. `enterprise@nobulex.dev` or a Calendly link) for a more professional feel

### 12. No Twitter/X link
- **Issue:** No social link to Nobulex's X account
- **Suggestion:** Add X/Twitter icon + link in footer or header

### 13. No email or newsletter signup
- **Issue:** No way to capture interested visitors
- **Suggestion:** Add a simple email signup (e.g. Mailchimp, Buttondown, or Resend) in footer or a dedicated section

---

## Nice to have (post-launch)

- Real download numbers from npm (requires `@nobulex/core` to be published)
- GitHub star count (requires public repo)
- Changelog or blog section
- Interactive demo

---

## Quick reference: file locations

| Item | Path |
|------|------|
| Package name in code | `index.html`, `docs/quickstart.html`, `main.js` |
| Stats elements | `index.html` — `#hero-github-stars`, `#hero-npm-downloads`, `#github-stars`, `#npm-downloads`, `#stats-github-stars`, `#stats-npm-downloads` |
| Logo | `images/nobulex-logo.png` ✅ |
| Hero video | `videos/hero.mp4` ❌ (fallback in `main.js`) |
| SPEC link | `index.html`, footer, `spec.html` |
| GitHub repo | `agbusiness195/stele` |
| NPM package (current) | `@nobulex/core` → change to `@nobulex/core` |
