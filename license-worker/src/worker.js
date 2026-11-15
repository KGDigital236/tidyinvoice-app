// TidyInvoice Pro — licence delivery worker (Cloudflare Workers).
//
// Stripe Payment Link "after payment" redirects here:
//   https://<worker>/success?session_id={CHECKOUT_SESSION_ID}
//
// Flow: verify the session is genuinely paid (Stripe API, restricted read-only key)
//   → sign a Pro licence with the SAME Ed25519 private key + payload shape as
//     tools/sign-license.mjs → render the key on screen.
//
// The licence string must be byte-identical to what the local signer produces:
//   licence = base64url(payloadJSON) + "." + base64url(64-byte signature)
//   payload = { email, tier:"pro", exp }   <- key order matters, it is signed as text
//   exp     = unix seconds, ONE YEAR from the Stripe session's creation time.
//   signature = Ed25519 over the UTF-8 bytes of the base64url payload SEGMENT
// exp is derived from session.created (fixed per purchase), NOT Date.now(), so signing
// stays deterministic: a refresh — even days later — re-issues the identical key.
// This is the €25/year model: a one-time payment buys a 1-year licence; the app reverts
// to Free when it lapses and the buyer purchases again. No auto-renew, no webhook.
//
// Secrets (wrangler secret put):
//   STRIPE_SECRET_KEY       restricted key, Checkout Sessions: read  ONLY
//   LICENSE_PRIVATE_KEY     contents of tools/license-private.key (PKCS8 PEM)
// Vars (wrangler.toml):
//   EXPECTED_PAYMENT_LINK   the pl_… id of the TidyInvoice Pro link (guard)
//   APP_URL                 where to send the buyer to activate

const TEXT = new TextEncoder();

function b64url(bytes) {
  let bin = "";
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// PKCS8 PEM -> CryptoKey. Same private key file the local signer uses.
async function importPrivateKey(pem) {
  const b64 = String(pem)
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  if (!b64) throw new Error("LICENSE_PRIVATE_KEY is empty or not a PKCS8 PEM");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
}

async function signLicense(email, expUnix, pem) {
  // Object literal order == sign-license.mjs's `{ email, tier, exp }`. Do not reorder:
  // the JSON text is what gets signed, so property order is part of the signature.
  const payload = { email: email, tier: "pro" };
  if (expUnix) payload.exp = expUnix; // 1-year expiry; absent would mean pay-once (old model)
  const seg = b64url(TEXT.encode(JSON.stringify(payload)));
  const key = await importPrivateKey(pem);
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, key, TEXT.encode(seg));
  return seg + "." + b64url(sig);
}

async function getCheckoutSession(sessionId, stripeKey) {
  const res = await fetch(
    "https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId),
    { headers: { Authorization: "Bearer " + stripeKey } }
  );
  if (!res.ok) {
    let detail = "";
    try { detail = ((await res.json()).error || {}).message || ""; } catch (e) {}
    return { error: "stripe", status: res.status, detail: detail };
  }
  return { session: await res.json() };
}

// ---------- pages ----------

const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; padding:2.5rem 1.25rem; font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
         background:#f6f7f9; color:#16191d; display:flex; justify-content:center; }
  .card { width:100%; max-width:560px; background:#fff; border:1px solid #e3e6ea; border-radius:14px;
          padding:2rem; box-shadow:0 1px 3px rgba(0,0,0,.06); }
  h1 { font-size:1.4rem; margin:0 0 .25rem; }
  .sub { color:#5b636d; margin:0 0 1.5rem; }
  .keybox { display:flex; gap:.5rem; align-items:stretch; margin:.5rem 0 .25rem; }
  code#key { flex:1; display:block; padding:.85rem; background:#f2f4f7; border:1px solid #dfe3e8; border-radius:8px;
             font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; word-break:break-all; }
  button { border:0; border-radius:8px; padding:0 1rem; background:#1f6feb; color:#fff; font-size:.9rem;
           font-weight:600; cursor:pointer; white-space:nowrap; }
  button:hover { background:#1a5fd0; }
  ol { padding-left:1.15rem; } li { margin:.4rem 0; }
  .warn { margin-top:1.5rem; padding:.85rem 1rem; background:#fff8e6; border:1px solid #f2dfae;
          border-radius:8px; font-size:.9rem; }
  .muted { color:#5b636d; font-size:.9rem; }
  a { color:#1f6feb; }
  @media (prefers-color-scheme: dark) {
    body { background:#0f1216; color:#e6e8ea; }
    .card { background:#171b21; border-color:#2a2f37; }
    code#key { background:#0f1216; border-color:#2a2f37; color:#e6e8ea; }
    .warn { background:#241f10; border-color:#4a3f1c; }
    .sub,.muted { color:#9aa3ad; }
  }
`;

function page(title, bodyHtml, status) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body><main class="card">${bodyHtml}</main></body></html>`,
    {
      status: status || 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
      },
    }
  );
}

function successPage(license, email, expUnix, appUrl) {
  const expStr = expUnix ? new Date(expUnix * 1000).toISOString().slice(0, 10) : null;
  return page(
    "Your TidyInvoice Pro licence",
    `<h1>Payment received — thank you</h1>
     <p class="sub">Your Pro licence key for <strong>${escapeHtml(email)}</strong>${
       expStr ? `, valid until <strong>${escapeHtml(expStr)}</strong>` : ""
     }:</p>
     <div class="keybox">
       <code id="key">${escapeHtml(license)}</code>
       <button id="copy" type="button">Copy</button>
     </div>
     <p class="muted">Keep this key. You can reopen this page to see it again. Your licence is
     valid for one year${expStr ? ` (until ${escapeHtml(expStr)})` : ""}; after that, buy again to renew.</p>
     <h2 style="font-size:1.05rem;margin:1.5rem 0 .5rem;">Activate it</h2>
     <ol>
       <li>Open <a href="${escapeHtml(appUrl)}" target="_blank" rel="noopener">TidyInvoice</a>.</li>
       <li>Open the <strong>Saved documents</strong> drawer.</li>
       <li>Under <strong>TidyInvoice Pro</strong>, paste the key into <em>Paste licence key</em>.</li>
       <li>Click <strong>Activate</strong>.</li>
     </ol>
     <div class="warn">The licence is stored in that browser only. To use Pro on another
     browser or device, paste the same key there too.</div>
     <script>
       document.getElementById("copy").addEventListener("click", function () {
         var t = document.getElementById("key").textContent;
         navigator.clipboard.writeText(t).then(function () {
           var b = document.getElementById("copy");
           b.textContent = "Copied"; setTimeout(function () { b.textContent = "Copy"; }, 1600);
         });
       });
     </script>`
  );
}

function problemPage(heading, message, status) {
  return page(
    heading,
    `<h1>${escapeHtml(heading)}</h1>
     <p class="sub">${message}</p>
     <p class="muted">If you have been charged, email
     <a href="mailto:gordiefeery@gmail.com">gordiefeery@gmail.com</a> with your receipt
     and your key will be sent manually.</p>`,
    status
  );
}

// ---------- handler ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    if (url.pathname !== "/success") {
      return page("TidyInvoice", `<h1>TidyInvoice licence service</h1>
        <p class="sub">Nothing to see here. Licence keys are issued automatically after checkout.</p>`, 404);
    }

    const sessionId = url.searchParams.get("session_id");
    if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
      return problemPage(
        "Missing checkout reference",
        "This page needs to be opened from the Stripe redirect after payment.",
        400
      );
    }

    if (!env.STRIPE_SECRET_KEY || !env.LICENSE_PRIVATE_KEY) {
      console.error("worker misconfigured: missing STRIPE_SECRET_KEY or LICENSE_PRIVATE_KEY");
      return problemPage("Something went wrong", "The licence service is misconfigured.", 500);
    }

    const got = await getCheckoutSession(sessionId, env.STRIPE_SECRET_KEY);
    if (got.error) {
      console.error("stripe lookup failed", got.status, got.detail);
      return problemPage(
        "Could not confirm your payment",
        "We could not reach Stripe to verify this purchase. Please try refreshing in a minute.",
        502
      );
    }

    const session = got.session;

    if (session.payment_status !== "paid") {
      return problemPage(
        "Payment not completed",
        "Stripe has not marked this checkout as paid. If you have just paid, wait a moment and refresh.",
        402
      );
    }

    // Guard: only OUR product mints a key. Without this, any paid session on the
    // same Stripe account could be replayed here to mint a free Pro licence.
    if (env.EXPECTED_PAYMENT_LINK && session.payment_link !== env.EXPECTED_PAYMENT_LINK) {
      console.error("payment_link mismatch", session.payment_link);
      return problemPage(
        "This purchase is not TidyInvoice Pro",
        "That checkout does not correspond to a TidyInvoice Pro purchase.",
        400
      );
    }

    const email =
      (session.customer_details && session.customer_details.email) || session.customer_email;
    if (!email) {
      console.error("no email on session", sessionId);
      return problemPage(
        "No email on this purchase",
        "Your licence is tied to your email address, and Stripe did not return one.",
        400
      );
    }

    // €25/year: the key expires one year after the purchase. Anchored to session.created
    // (not Date.now()) so a later refresh re-issues the byte-identical key.
    const YEAR_SECONDS = 365 * 24 * 60 * 60;
    const expUnix = (session.created || Math.floor(Date.now() / 1000)) + YEAR_SECONDS;

    let license;
    try {
      license = await signLicense(email, expUnix, env.LICENSE_PRIVATE_KEY);
    } catch (e) {
      console.error("signing failed", e && e.message);
      return problemPage("Something went wrong", "We could not generate your licence key.", 500);
    }

    return successPage(license, email, expUnix, env.APP_URL || "https://kgdigital236.github.io/tidyinvoice-app/");
  },
};
