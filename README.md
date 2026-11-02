# `<dev.commit>` website + admin

A Node.js site with a built-in admin panel. No dependencies: no `npm install` needed (Node 18+).

## Run locally

```bash
npm run create-admin   # once: sets the admin email + password (password is stored only as a hash)
npm run dev            # site: http://localhost:3000   admin: http://localhost:3000/admin
```

Sign in at `/admin` with the email you chose (default `devcommitt@gmail.com`). Locally the server listens on `127.0.0.1` only.

## What the admin can do

- **Projects:** add, edit, reorder, delete; upload desktop/mobile screenshots (JPG/PNG/WebP, max 6 MB); live-site link; featured/demo flags. Saving rebuilds the site instantly.
- **Website Builder:** edit the theme palette (background, primary, accent, surface and text colors), site metadata, hero and page copy, About content, footer labels, navigation, services, process steps, Why section, FAQ, testimonials, visibility toggles, and portfolio categories. Changes rebuild the public site when saved. An Advanced JSON editor remains available for less common content.
- **Clients:** maintain a private client directory with contact details and internal notes.
- **Leads / Inbox:** public visitors can submit inquiries without creating an account. Review inquiries, see additional custom form answers, update lead status (New / Contacted / Qualified / Converted / Archived), set priority, add private notes, and export leads to CSV.
- **Analytics:** privacy-friendly aggregate page views, popular pages, traffic sources, and daily totals (90-day retention; no IP addresses or visitor profiles).
- **Security:** review recent audit events and the active security controls.
- **Account:** change your password; password changes invalidate all active sessions.

The Contact page editor can change its heading, description, form labels, submit/success messages, add contact channels (WhatsApp, phone, booking links, etc.), and add up to 15 extra form fields (including select options). Extra answers are saved with each lead and included in email notifications and CSV exports. Visitors do not need accounts; only administrators can sign in.

Content lives in `content/*.json`, uploads in `assets/img/projects/`, inquiries, client records, analytics, audit events, and the admin login in `data/` (never commit or share `data/`).

## Arabic version (العربية)

The site is bilingual. English lives at `/`, Arabic at `/ar/` (right-to-left, self-hosted Cairo font, language switcher in the header; the visitor's choice is remembered).

- **Edit in English as usual.** Arabic text is stored separately in `content/site.ar.json` and `content/projects.ar.json` and is already translated for all current content. Anything you add in English that has no Arabic yet simply shows in English on the Arabic page until you translate it.
- **Translate in the admin:** Projects and Website Builder have an "Editing: English / العربية" switch. In Arabic mode the English original is shown under each field and untranslated fields are highlighted.
- Links, colors, images and list structure (adding/removing services, etc.) are shared by both languages and edited in English mode.
- Turn Arabic off with the "Offer the Arabic version" checkbox (Website Builder > Website information).

## Security (what is and is not covered)

No site can honestly be called unhackable. This one closes the common routes and ships with no third-party code (no npm dependencies, scripts, fonts or trackers).

- **Login:** scrypt password hashing (32 MiB), 12+ character passwords, optional **two-factor authentication** (authenticator app + one-time recovery codes, replay-protected: Admin > Account), throttling per IP / account / globally, identical work for unknown accounts.
- **Sessions:** HttpOnly, SameSite=Strict, `__Host-` + Secure over HTTPS, 2 h idle / 12 h maximum, rotated on login, all ended on password change.
- **Requests:** CSRF token and same-site (Origin / Fetch-Metadata) check on every write, strict Content-Security-Policy (no inline script/style, no framing), HSTS, nosniff, COOP/CORP, request-size / rate / timeout limits, correct client-IP detection behind a proxy.
- **Content & files:** server-side validation and output escaping, link allow-listing, uploads accepted by file signature only, spreadsheet-formula-safe CSV export, honeypot and rate limits on the contact form, path-traversal and dot-file protection, private data files (owner-only permissions).
- **Optional:** `ADMIN_ALLOWED_IPS` restricts /admin to your own IPs.

Still your responsibility: serve over **HTTPS**, keep Node.js updated, use a unique strong password and **turn on two-factor**, back up `data/`. Lost phone? Run `npm run create-admin` on the server (this resets the password and turns 2FA off).

## Deploying (important)

The admin needs a **Node host that keeps files between restarts**: a VPS, or Render/Railway/Fly with a persistent disk mounted over this project folder (or at least `content/`, `assets/img/projects/` and `data/`). On hosts with an ephemeral disk, admin edits disappear on redeploy. Plain static hosts (Netlify, GitHub Pages) cannot run the admin; use `npm run build` and upload `dist/` there instead (then edit the JSON files by hand and set `FORM_ENDPOINT` for the form).

Production settings (see `.env.example`): `NODE_ENV=production`, `TRUST_PROXY=1` only behind a trusted proxy, `SITE_URL`, and `ADMIN_EMAIL` + `ADMIN_PASSWORD` for the first-run admin (12+ characters; or use `npm run create-admin` on the server). Optional email notifications and customer acknowledgements use the Resend API: set `RESEND_API_KEY`, a verified `EMAIL_FROM`, and `ADMIN_NOTIFY_EMAIL`. Without these values, the contact form still saves leads normally. Start command: `npm start`.

## Backend additions

- Leads are stored in `data/inquiries.json`; status, priority, and internal notes are editable in the admin.
- Client records are stored in `data/clients.json` and can be created, updated, and deleted from the admin.
- Analytics are aggregate-only and stored in `data/analytics.json` with a rolling 90-day window.
- Audit events are stored in `data/audit.json`.
- Email delivery is optional and uses the Resend HTTPS API via Node’s built-in `fetch`; no extra runtime dependency is required.
- The application intentionally does not include project/task management.

## Before launch checklist

1. Replace the two demo projects with real ones (and turn off "Show demo projects").
2. Add real screenshots, Instagram/LinkedIn links, and your site address (`siteUrl`) for sitemap + share previews.
3. Add real testimonials (`"approved": true`) or leave the section empty.
4. Add Privacy/Terms pages and list them under `legal`.
5. The logo file shows `>` before the final `t`; swap `assets/img/logo.png` if that is unintended.
