# TidyInvoice

Free invoice, quote and receipt generator. No signup, no backend, no running costs.
All data lives in the user's browser (localStorage). Static site — three core files.

Features: live A4 preview, 3 layouts (classic/minimal/letterhead), 4 document
languages (EN/FR/DE/ES), per-line VAT with rate breakdown, discounts, deposits
with balance due, multiple business profiles, client book, saved documents with
statuses, quote→invoice conversion, custom numbering (prefix + next number),
share-by-link (document encoded in the URL, no server), JSON backup, CSV export,
dark mode, installable PWA that works offline.

## Stack

- `index.html` — app + SEO landing content + FAQ (with schema.org markup)
- `styles.css` — screen, mobile and print (A4) styles
- `app.js` — all logic, vanilla JS, no dependencies
- `sw.js` + `manifest.json` + `icon.svg` — installable PWA, works offline
- PDF export = browser print-to-PDF (print CSS lays the sheet out to exactly one A4 page)

## Run locally

Any static server, e.g.:

```
python -m http.server 8321
```

Then open http://localhost:8321. (Opening index.html directly also works; the
service worker just won't register on `file://`.)

## Deploy (free)

1. Push this folder to a GitHub repo.
2. Enable GitHub Pages (Settings → Pages → deploy from branch), or drag the folder
   into Netlify / Cloudflare Pages.
3. Put the real domain into a `<link rel="canonical">` tag in `index.html` once known.

## Making money with it (priority order)

1. **Affiliate slot** — accounting software referral programs pay well per signup
   (FreshBooks, QuickBooks, Xero via impact.com / PartnerStack). Add one tasteful
   card under the FAQ: "Outgrowing manual invoices?" Do this only after real traffic
   exists, so the application gets approved.
2. **Pro upgrade (one-time, Gumroad or Stripe Payment Link)** — extra document
   themes, custom footer text, remove the "Made free with TidyInvoice" line.
   Keep the free tier genuinely complete; Pro is a tip with perks.
3. **AdSense** — only once pages/day justify it; one ad below the fold on the
   landing section, never inside the app.
4. **Cross-promotion** — KG Digital web-design services card in the footer for
   Irish traffic.

## Marketing checklist (traffic is the bottleneck)

- [ ] Deploy to a real domain (e.g. tidyinvoice.ie / .app)
- [ ] Submit to Google Search Console + Bing Webmaster
- [ ] Post on r/smallbusiness, r/freelance, r/Ireland (as a "I built a free tool" post)
- [ ] List on AlternativeTo, Product Hunt, free-tool directories
- [ ] Write 2–3 SEO pages: "How to invoice as a sole trader in Ireland",
      "VAT invoice requirements Ireland/UK" — link them to the app
- [ ] Share with existing KG Digital clients

## Pro tier

Built and **shippable**. Free tier is unchanged and stays byte-for-byte as capable
as before — Pro only adds a power layer over saved documents.

- **Pro features** (all client-side, all gated): library search/filter/sort, bulk
  actions (multi-select PDF/CSV/status/delete), and reusable templates.
- **Entitlement**: a signed licence in `tidyinvoice_license` is verified **offline**
  with Web Crypto Ed25519 against the bundled `LICENSE_PUBLIC_KEY` in `app.js` — no
  backend, no network. Fails safe to Free on anything missing/tampered/expired.
  `<body data-pro>` is the single gate for all Pro UI. `?demo` unlocks Pro visually
  but writes nothing.
- **Checkout**: `PRO_CHECKOUT_URL` in `app.js` is set to the live Stripe Payment Link
  (`https://buy.stripe.com/…`). The upsell modal's "Unlock Pro" opens it in a new tab.
- **Issuing licences**: `node tools/sign-license.mjs sign --email <e> --tier pro
  [--exp <ISO|none>]` mints a key (`--exp none` = one-time unlock; a date = expiry).
  The signer holds the **private** key in `tools/license-private.key` — **gitignored,
  local only, never committed**. Back it up: losing it means no new licences can be
  signed; leaking it lets anyone mint Pro. Rotating it (re-`keygen` + swap the bundled
  public key) invalidates every previously issued licence.

## localStorage keys

- `tidyinvoice_settings` — business profile, logo (base64), counters, defaults, theme
- `tidyinvoice_docs` — saved documents
- `tidyinvoice_clients` — saved client book
- `tidyinvoice_draft` — current working document (autosaved)
- `tidyinvoice_license` — signed Pro licence (Ed25519, verified offline; absent = Free)
- `tidyinvoice_templates` — Pro reusable templates (no client/number/date, no images)

## Notes

- Print/PDF verified with headless Chrome (`--print-to-pdf`): one A4 page, colours print.
- Mobile CSS is scoped `@media screen` — print must never inherit mobile hiding rules.
- Print block uses `!important` on sheet shadow/background — dark-mode selectors
  otherwise outspecify it and print the drop shadow.
- When changing cached assets, bump `CACHE` version in `sw.js`.
- `?demo` loads sample data, disables all persistence; `&layout=` and `&lang=`
  work with it for screenshots/print tests.
- Share links: `#d=<base64url JSON>` with the document + a business-info snapshot
  (logo excluded — too big for URLs). Recipient sees a view-only banner.
