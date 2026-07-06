# TidyInvoice

Free invoice, quote and receipt generator. No signup, no backend, no running costs.
All data lives in the user's browser (localStorage). Static site — three core files.

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

## localStorage keys

- `tidyinvoice_settings` — business profile, logo (base64), counters, defaults, theme
- `tidyinvoice_docs` — saved documents
- `tidyinvoice_clients` — saved client book
- `tidyinvoice_draft` — current working document (autosaved)

## Notes

- Print/PDF verified with headless Chrome (`--print-to-pdf`): one A4 page, colours print.
- Mobile CSS is scoped `@media screen` — print must never inherit mobile hiding rules.
- When changing cached assets, bump `CACHE` version in `sw.js`.
