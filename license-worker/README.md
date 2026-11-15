# TidyInvoice licence delivery worker

Turns a Stripe payment into a Pro licence key, on screen, automatically.

**Why this exists:** the checkout is live and takes €25, but until this worker is deployed a
buyer receives nothing — you have to sign a key by hand and email it. Deploying this closes
that gap.

## How it works

1. Stripe Payment Link, after payment, redirects the buyer to
   `https://<worker>/success?session_id={CHECKOUT_SESSION_ID}`.
2. The worker asks Stripe whether that session is genuinely `paid` (read-only key).
3. It signs a Pro licence with the **same private key and payload shape** as
   `tools/sign-license.mjs`, so the app verifies it offline exactly as before.
4. It renders the key with copy button and activation steps.

Ed25519 signing is deterministic, so refreshing the page re-issues the identical key —
no storage, no database, nothing to keep in sync.

## Deploy (about 15 minutes, one time)

You need a free Cloudflare account. Everything below runs from this folder.

### 1. Get a restricted Stripe key

Stripe Dashboard → Developers → API keys → **Create restricted key**.

- Name: `tidyinvoice-worker`
- Set **everything** to *No access*, except **Checkout Sessions → Read**.
- Create it and copy the `rk_live_…` value.

Read-only on one resource: if it ever leaked, nobody could charge or refund with it.

### 2. Find the Payment Link id

Stripe → Payment links → open the TidyInvoice Pro link. The id in the URL starts with
`plink_`. Put it in `wrangler.toml` as `EXPECTED_PAYMENT_LINK`.

This is a guard: without it, any paid checkout on your Stripe account could be replayed
against this worker to mint a free Pro key. It matters more once you sell a second product.

### 3. Deploy

```sh
cd license-worker
npx wrangler login
npx wrangler deploy
```

Note the URL it prints, e.g. `https://tidyinvoice-license.<you>.workers.dev`.

### 4. Set the two secrets

```sh
npx wrangler secret put STRIPE_SECRET_KEY      # paste the rk_live_… key
npx wrangler secret put LICENSE_PRIVATE_KEY    # paste the FULL contents of ../tools/license-private.key
```

For the second one paste the whole file including the
`-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----` lines.

Secrets are encrypted at rest and are not readable back out of the dashboard — which is
exactly why the local copy of that file still has to be backed up separately.

### 5. Point Stripe at the worker

Stripe → Payment links → TidyInvoice Pro → edit → **After payment** → *Redirect to a page*:

```
https://tidyinvoice-license.<you>.workers.dev/success?session_id={CHECKOUT_SESSION_ID}
```

Paste `{CHECKOUT_SESSION_ID}` literally — Stripe substitutes it.

### 6. Test with a real €25 purchase

Buy it yourself. You get the €25 back minus roughly €0.60 in fees when you refund, which is
a fair price for knowing the paid path works end to end. Check that:

- the key appears on screen,
- pasting it into TidyInvoice (Saved documents drawer → *Paste licence key* → **Activate**)
  turns Pro on,
- refreshing the success page shows the same key.

Then refund yourself in Stripe. Note the licence stays valid after a refund — there is no
revocation in an offline key system. That is a known and accepted trade-off.

## Local development

```sh
npx wrangler dev
```

Put development values in `.dev.vars` (gitignored):

```
STRIPE_SECRET_KEY="rk_test_…"
LICENSE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
…
-----END PRIVATE KEY-----"
```

## Verified before first deploy

Tested against the real private key and the real bundled public key:

- worker output is **byte-identical** to `tools/sign-license.mjs` for the same email
- `app.js verifyLicense()` accepts the worker's key
- signing is deterministic — refresh yields the same key
- a tampered payload (swapped email) fails verification
- unpaid session → no key; foreign `payment_link` → no key; Stripe outage → no key
- malformed `session_id` is rejected before Stripe is ever called
- the private key never appears in rendered HTML

## Manual fallback

Still works, unchanged, for support cases:

```sh
node tools/sign-license.mjs sign --email <buyer> --tier pro --exp none
```
