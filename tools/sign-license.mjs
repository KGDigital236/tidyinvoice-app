#!/usr/bin/env node
// TidyInvoice offline licence signer — Node built-in crypto only, no dependencies.
//
// The app verifies licences offline with crypto.subtle Ed25519 (see verifyLicense()
// in app.js). This script is the matching issuer: it holds the PRIVATE key and mints
// signed licence strings in the exact shape the app expects.
//
//   Licence string = base64url(payloadJSON) + "." + base64url(64-byte signature)
//   Signature      = Ed25519 over the UTF-8 bytes of the base64url payload SEGMENT
//                    (the string before the dot — NOT the raw JSON bytes).
//   Payload        = { email, tier:"pro", exp? }  exp = unix seconds; omitted = no expiry.
//
// Usage:
//   node tools/sign-license.mjs keygen [--force]
//   node tools/sign-license.mjs sign --email <e> --tier pro [--exp <ISO date | Ny | none>]
//
// For the €25/year model the manual fallback is:  --exp 1y  (one year from today).
// keygen prints the raw base64url PUBLIC key to stdout (paste into app.js
// LICENSE_PUBLIC_KEY) and writes the PRIVATE key to tools/license-private.key.
// That file is gitignored and must never be committed.

import { generateKeyPairSync, createPrivateKey, sign as edSign } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";

const KEY_URL = new URL("./license-private.key", import.meta.url); // resolves next to this script

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) { out[key] = true; }
      else { out[key] = next; i++; }
    }
  }
  return out;
}

function die(msg) {
  console.error("error: " + msg);
  process.exit(1);
}

function keygen(flags) {
  if (existsSync(KEY_URL) && !flags.force) {
    die("tools/license-private.key already exists. Refusing to overwrite (would invalidate every issued licence). Pass --force only if you are certain.");
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const rawPub = spki.subarray(spki.length - 32); // last 32 bytes of SPKI = raw Ed25519 public key
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  writeFileSync(KEY_URL, pem, { mode: 0o600 });
  // stdout = the public key only, so it can be captured cleanly; notes go to stderr.
  console.error("Private key written to tools/license-private.key (gitignored — never commit it).");
  console.error("Public key (base64url) — paste into app.js LICENSE_PUBLIC_KEY:");
  console.log(b64url(rawPub));
}

function sign(flags) {
  if (!existsSync(KEY_URL)) die("no private key. Run `node tools/sign-license.mjs keygen` first.");
  const email = flags.email;
  const tier = flags.tier;
  if (!email || email === true) die("--email is required.");
  if (tier !== "pro") die('--tier must be "pro".');

  const payload = { email, tier };
  const exp = flags.exp;
  if (exp !== undefined && exp !== "none") {
    const yearShort = /^(\d+)y$/.exec(String(exp)); // "1y" = one year from now (the €25/year default)
    let ms;
    if (yearShort) {
      const d = new Date();
      d.setFullYear(d.getFullYear() + parseInt(yearShort[1], 10));
      ms = d.getTime();
    } else {
      ms = Date.parse(exp);
    }
    if (Number.isNaN(ms)) die('--exp must be an ISO date (e.g. 2027-01-31), "<N>y" (e.g. 1y), or "none".');
    payload.exp = Math.floor(ms / 1000); // unix seconds; the app compares against Date.now()/1000
  }
  // exp omitted entirely for a one-time unlock — verifyLicense treats absent/null as no expiry.

  const priv = createPrivateKey(readFileSync(KEY_URL, "utf8"));
  const seg = b64url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = edSign(null, Buffer.from(seg, "utf8"), priv); // Ed25519: algorithm is null
  console.error("Licence for " + email + (payload.exp ? " (expires " + new Date(payload.exp * 1000).toISOString().slice(0, 10) + ")" : " (no expiry)") + ":");
  console.log(seg + "." + b64url(sig));
}

const cmd = process.argv[2];
const flags = parseFlags(process.argv.slice(3));
if (cmd === "keygen") keygen(flags);
else if (cmd === "sign") sign(flags);
else {
  console.error("usage:");
  console.error("  node tools/sign-license.mjs keygen [--force]");
  console.error("  node tools/sign-license.mjs sign --email <e> --tier pro [--exp <ISO date | Ny | none>]");
  process.exit(1);
}
