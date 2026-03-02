# Prompts for Claude Instructor (stele repo & external tasks)

Use these prompts in your stele repo or with your Claude instructor for tasks that cannot be done in Nobulex-web.

---

## 1. Add SPEC.md to the stele repo

**Prompt to give:**

> In the stele repo (agbusiness195/stele), ensure a file `SPEC.md` exists at the repo root. The Nobulex website links to `https://github.com/agbusiness195/stele/blob/main/SPEC.md` — if this file is missing, create it with the Nobulex protocol specification. If the spec content lives elsewhere, either move it to SPEC.md or add a SPEC.md that redirects/links to the correct location.

---

## 2. Add branded hero video (optional)

**Prompt to give (if you want a custom hero video):**

> Add a file `videos/hero.mp4` to the Nobulex-web project. The hero section expects this file. Use an MP4 (H.264) video about 5–15 seconds, 1920×1080 or higher, that loops seamlessly. Content should fit Nobulex’s brand: AI agent accountability, trust, verification. Once added, update `index.html` line 57: change the video `src` from the Pexels URL to `videos/hero.mp4`.

---

## 3. Update placeholder URLs and contact info

**Prompt to give:**

> In the Nobulex-web project, update these placeholders with real values:
> - **Discord:** Add Discord link when server exists.
> - **X/Twitter:** Search for `https://x.com/nobulex` and replace with your actual X handle URL.
> - **Enterprise email:** Search for `enterprise@nobulex.dev` and replace if using a different address.

---

## 4. Wire newsletter form to a backend

**Prompt to give:**

> The Nobulex-web footer has a newsletter signup form (`.footer__form`). It currently shows "Thanks!" on submit but does not store emails. Wire it to a real backend:
> - Option A: Use a service like Mailchimp, Buttondown, Resend, or ConvertKit — get the form action URL or API endpoint, update the form `action` in `index.html`, or add a fetch in `main.js` to POST the email.
> - Option B: Add a serverless function (e.g. in `api/`) that receives the email and forwards it to your email provider or CRM.
> - Ensure the form has proper `action`, `method`, and optionally a hidden field for the service (e.g. Mailchimp list ID).

---

## 5. Re-enable live stats (post-launch)

**Prompt to give (after @nobulex/core is published and stele repo is public):**

> In Nobulex-web `main.js`, re-add the live stats fetch block that populates GitHub stars and npm downloads. The package is `@nobulex/core` and the repo is `agbusiness195/stele`. Add the fetch logic back and restore the Community/Downloads stat divs in `index.html` (hero, problem, and properties sections) with IDs: `hero-github-stars`, `hero-npm-downloads`, `github-stars`, `npm-downloads`, `stats-github-stars`, `stats-npm-downloads`.
