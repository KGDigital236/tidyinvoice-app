/* TidyInvoice — all data stays in localStorage. No network calls. */
(function () {
  "use strict";

  // demo mode: sample data, no persistence
  var isDemo = /[?&]demo\b/.test(location.search);

  // ---------- storage keys ----------
  var LS = {
    settings: "tidyinvoice_settings",
    docs: "tidyinvoice_docs",
    clients: "tidyinvoice_clients",
    draft: "tidyinvoice_draft",
    license: "tidyinvoice_license",
    templates: "tidyinvoice_templates"
  };

  var THEMES = {
    forest: { accent: "#1e6f50", ink: "#14503a" },
    ink:    { accent: "#1f2733", ink: "#11161e" },
    clay:   { accent: "#b4552d", ink: "#8a3f1f" },
    ocean:  { accent: "#1f5f8b", ink: "#164567" },
    plum:   { accent: "#6d3352", ink: "#51253d" }
  };

  var TYPE_META = {
    invoice: { prefix: "INV", numberFieldLabel: "Invoice number", dueFieldLabel: "Due date", showDue: true },
    quote:   { prefix: "QUO", numberFieldLabel: "Quote number", dueFieldLabel: "Valid until", showDue: true },
    receipt: { prefix: "REC", numberFieldLabel: "Receipt number", dueFieldLabel: "Due date", showDue: false }
  };

  // Document-facing labels per language (editor UI stays English)
  var LANGS = {
    en: { locale: "en-IE", titles: { invoice: "INVOICE", quote: "QUOTE", receipt: "RECEIPT" }, numLabels: { invoice: "Invoice no.", quote: "Quote no.", receipt: "Receipt no." }, date: "Date", due: "Due", validUntil: "Valid until", ref: "Ref", billedTo: "Billed to", preparedFor: "Prepared for", desc: "Description", qty: "Qty", unitPrice: "Unit price", vat: "VAT", amount: "Amount", subtotal: "Subtotal", discount: "Discount", paidToDate: "Paid to date", totals: { invoice: "Total due", quote: "Total", receipt: "Total paid" }, balanceDue: "Balance due", paymentDetails: "Payment details", notes: "Notes", thanks: "Thank you for your business.", quoteFoot: "This quote is valid until the date shown above.", paidStamp: "PAID" },
    fr: { locale: "fr-FR", titles: { invoice: "FACTURE", quote: "DEVIS", receipt: "REÇU" }, numLabels: { invoice: "Facture n°", quote: "Devis n°", receipt: "Reçu n°" }, date: "Date", due: "Échéance", validUntil: "Valable jusqu'au", ref: "Réf.", billedTo: "Facturé à", preparedFor: "Préparé pour", desc: "Description", qty: "Qté", unitPrice: "Prix unitaire", vat: "TVA", amount: "Montant", subtotal: "Sous-total", discount: "Remise", paidToDate: "Déjà payé", totals: { invoice: "Total à payer", quote: "Total", receipt: "Total payé" }, balanceDue: "Solde dû", paymentDetails: "Modalités de paiement", notes: "Remarques", thanks: "Merci de votre confiance.", quoteFoot: "Ce devis est valable jusqu'à la date indiquée ci-dessus.", paidStamp: "PAYÉ" },
    de: { locale: "de-DE", titles: { invoice: "RECHNUNG", quote: "ANGEBOT", receipt: "QUITTUNG" }, numLabels: { invoice: "Rechnungsnr.", quote: "Angebotsnr.", receipt: "Quittungsnr." }, date: "Datum", due: "Fällig", validUntil: "Gültig bis", ref: "Ref.", billedTo: "Rechnung an", preparedFor: "Erstellt für", desc: "Beschreibung", qty: "Menge", unitPrice: "Einzelpreis", vat: "MwSt.", amount: "Betrag", subtotal: "Zwischensumme", discount: "Rabatt", paidToDate: "Bereits gezahlt", totals: { invoice: "Gesamtbetrag", quote: "Gesamt", receipt: "Gezahlt" }, balanceDue: "Restbetrag", paymentDetails: "Zahlungsdetails", notes: "Hinweise", thanks: "Vielen Dank für Ihren Auftrag.", quoteFoot: "Dieses Angebot ist bis zum oben genannten Datum gültig.", paidStamp: "BEZAHLT" },
    es: { locale: "es-ES", titles: { invoice: "FACTURA", quote: "PRESUPUESTO", receipt: "RECIBO" }, numLabels: { invoice: "Factura n.º", quote: "Presupuesto n.º", receipt: "Recibo n.º" }, date: "Fecha", due: "Vencimiento", validUntil: "Válido hasta", ref: "Ref.", billedTo: "Facturar a", preparedFor: "Preparado para", desc: "Descripción", qty: "Cant.", unitPrice: "Precio unitario", vat: "IVA", amount: "Importe", subtotal: "Subtotal", discount: "Descuento", paidToDate: "Ya pagado", totals: { invoice: "Total a pagar", quote: "Total", receipt: "Total pagado" }, balanceDue: "Saldo pendiente", paymentDetails: "Datos de pago", notes: "Notas", thanks: "Gracias por su confianza.", quoteFoot: "Este presupuesto es válido hasta la fecha indicada arriba.", paidStamp: "PAGADO" }
  };

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function load(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  // Returns true on a successful write (or in demo, where writing is intentionally
  // skipped); false only when the browser rejected the write (quota). Callers that
  // can roll back a change on failure check the return; others ignore it.
  function save(key, val) {
    if (isDemo) return true; // demo mode never touches real data
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { /* quota exceeded (usually huge logo) — warn once */ warnQuota(); return false; }
  }
  var quotaWarned = false;
  function warnQuota() {
    if (quotaWarned) return;
    quotaWarned = true;
    alert("Couldn't save — browser storage is full. Try a smaller logo image.");
  }

  // ---------- entitlement (Pro licence) ----------
  // Offline check: a signed key in localStorage is verified against the bundled
  // Ed25519 public key. No backend, no network. Fails safe to FREE — missing,
  // malformed, tampered, expired, or unverifiable => not Pro, and the app runs
  // exactly as the free tier does. A bad key never throws or blocks a free action.
  // ?demo unlocks Pro visually but writes nothing (save() already guards on isDemo).
  //
  // Licence string = base64url(payloadJSON) + "." + base64url(64-byte signature),
  // the signature being over the UTF-8 bytes of the payload segment. Payload is
  // { tier:"pro", exp } — exp = unix seconds, or null/absent = no expiry (pay-once).
  // A yearly key just carries a future exp; isPro() enforces it either way, so the
  // pay-once vs subscription choice is a Phase-2 issuance decision, not a code one.
  //
  // Production public key. The matching private key lives only in the licence signer
  // (tools/sign-license.mjs → tools/license-private.key, gitignored) and must never
  // enter this repo. Rotating it invalidates every previously issued licence.
  var LICENSE_PUBLIC_KEY = "bZPkqGJuWkawoaHXiffFRfADqG3XqfGHcEdfOzatLUM"; // Ed25519 raw public key, base64url
  var PRO_CHECKOUT_URL = "https://buy.stripe.com/14AaEXfrA6ijfzofau1Nu00"; // Stripe Payment Link

  var proState = { pro: false, ready: false, supported: true, exp: null };

  // Cached per page load: gated UI reads this synchronously after initEntitlement resolves.
  function isPro() { return isDemo || proState.pro; }

  function b64urlToBytes(s) {
    s = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Verify a licence string. Resolves to { ok, expired, unsupported, payload }.
  // Never rejects — any failure resolves { ok:false } so the boot path can't break.
  function verifyLicense(str) {
    return new Promise(function (resolve) {
      try {
        if (!str || typeof str !== "string" || str.indexOf(".") < 0) return resolve({ ok: false });
        var subtle = window.crypto && window.crypto.subtle;
        if (!subtle) return resolve({ ok: false, unsupported: true });
        var parts = str.split(".");
        if (parts.length !== 2) return resolve({ ok: false });
        var payloadSeg = parts[0];
        var sig = b64urlToBytes(parts[1]);
        var msg = new TextEncoder().encode(payloadSeg);
        var rawKey = b64urlToBytes(LICENSE_PUBLIC_KEY);
        subtle.importKey("raw", rawKey, { name: "Ed25519" }, false, ["verify"])
          .then(function (key) { return subtle.verify({ name: "Ed25519" }, key, sig, msg); })
          .then(function (valid) {
            if (!valid) return resolve({ ok: false });
            var payload;
            try { payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadSeg))); }
            catch (e) { return resolve({ ok: false }); }
            if (!payload || payload.tier !== "pro") return resolve({ ok: false });
            if (payload.exp != null && Date.now() / 1000 > payload.exp) return resolve({ ok: false, expired: true, payload: payload });
            resolve({ ok: true, payload: payload });
          })
          .catch(function () { resolve({ ok: false, unsupported: true }); }); // Ed25519 not supported by this browser
      } catch (e) { resolve({ ok: false }); }
    });
  }

  // data-pro on <body> is the single source of truth for CSS/JS gating (Pro tags, etc.).
  function applyProState() {
    document.body.dataset.pro = isPro() ? "on" : "off";
    if (typeof syncProControls === "function") syncProControls(); // keep the Pro rows in step
    if (typeof renderTemplatePick === "function") renderTemplatePick(); // and the template picker
  }

  // Run once at boot; caches the entitlement boolean and stamps <body data-pro>.
  function initEntitlement() {
    document.body.dataset.pro = "off"; // default until verification resolves
    if (isDemo) { proState.pro = true; proState.ready = true; applyProState(); return Promise.resolve(); }
    var str = null;
    try { str = localStorage.getItem(LS.license); } catch (e) { str = null; }
    if (!str) { proState.ready = true; applyProState(); return Promise.resolve(); }
    return verifyLicense(str).then(function (r) {
      proState.pro = !!r.ok;
      proState.supported = !r.unsupported;
      proState.exp = r.payload ? (r.payload.exp || null) : null;
      proState.ready = true;
      applyProState();
      renderLicense(); // refresh drawer UI if it's already open
    });
  }
  function todayISO(offsetDays) {
    var d = new Date();
    if (offsetDays) d.setDate(d.getDate() + offsetDays);
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function fmtDate(iso, locale) {
    if (!iso) return "";
    var parts = iso.split("-");
    if (parts.length !== 3) return iso;
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    if (isNaN(d)) return iso;
    try {
      return d.toLocaleDateString(locale || undefined, { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
      return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
    }
  }
  function num(v) {
    var n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  // clamp a line figure to >= 0 for math only — a typed negative qty/price must
  // not silently corrupt totals (the stored value is left untouched so the user
  // still sees, and can fix, what they typed)
  function nonneg(v) { return Math.max(0, num(v)); }
  function money(n, currency) {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: currency }).format(n);
    } catch (e) {
      return currency + " " + n.toFixed(2);
    }
  }
  function pad(n) { return String(n).padStart(3, "0"); }
  function uid() { return "d_" + Date.now() + "_" + Math.floor(Math.random() * 1e6); }
  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
  // an invoice is overdue only when it was actually SENT and its due date has
  // passed — drafts were never issued, so they can't be overdue
  function isOverdue(d) {
    if (!d || d.type !== "invoice" || d.status !== "sent" || !d.due) return false;
    return d.due < todayISO(0);
  }
  // darken a #rrggbb hex toward black by amount (0..1) — used to derive an ink tone
  function darken(hex, amount) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    var r = Math.round(((n >> 16) & 255) * (1 - amount));
    var g = Math.round(((n >> 8) & 255) * (1 - amount));
    var b = Math.round((n & 255) * (1 - amount));
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // ---------- state ----------
  var settings = load(LS.settings, {
    bizName: "", bizVat: "", bizAddress: "", logo: "",
    counters: { invoice: 1, quote: 1, receipt: 1 },
    defaultVat: 23, currency: "EUR", theme: "forest",
    payment: "", notes: ""
  });
  var docs = load(LS.docs, []);
  var clients = load(LS.clients, []);
  var templates = load(LS.templates, []); // Pro reusable starting points (no client/number/date, no images)
  if (!Array.isArray(templates)) templates = []; // a garbage value must never break boot
  var doc = null;         // current document
  var savedId = null;     // id in docs[] if this doc has been saved
  var sharedView = false; // viewing a document opened from a share link
  var draftTs = null;     // when the loaded draft was last touched

  function reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  function profileSnapshot() {
    return {
      bizName: settings.bizName || "", bizVat: settings.bizVat || "",
      bizAddress: settings.bizAddress || "", logo: settings.logo || "",
      payment: settings.payment || "", notes: settings.notes || ""
    };
  }
  function syncProfileSnapshot() {
    settings.profiles[settings.activeProfile] = profileSnapshot();
  }
  function loadProfile(i) {
    var p = settings.profiles[i];
    if (!p) return;
    settings.activeProfile = i;
    settings.bizName = p.bizName; settings.bizVat = p.bizVat;
    settings.bizAddress = p.bizAddress; settings.logo = p.logo;
    settings.payment = p.payment; settings.notes = p.notes;
  }

  function ensureSettings() {
    if (!settings.counters || typeof settings.counters !== "object") settings.counters = { invoice: 1, quote: 1, receipt: 1 };
    if (!settings.prefixes || typeof settings.prefixes !== "object") settings.prefixes = {};
    ["invoice", "quote", "receipt"].forEach(function (t) {
      if (!settings.prefixes[t]) settings.prefixes[t] = TYPE_META[t].prefix;
      if (!settings.counters[t]) settings.counters[t] = 1;
    });
    if (!settings.layout) settings.layout = "classic";
    if (!settings.lang || !LANGS[settings.lang]) settings.lang = "en";
    if (!Array.isArray(settings.profiles) || settings.profiles.length === 0) {
      settings.profiles = [profileSnapshot()];
      settings.activeProfile = 0;
    }
    if (typeof settings.activeProfile !== "number" || settings.activeProfile < 0 || settings.activeProfile >= settings.profiles.length) {
      settings.activeProfile = 0;
    }
  }
  ensureSettings();

  function newDoc(type) {
    var t = type || "invoice";
    return {
      id: null,
      type: t,
      number: autoNumber(t),
      currency: settings.currency || "EUR",
      date: todayISO(0),
      due: todayISO(14),
      reference: "",
      theme: settings.theme || "forest",
      customAccent: settings.customAccent || "",
      client: { name: "", vat: "", address: "" },
      items: [blankItem()],
      discount: 0,
      discountType: "percent",
      amountPaid: 0,
      layout: settings.layout || "classic",
      lang: settings.lang || "en",
      payment: settings.payment || "", // bank details persist — same on every invoice
      notes: settings.notes || "",     // your saved terms/notes carry into each new document
      status: "draft"
    };
  }
  function blankItem() {
    return { desc: "", qty: 1, price: "", vat: num(settings.defaultVat) };
  }
  function autoNumber(type) {
    var prefix = (settings.prefixes && settings.prefixes[type]) || TYPE_META[type].prefix;
    var count = (settings.counters && settings.counters[type]) || 1;
    return prefix + "-" + pad(count);
  }
  function isAutoNumber(n, type) {
    if (!n) return true;
    var pattern = "^(?:" + reEsc(TYPE_META[type].prefix) + "|" + reEsc((settings.prefixes && settings.prefixes[type]) || "") + ")-\\d+$";
    return new RegExp(pattern).test(n);
  }

  // ---------- editor <-> doc binding ----------
  function fillEditor() {
    $("f-number").value = doc.number;
    $("f-currency").value = doc.currency;
    $("f-date").value = doc.date;
    $("f-due").value = doc.due;
    $("f-reference").value = doc.reference;
    $("f-biz-name").value = settings.bizName;
    $("f-biz-vat").value = settings.bizVat;
    $("f-biz-address").value = settings.bizAddress;
    $("f-client-name").value = doc.client.name;
    $("f-client-vat").value = doc.client.vat;
    $("f-client-address").value = doc.client.address;
    $("f-discount").value = doc.discount;
    $("f-discount-type").value = doc.discountType;
    $("f-paid").value = doc.amountPaid || 0;
    $("f-default-vat").value = settings.defaultVat;
    $("f-payment").value = doc.payment;
    $("f-notes").value = doc.notes;
    $("f-lang").value = LANGS[doc.lang] ? doc.lang : "en";
    renderItemRows();
    syncTypeUI();
    syncThemeUI();
    syncLayoutUI();
    syncLogoUI();
    renderClientDatalist();
    renderProfileSelect();
  }

  function readEditor() {
    doc.number = $("f-number").value.trim();
    doc.currency = $("f-currency").value;
    doc.date = $("f-date").value;
    doc.due = $("f-due").value;
    doc.reference = $("f-reference").value.trim();
    settings.bizName = $("f-biz-name").value;
    settings.bizVat = $("f-biz-vat").value.trim();
    settings.bizAddress = $("f-biz-address").value;
    doc.client.name = $("f-client-name").value;
    doc.client.vat = $("f-client-vat").value.trim();
    doc.client.address = $("f-client-address").value;
    doc.discount = num($("f-discount").value);
    doc.discountType = $("f-discount-type").value;
    doc.amountPaid = num($("f-paid").value);
    settings.defaultVat = num($("f-default-vat").value);
    doc.payment = $("f-payment").value;
    doc.notes = $("f-notes").value;
    // receipts are always paid; for invoices/quotes the editor status select drives it
    if (doc.type !== "receipt" && $("f-status")) doc.status = $("f-status").value;
    // your own reusable details persist across new documents (only the client resets):
    // bank/payment AND notes/terms are remembered on the active business profile
    settings.payment = doc.payment;
    settings.notes = doc.notes;
    doc.lang = $("f-lang").value;
    settings.lang = doc.lang;
    var pfx = $("f-prefix").value.trim();
    settings.prefixes[doc.type] = pfx || TYPE_META[doc.type].prefix;
    var nn = Math.floor(num($("f-next-number").value));
    if (nn >= 1) settings.counters[doc.type] = nn;
  }

  // ---------- line item rows ----------
  function renderItemRows() {
    var list = $("items-list");
    list.textContent = "";
    doc.items.forEach(function (it, i) {
      var row = document.createElement("div");
      row.className = "item-row";
      row.dataset.index = i;

      var desc = document.createElement("input");
      desc.type = "text";
      desc.placeholder = i === 0 ? "e.g. Website design — 5 pages" : "Description";
      desc.value = it.desc;
      desc.dataset.field = "desc";
      desc.setAttribute("aria-label", "Item " + (i + 1) + " description");

      var qty = document.createElement("input");
      qty.type = "number"; qty.className = "num"; qty.min = "0"; qty.step = "any";
      qty.value = it.qty;
      qty.dataset.field = "qty";
      qty.inputMode = "decimal";
      qty.setAttribute("aria-label", "Item " + (i + 1) + " quantity");

      var price = document.createElement("input");
      price.type = "number"; price.className = "num"; price.min = "0"; price.step = "0.01";
      price.value = it.price;
      price.placeholder = "0.00";
      price.dataset.field = "price";
      price.inputMode = "decimal";
      price.setAttribute("aria-label", "Item " + (i + 1) + " unit price");

      var vat = document.createElement("input");
      vat.type = "number"; vat.className = "num"; vat.min = "0"; vat.max = "100"; vat.step = "0.1";
      vat.value = it.vat;
      vat.dataset.field = "vat";
      vat.inputMode = "decimal";
      vat.setAttribute("aria-label", "Item " + (i + 1) + " VAT percent");

      var del = document.createElement("button");
      del.type = "button";
      del.className = "item-remove";
      del.innerHTML = "&times;";
      del.title = "Remove line";
      del.setAttribute("aria-label", "Remove item " + (i + 1));

      row.append(desc, qty, price, vat, del);
      list.appendChild(row);
    });
    enhanceSteppers(list);
  }

  // ---------- custom number steppers ----------
  function enhanceSteppers(root) {
    (root || document).querySelectorAll('input[type="number"]').forEach(function (inp) {
      if (inp.closest(".stepper")) return;
      var wrap = document.createElement("div");
      wrap.className = "stepper";
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);
      var btns = document.createElement("div");
      btns.className = "step-btns";
      btns.innerHTML =
        '<button type="button" tabindex="-1" aria-label="Increase" data-step="1">' +
          '<svg width="9" height="6" viewBox="0 0 9 6" aria-hidden="true"><path d="M1.2 4.6 4.5 1.4l3.3 3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        "</button>" +
        '<button type="button" tabindex="-1" aria-label="Decrease" data-step="-1">' +
          '<svg width="9" height="6" viewBox="0 0 9 6" aria-hidden="true"><path d="M1.2 1.4 4.5 4.6l3.3-3.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        "</button>";
      wrap.appendChild(btns);
    });
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest(".step-btns button");
    if (!b) return;
    var inp = b.closest(".stepper").querySelector("input");
    if (!inp || inp.disabled) return;
    var v = num(inp.value) + (+b.dataset.step); // arrows step whole units; decimals are typed
    var min = inp.min !== "" ? parseFloat(inp.min) : -Infinity;
    var max = inp.max !== "" ? parseFloat(inp.max) : Infinity;
    v = Math.min(Math.max(v, min), max);
    inp.value = Math.round(v * 100) / 100;
    inp.dispatchEvent(new Event("input", { bubbles: true }));
  });

  // ---------- totals ----------
  // pure: totals for any document (defaults to the one being edited)
  function calcTotals(d) {
    d = d || doc;
    var subtotal = 0;
    d.items.forEach(function (it) { subtotal += nonneg(it.qty) * nonneg(it.price); });

    var discountAmt = 0;
    if (d.discount > 0) {
      discountAmt = d.discountType === "percent"
        ? subtotal * Math.min(d.discount, 100) / 100
        : Math.min(d.discount, subtotal);
    }
    var factor = subtotal > 0 ? (subtotal - discountAmt) / subtotal : 0;

    var vatByRate = {};
    d.items.forEach(function (it) {
      var net = nonneg(it.qty) * nonneg(it.price) * factor;
      var rate = num(it.vat);
      if (rate > 0 && net > 0) {
        vatByRate[rate] = (vatByRate[rate] || 0) + net * rate / 100;
      }
    });

    var vatTotal = 0;
    Object.keys(vatByRate).forEach(function (r) { vatTotal += vatByRate[r]; });
    var total = subtotal - discountAmt + vatTotal;
    var paid = d.type === "invoice" ? Math.min(num(d.amountPaid), total) : 0;
    return { subtotal: subtotal, discountAmt: discountAmt, vatByRate: vatByRate, vatTotal: vatTotal, total: total, paid: paid, balance: total - paid };
  }

  // Amount still owed on a SAVED invoice: snapshot total minus any deposit
  // recorded. Uses totalSnapshot (the figure saved at issue time), not live items.
  function balanceDueOf(d) {
    return Math.max(0, (d.totalSnapshot || 0) - nonneg(d.amountPaid));
  }

  // ---------- preview render ----------
  function render() {
    var meta = TYPE_META[doc.type];
    var L = LANGS[doc.lang] || LANGS.en;
    var cur = doc.currency;
    var biz = doc._sharedBiz || settings;

    $("sheet").dataset.layout = doc.layout || "classic";
    $("sheet").lang = LANGS[doc.lang] ? doc.lang : "en";   // sheet language for a11y + PDF (editor UI stays English)

    $("s-doctitle").textContent = L.titles[doc.type];
    $("s-numlabel").textContent = L.numLabels[doc.type];
    $("s-number").textContent = doc.number || "—";
    $("s-date-label").textContent = L.date;
    $("s-date").textContent = fmtDate(doc.date, L.locale);
    $("s-due-row").hidden = !meta.showDue || !doc.due;
    $("s-duelabel").textContent = doc.type === "quote" ? L.validUntil : L.due;
    $("s-due").textContent = fmtDate(doc.due, L.locale);
    $("s-ref-row").hidden = !doc.reference;
    $("s-ref-label").textContent = L.ref;
    $("s-reference").textContent = doc.reference;

    $("s-bizname").textContent = biz.bizName || "Your Business";
    $("s-bizaddress").textContent = biz.bizAddress || "";
    $("s-bizvat").textContent = biz.bizVat ? L.vat + ": " + biz.bizVat : "";

    var logo = $("s-logo");
    var logoSrc = doc._sharedBiz ? "" : settings.logo; // logos are too big for share links
    if (logoSrc) { logo.src = logoSrc; logo.hidden = false; }
    else { logo.hidden = true; logo.removeAttribute("src"); }

    $("s-billto-label").textContent = doc.type === "quote" ? L.preparedFor : L.billedTo;
    $("s-clientname").textContent = doc.client.name || "Client name";
    $("s-clientaddress").textContent = doc.client.address;
    $("s-clientvat").textContent = doc.client.vat ? L.vat + ": " + doc.client.vat : "";

    var ths = document.querySelectorAll(".s-items thead th");
    ths[0].textContent = L.desc;
    ths[1].textContent = L.qty;
    ths[2].textContent = L.unitPrice;
    ths[3].textContent = L.vat;
    ths[4].textContent = L.amount;

    $("s-paid-stamp").textContent = L.paidStamp;
    $("s-paid-stamp").hidden = !(doc.type === "receipt" || doc.status === "paid");

    // items table
    var body = $("s-items-body");
    body.textContent = "";
    var hasReal = doc.items.some(function (it) { return it.desc || num(it.price) > 0; });
    doc.items.forEach(function (it) {
      if (!hasReal && !it.desc && !num(it.price)) return; // placeholder handled below
      var tr = document.createElement("tr");
      var amount = nonneg(it.qty) * nonneg(it.price);
      tr.append(
        cell("c-desc", it.desc || "—"),
        cell("c-qty", String(num(it.qty))),
        cell("c-price", money(num(it.price), cur)),
        cell("c-vat", num(it.vat) + "%"),
        cell("c-amount", money(amount, cur))
      );
      body.appendChild(tr);
    });
    if (!hasReal) {
      var tr = document.createElement("tr");
      tr.className = "placeholder";
      tr.append(
        cell("c-desc", "Your first line item appears here"),
        cell("c-qty", "1"),
        cell("c-price", money(0, cur)),
        cell("c-vat", "0%"),
        cell("c-amount", money(0, cur))
      );
      body.appendChild(tr);
    }

    // totals
    var t = calcTotals();
    $("s-subtotal-label").textContent = L.subtotal;
    $("s-subtotal").textContent = money(t.subtotal, cur);
    $("s-discount-row").hidden = t.discountAmt <= 0;
    if (t.discountAmt > 0) {
      $("s-discount-label").textContent = doc.discountType === "percent"
        ? L.discount + " (" + doc.discount + "%)"
        : L.discount;
      $("s-discount").textContent = "−" + money(t.discountAmt, cur);
    }
    var vatRows = $("s-vat-rows");
    vatRows.textContent = "";
    Object.keys(t.vatByRate).sort(function (a, b) { return a - b; }).forEach(function (rate) {
      var tr = document.createElement("tr");
      var th = document.createElement("th");
      th.textContent = L.vat + " (" + rate + "%)";
      var td = document.createElement("td");
      td.textContent = money(t.vatByRate[rate], cur);
      tr.append(th, td);
      vatRows.appendChild(tr);
    });
    $("s-paid-row").hidden = t.paid <= 0;
    $("s-paid-label").textContent = L.paidToDate;
    if (t.paid > 0) $("s-paid").textContent = "−" + money(t.paid, cur);
    $("s-total-label").textContent = t.paid > 0 ? L.balanceDue : L.totals[doc.type];
    $("s-total").textContent = money(t.paid > 0 ? t.balance : t.total, cur);

    // payment / notes blocks
    $("s-payment-title").textContent = L.paymentDetails;
    $("s-payment-block").hidden = !(doc.payment.trim() && doc.type !== "quote");
    $("s-payment").textContent = doc.payment;
    $("s-notes-title").textContent = L.notes;
    $("s-notes-block").hidden = !doc.notes.trim();
    $("s-notes").textContent = doc.notes;

    $("s-foot-thanks").textContent = doc.type === "quote" ? L.quoteFoot : L.thanks;

    applyTheme(doc.theme);
    updateOverflowHint();
  }
  // Non-blocking preview hint when the sheet grows past one A4 page. Screen-only:
  // the hint element is .no-print and measurement never runs during printing.
  function updateOverflowHint() {
    var sheet = $("sheet");
    var hint = $("overflow-hint");
    if (!sheet || !hint) return;
    // .sheet has min-height 1123px (one A4 page @96dpi); taller means it overflows
    hint.hidden = sheet.offsetHeight <= 1130;
  }
  function cell(cls, text) {
    var td = document.createElement("td");
    td.className = cls;
    td.textContent = text;
    return td;
  }

  function applyTheme(name) {
    var accent, ink;
    if (name === "custom" && doc && doc.customAccent) {
      accent = doc.customAccent;
      ink = darken(doc.customAccent, 0.22);
    } else {
      var t = THEMES[name] || THEMES.forest;
      accent = t.accent; ink = t.ink;
    }
    document.documentElement.style.setProperty("--accent", accent);
    document.documentElement.style.setProperty("--accent-ink", ink);
  }

  // ---------- type / theme / logo UI sync ----------
  function syncTypeUI() {
    var meta = TYPE_META[doc.type];
    $("wrap-paid").style.display = doc.type === "invoice" ? "" : "none";
    document.querySelectorAll(".doc-type-switch button").forEach(function (b) {
      var on = b.dataset.doctype === doc.type;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("lbl-number").textContent = meta.numberFieldLabel;
    $("lbl-due").textContent = meta.dueFieldLabel;
    $("wrap-due").style.display = meta.showDue ? "" : "none";
    $("btn-convert").hidden = doc.type !== "quote";
    $("f-prefix").value = settings.prefixes[doc.type];
    $("f-next-number").value = settings.counters[doc.type] || 1;
    // status select mirrors the doc; receipts are always paid so we hide the control
    $("wrap-status").style.display = doc.type === "receipt" ? "none" : "";
    $("f-status").value = doc.status === "sent" || doc.status === "paid" ? doc.status : "draft";
  }
  function syncLayoutUI() {
    document.querySelectorAll("#layout-btns button").forEach(function (b) {
      b.classList.toggle("is-on", b.dataset.layout === (doc.layout || "classic"));
    });
  }
  function renderProfileSelect() {
    var sel = $("f-profile");
    sel.textContent = "";
    settings.profiles.forEach(function (p, i) {
      var o = document.createElement("option");
      o.value = i;
      o.textContent = p.bizName || "Business " + (i + 1);
      sel.appendChild(o);
    });
    // the active profile mirrors the live editor fields
    if (sel.options[settings.activeProfile]) {
      sel.options[settings.activeProfile].textContent = settings.bizName || "Business " + (settings.activeProfile + 1);
    }
    sel.value = settings.activeProfile;
    $("btn-profile-del").hidden = settings.profiles.length < 2;
  }
  function syncThemeUI() {
    renderAccentSwatch();
    document.querySelectorAll(".swatch").forEach(function (s) {
      s.classList.toggle("is-on", s.dataset.theme === doc.theme);
    });
  }
  // Suggested accent sampled from the logo — a SUGGESTION only. It appears as an
  // extra swatch; the user must click it to apply. Never changes the theme silently.
  function renderAccentSwatch() {
    var row = $("theme-swatches");
    var existing = row.querySelector('.swatch[data-theme="custom"]');
    if (!settings.logoAccent) { if (existing) existing.remove(); return; }
    var sw = existing || document.createElement("button");
    sw.type = "button";
    sw.className = "swatch swatch-suggested" + (doc.theme === "custom" ? " is-on" : "");
    sw.dataset.theme = "custom";
    sw.dataset.accent = settings.logoAccent;
    sw.style.setProperty("--sw", settings.logoAccent);
    sw.title = "Suggested from your logo";
    sw.setAttribute("aria-label", "Accent suggested from your logo");
    if (!existing) row.appendChild(sw);
  }
  // Sample a dominant colour from a logo data URL using a canvas (no library).
  // Averages the vivid, non-transparent, non-near-white/black pixels.
  function sampleLogoColor(src, cb) {
    try {
      var img = new Image();
      img.onload = function () {
        try {
          // size-less SVGs report 0×0 and rasterise empty — give them dimensions
          if (!img.naturalWidth || !img.naturalHeight) { img.width = 200; img.height = 200; }
          var c = document.createElement("canvas");
          var w = c.width = 40, h = c.height = 40;
          var ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          var data = ctx.getImageData(0, 0, w, h).data;
          var r = 0, g = 0, b = 0, n = 0;
          for (var i = 0; i < data.length; i += 4) {
            var pr = data[i], pg = data[i + 1], pb = data[i + 2], pa = data[i + 3];
            if (pa < 200) continue;                       // skip transparent
            var mx = Math.max(pr, pg, pb), mn = Math.min(pr, pg, pb);
            if (mx > 240 && mn > 240) continue;           // skip near-white
            if (mx < 30) continue;                        // skip near-black
            if (mx - mn < 18 && mx > 200) continue;       // skip pale greys
            r += pr; g += pg; b += pb; n++;
          }
          if (n < 8) return;                              // too little colour to trust
          var hex = "#" + [r, g, b].map(function (v) {
            return ("0" + Math.round(v / n).toString(16)).slice(-2);
          }).join("");
          cb(hex);
        } catch (e) { /* tainted/undrawable — no suggestion */ }
      };
      img.onerror = function () {};
      img.src = src;
    } catch (e) { /* ignore */ }
  }
  // Downscale a logo (data URL) through a canvas so we don't store a multi-MB
  // base64 blob in settings AND every profile snapshot. Long edge capped at
  // maxEdge; exported PNG keeps transparency. On any failure the raw src is
  // returned so a logo never silently disappears.
  function downscaleImage(src, maxEdge, cb) {
    try {
      var img = new Image();
      img.onload = function () {
        try {
          var iw = img.naturalWidth || img.width || maxEdge;
          var ih = img.naturalHeight || img.height || maxEdge;
          var scale = Math.min(1, maxEdge / Math.max(iw, ih));
          var w = Math.max(1, Math.round(iw * scale));
          var h = Math.max(1, Math.round(ih * scale));
          var c = document.createElement("canvas");
          c.width = w; c.height = h;
          c.getContext("2d").drawImage(img, 0, 0, w, h);
          var out = c.toDataURL("image/png");
          cb(out && out.length < src.length ? out : src); // never store a bigger result
        } catch (e) { cb(src); }
      };
      img.onerror = function () { cb(src); };
      img.src = src;
    } catch (e) { cb(src); }
  }
  function syncLogoUI() {
    var thumb = $("logo-thumb");
    var removeBtn = $("btn-logo-remove");
    if (settings.logo) { thumb.src = settings.logo; thumb.hidden = false; removeBtn.hidden = false; }
    else { thumb.hidden = true; removeBtn.hidden = true; thumb.removeAttribute("src"); }
  }

  // ---------- clients ----------
  function renderClientDatalist() {
    var dl = $("client-list");
    dl.textContent = "";
    clients.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.name;
      dl.appendChild(opt);
    });
  }
  function upsertClient() {
    var name = doc.client.name.trim();
    if (!name) return;
    var existing = clients.find(function (c) { return c.name.toLowerCase() === name.toLowerCase(); });
    if (existing) {
      // never wipe saved details with blanks
      if (doc.client.vat) existing.vat = doc.client.vat;
      if (doc.client.address) existing.address = doc.client.address;
    } else {
      clients.push({ name: name, vat: doc.client.vat, address: doc.client.address });
    }
    save(LS.clients, clients);
    renderClientDatalist();
  }
  function maybeAutofillClient() {
    var name = $("f-client-name").value.trim().toLowerCase();
    var match = clients.find(function (c) { return c.name.toLowerCase() === name; });
    if (match && (match.address || match.vat) && !$("f-client-address").value.trim() && !$("f-client-vat").value.trim()) {
      $("f-client-address").value = match.address || "";
      $("f-client-vat").value = match.vat || "";
      var note = $("client-saved-note");
      note.textContent = "Client details filled from your saved list.";
      note.hidden = false;
      setTimeout(function () { note.hidden = true; }, 3500);
    }
  }

  // ---------- persistence ----------
  var persistDraft = debounce(function () {
    if (sharedView) return; // never overwrite the local draft while just viewing a shared doc
    syncProfileSnapshot();
    save(LS.draft, { doc: doc, savedId: savedId, ts: Date.now() });
    save(LS.settings, settings);
  }, 400);

  function saveDocument() {
    if (sharedView) exitSharedView(true); // saving a shared doc = saving your own copy
    readEditor();
    if (!doc.number) { doc.number = autoNumber(doc.type); $("f-number").value = doc.number; }

    var wasNew = !doc.id;
    if (!doc.id) doc.id = uid();
    doc.savedAt = Date.now();
    var totals = calcTotals();
    doc.totalSnapshot = totals.total;

    var idx = docs.findIndex(function (d) { return d.id === doc.id; });
    if (idx >= 0) docs[idx] = JSON.parse(JSON.stringify(doc));
    else docs.unshift(JSON.parse(JSON.stringify(doc)));
    savedId = doc.id;

    // bump counter when the auto number for this type was used
    if (!settings.counters) settings.counters = { invoice: 1, quote: 1, receipt: 1 };
    if (doc.number === autoNumber(doc.type)) {
      settings.counters[doc.type] = (settings.counters[doc.type] || 1) + 1;
      $("f-next-number").value = settings.counters[doc.type]; // keep field in sync or the next input writes the stale value back
    }

    upsertClient();
    syncProfileSnapshot();
    save(LS.docs, docs);
    save(LS.settings, settings);
    persistDraft();
    renderHistory();
    flashSaved();
    return wasNew;
  }

  // Save from the toolbar: file the current doc, then — if it was a brand-new
  // document — start a fresh one so the user can roll straight into the next.
  // Editing an already-saved document just updates it in place (no surprise jump).
  function saveFromToolbar() {
    var savedType = doc.type;
    var savedNumber = doc.number;
    var wasNew = saveDocument();
    if (wasNew && !isDemo) {
      doc = newDoc(savedType);
      savedId = null;
      fillEditor();
      render();
      persistDraft();
      toast(savedNumber + " saved — started " + doc.number);
    }
  }

  function toast(msg, actionLabel, actionFn) {
    var t = $("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.className = "no-print";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg; // clears any previous action button
    if (actionLabel && actionFn) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "toast-action";
      b.textContent = actionLabel;
      b.addEventListener("click", function () {
        clearTimeout(toast._t);
        t.classList.remove("show");
        actionFn();
      });
      t.appendChild(b);
    }
    t.classList.add("show");
    clearTimeout(toast._t);
    // give undo actions longer to be clicked than a plain notice
    toast._t = setTimeout(function () { t.classList.remove("show"); }, actionFn ? 6000 : 2600);
  }

  function flashSaved() {
    var btn = $("btn-save");
    var old = btn.textContent;
    btn.textContent = "Saved ✓";
    btn.disabled = true;
    setTimeout(function () { btn.textContent = old; btn.disabled = false; }, 1400);
  }

  // ---------- history ----------
  function renderHistory() {
    var listEl = $("history-list");
    var countEl = $("history-count");
    listEl.textContent = "";
    $("history-empty").hidden = docs.length > 0;
    countEl.hidden = docs.length === 0;
    countEl.textContent = docs.length;

    docs.forEach(function (d) {
      var li = document.createElement("li");
      li.className = "history-item";

      var top = document.createElement("div");
      top.className = "hi-top";
      var numEl = document.createElement("span");
      numEl.className = "hi-number";
      numEl.textContent = d.number;
      if (isOverdue(d)) {
        var odh = document.createElement("span");
        odh.className = "hi-overdue";
        odh.textContent = "overdue";
        numEl.appendChild(odh);
      }
      var totalEl = document.createElement("span");
      totalEl.className = "hi-total";
      totalEl.textContent = money(d.totalSnapshot || 0, d.currency);
      top.append(numEl, totalEl);

      var client = document.createElement("div");
      client.className = "hi-client";
      client.textContent = (d.client.name || "No client") + " · " + fmtDate(d.date);

      var statusSel = document.createElement("select");
      statusSel.className = "hi-status-select " + d.status;
      statusSel.setAttribute("aria-label", "Status of " + d.number);
      ["draft", "sent", "paid"].forEach(function (s) {
        var o = document.createElement("option");
        o.value = s;
        o.textContent = s.charAt(0).toUpperCase() + s.slice(1);
        if (s === d.status) o.selected = true;
        statusSel.appendChild(o);
      });
      statusSel.addEventListener("change", function () { setStatus(d.id, this.value); });

      var actions = document.createElement("div");
      actions.className = "hi-actions";
      actions.append(
        miniBtn("Open", function () { loadDoc(d.id); }),
        miniBtn("Duplicate", function () { duplicateDoc(d.id); }),
        statusSel,
        miniBtn("Delete", function () { deleteDoc(d.id); }, true)
      );

      li.append(top, client, actions);
      listEl.appendChild(li);
    });
  }
  function miniBtn(label, fn, danger) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn tiny ghost" + (danger ? " danger" : "");
    b.textContent = label;
    b.addEventListener("click", fn);
    return b;
  }
  function setStatus(id, status) {
    var d = docs.find(function (x) { return x.id === id; });
    if (!d || ["draft", "sent", "paid"].indexOf(status) < 0) return;
    d.status = status;
    save(LS.docs, docs);
    if (savedId === id) { doc.status = status; render(); persistDraft(); }
    renderHistory();
  }
  // any action that replaces the current document keeps meaningful work first
  function keepCurrentIfMeaningful() {
    if (sharedView || isDemo) return;
    readEditor();
    if (hasContent(doc)) saveDocument(); // new content becomes a draft; pending edits to a saved doc get committed
  }

  function loadDoc(id) {
    var d = docs.find(function (x) { return x.id === id; });
    if (!d) return;
    keepCurrentIfMeaningful();
    doc = JSON.parse(JSON.stringify(d));
    savedId = id;
    fillEditor();
    render();
    persistDraft();
    closeHistory();
  }
  function duplicateDoc(id) {
    var d = docs.find(function (x) { return x.id === id; });
    if (!d) return;
    keepCurrentIfMeaningful();
    doc = JSON.parse(JSON.stringify(d));
    doc.id = null;
    doc.status = "draft";
    doc.date = todayISO(0);
    doc.due = todayISO(14);
    doc.number = autoNumber(doc.type);
    doc.amountPaid = 0; // a duplicate is a fresh document — don't carry the old deposit
    savedId = null;
    fillEditor();
    render();
    persistDraft();
    closeHistory();
  }
  // Delete with an undo window instead of a permanent confirm(). The removed doc
  // is buffered in the toast's Undo closure so it can splice back at its old spot.
  // `refresh` re-renders whatever list the delete was triggered from.
  // Limitation (accepted): there's a single #toast, so deleting two docs in quick
  // succession leaves only the latest Undo reachable — both deletions are saved
  // correctly, but the earlier one can't be undone from the UI once the second
  // toast replaces it.
  function deleteDoc(id, refresh) {
    var idx = docs.findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    var removed = docs[idx];
    var wasCurrent = savedId === id;
    docs.splice(idx, 1);
    if (wasCurrent) savedId = null;
    save(LS.docs, docs);
    renderHistory();
    if (refresh) refresh();
    toast("Deleted " + removed.number, "Undo", function () {
      docs.splice(Math.min(idx, docs.length), 0, removed);
      if (wasCurrent) savedId = removed.id;
      save(LS.docs, docs);
      renderHistory();
      if (refresh) refresh();
      if (!$("welcome").hidden) showWelcome(true);
    });
  }

  // ---------- backup export / import ----------
  $("btn-export").addEventListener("click", function () {
    var payload = {
      app: "tidyinvoice",
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: settings,
      docs: docs,
      clients: clients
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tidyinvoice-backup-" + todayISO(0) + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  });

  // Serialise a list of docs to the CSV shape used by the backup export. Shared by
  // the full "Export CSV" button and Pro bulk CSV (which scopes it to a selection).
  function docsToCSV(list) {
    function esc(v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }
    var rows = [["Number", "Type", "Status", "Date", "Due", "Client", "Currency", "Total"].join(",")];
    list.forEach(function (d) {
      rows.push([
        esc(d.number), esc(d.type), esc(d.status), esc(d.date), esc(d.due || ""),
        esc(d.client && d.client.name), esc(d.currency), (d.totalSnapshot || 0).toFixed(2)
      ].join(","));
    });
    return "﻿" + rows.join("\r\n");
  }
  function downloadCSV(list, filename) {
    var blob = new Blob([docsToCSV(list)], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  $("btn-csv").addEventListener("click", function () {
    if (docs.length === 0) { alert("Nothing saved yet — save a document first."); return; }
    downloadCSV(docs, "tidyinvoice-documents-" + todayISO(0) + ".csv");
  });

  $("btn-import").addEventListener("click", function () { $("f-import").click(); });
  $("f-import").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = "";
    if (!file) return;
    if (isDemo) { alert("Demo mode — import is disabled. Open the app without ?demo to import."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (e) { data = null; }
      if (!data || data.app !== "tidyinvoice" || !Array.isArray(data.docs)) {
        alert("That doesn't look like a TidyInvoice backup file.");
        return;
      }
      if (!confirm("Import backup? This replaces the " + docs.length + " document(s) and settings currently in this browser.")) return;
      // merge over defaults so a partial/old backup can't leave fields missing
      settings = Object.assign({
        bizName: "", bizVat: "", bizAddress: "", logo: "",
        counters: { invoice: 1, quote: 1, receipt: 1 },
        defaultVat: 23, currency: "EUR", theme: "forest",
        payment: "", notes: ""
      }, data.settings || {});
      ensureSettings();
      docs = data.docs;
      clients = Array.isArray(data.clients) ? data.clients : clients;
      save(LS.settings, settings);
      save(LS.docs, docs);
      save(LS.clients, clients);
      doc = newDoc(doc.type);
      savedId = null;
      fillEditor();
      render();
      renderHistory();
      persistDraft();
    };
    reader.readAsText(file);
  });

  function openHistory() {
    renderHistory();
    renderLicense();
    licenseMsg(""); // clear any stale message from a previous open
    $("history-drawer").hidden = false;
    $("drawer-backdrop").hidden = false;
  }
  function closeHistory() {
    $("history-drawer").hidden = true;
    $("drawer-backdrop").hidden = true;
  }

  // ---------- licence (Pro) UI ----------
  function isoFromUnix(sec) {
    var d = new Date(sec * 1000);
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }
  function licenseMsg(text, kind) {
    var el = $("license-msg");
    if (!el) return;
    if (!text) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = text;
    el.dataset.kind = kind || "info";
  }
  function renderLicense() {
    var wrap = $("drawer-license");
    if (!wrap) return;
    var stateEl = $("license-state");
    var buy = $("license-buy");
    if (buy) buy.hidden = (PRO_CHECKOUT_URL === "#"); // hide the dead link until Phase 2 sets the URL
    if (buy) buy.href = PRO_CHECKOUT_URL;
    var pro = isPro();
    $("license-pro").hidden = !pro || isDemo; // nothing stored to remove in demo
    $("license-free").hidden = pro;
    if (pro) {
      stateEl.dataset.plan = "pro";
      if (isDemo) stateEl.textContent = "Pro — demo mode";
      else if (proState.exp) stateEl.textContent = "Pro — active until " + fmtDate(isoFromUnix(proState.exp));
      else stateEl.textContent = "Pro — active";
    } else {
      stateEl.dataset.plan = "free";
      var hasKey = false;
      try { hasKey = !!localStorage.getItem(LS.license); } catch (e) {}
      stateEl.textContent = (hasKey && !proState.supported)
        ? "Free — this browser can't verify licences"
        : "Free plan";
    }
  }
  $("btn-license-activate").addEventListener("click", function () {
    var key = ($("f-license").value || "").trim();
    if (!key) { licenseMsg("Paste your licence key first.", "err"); return; }
    if (isDemo) { licenseMsg("Demo mode — activation is disabled.", "err"); return; }
    licenseMsg("Checking…", "info");
    verifyLicense(key).then(function (r) {
      if (!r.ok) {
        if (r.expired) licenseMsg("That licence has expired.", "err");
        else if (r.unsupported) licenseMsg("This browser can't verify licences — please update it.", "err");
        else licenseMsg("That licence key isn't valid.", "err");
        return; // never store an invalid key
      }
      try { localStorage.setItem(LS.license, key); }
      catch (e) { licenseMsg("Couldn't save the licence — browser storage may be full.", "err"); return; }
      proState.pro = true;
      proState.supported = true;
      proState.exp = r.payload ? (r.payload.exp || null) : null;
      applyProState();
      $("f-license").value = "";
      renderLicense();
      licenseMsg("Pro activated — thank you!", "ok");
    });
  });
  $("btn-license-remove").addEventListener("click", function () {
    if (isDemo) return;
    if (!confirm("Remove this licence and return to the free plan?")) return;
    try { localStorage.removeItem(LS.license); } catch (e) {}
    proState.pro = false;
    proState.exp = null;
    applyProState();
    renderLicense();
    licenseMsg("Licence removed — back to the free plan.", "info");
  });

  // ---------- Pro upsell (A3) ----------
  // One compact, dismissible modal shared by every gated control. After the user
  // dismisses it once, we stay quiet for the rest of the session (no re-prompting).
  var upsellDismissed = false;
  function closeUpsell() {
    $("upsell-modal").hidden = true;
    $("upsell-backdrop").hidden = true;
  }
  function dismissUpsell() { upsellDismissed = true; closeUpsell(); }
  function upsellOpen() { return !$("upsell-modal").hidden; }
  // Show the upsell for a gated feature. `feature` is a single plain-English line.
  // Returns true if it opened, false if suppressed (Pro, or already dismissed).
  function openUpsell(feature) {
    if (isPro()) return false;         // never upsell someone who already has Pro
    if (upsellDismissed) return false; // respected their dismiss for this session
    $("upsell-body").textContent = feature || "This is a Pro feature.";
    $("upsell-buy").href = PRO_CHECKOUT_URL; // opens the Stripe checkout in a new tab
    $("upsell-backdrop").hidden = false;
    $("upsell-modal").hidden = false;
    return true;
  }
  // Gate a click: if Free, show the upsell and swallow the action; if Pro, run it.
  // Use as the click handler for any Pro-only control.
  function guardPro(feature, fn) {
    return function (e) {
      if (isPro()) return fn.call(this, e);
      if (e) { e.preventDefault(); }
      openUpsell(feature);
    };
  }
  $("upsell-buy").addEventListener("click", function () {
    dismissUpsell(); // the anchor opens checkout in a new tab; don't re-prompt this session
  });
  $("upsell-key").addEventListener("click", function () {
    dismissUpsell();
    openHistory();
    var f = $("f-license");
    if (f) { try { f.focus(); } catch (e) {} }
  });
  $("upsell-backdrop").addEventListener("click", dismissUpsell);

  // ---------- preview scaling ----------
  function scalePreview() {
    // keep the mobile tab bar stuck just below the (wrapping) top bar
    var tb = document.querySelector(".topbar");
    if (tb) document.documentElement.style.setProperty("--topbar-h", tb.offsetHeight + "px");
    var pane = $("preview-pane");
    var scaler = $("sheet-scaler");
    if (pane.clientWidth === 0) return; // hidden (mobile edit view) — skip
    var available = pane.clientWidth - (window.innerWidth > 960 ? 52 : 16);
    var scale = Math.max(Math.min(available / 794, 1), 0.1);
    scaler.style.transform = "scale(" + scale + ")";
    // reserve correct vertical space so the pane scrolls naturally
    scaler.style.height = (1123 * scale) + "px";
    scaler.style.width = (794 * scale) + "px";
  }

  // ---------- events ----------
  function onEditorInput(e) {
    var t = e.target;
    // line item fields
    var row = t.closest && t.closest(".item-row");
    if (row) {
      var idx = +row.dataset.index;
      var field = t.dataset.field;
      if (doc.items[idx] && field) doc.items[idx][field] = t.value;
    }
    var wasAuto = isAutoNumber(doc.number, doc.type);
    readEditor();
    // editing numbering settings regenerates an auto-style number live
    if ((t.id === "f-prefix" || t.id === "f-next-number") && wasAuto) {
      doc.number = autoNumber(doc.type);
      $("f-number").value = doc.number;
    }
    // keep the profile dropdown label in sync with the business name
    if (t.id === "f-biz-name") {
      var opt = $("f-profile").options[settings.activeProfile];
      if (opt) opt.textContent = settings.bizName || "Business " + (settings.activeProfile + 1);
    }
    render();
    persistDraft();
  }

  document.querySelector(".editor").addEventListener("input", onEditorInput);

  $("f-client-name").addEventListener("change", maybeAutofillClient);

  // Editor status select. The bubbling "input" event already updates doc.status via
  // readEditor + persists the draft; here we also commit to docs[] when the document
  // is already saved, so the Saved drawer, welcome list and overdue flags update now.
  $("f-status").addEventListener("change", function () {
    doc.status = this.value;
    if (savedId) {
      var d = docs.find(function (x) { return x.id === savedId; });
      if (d) { d.status = doc.status; save(LS.docs, docs); renderHistory(); }
    }
    render();
    persistDraft();
  });

  $("items-list").addEventListener("click", function (e) {
    var btn = e.target.closest(".item-remove");
    if (!btn) return;
    var idx = +btn.closest(".item-row").dataset.index;
    doc.items.splice(idx, 1);
    if (doc.items.length === 0) doc.items.push(blankItem());
    renderItemRows();
    render();
    persistDraft();
  });

  $("btn-add-item").addEventListener("click", function () {
    doc.items.push(blankItem());
    renderItemRows();
    render();
    persistDraft();
    var rows = document.querySelectorAll(".item-row");
    var last = rows[rows.length - 1];
    if (last) last.querySelector("input").focus();
  });

  document.querySelectorAll(".doc-type-switch button").forEach(function (b) {
    b.addEventListener("click", function () {
      var newType = b.dataset.doctype;
      if (doc.type === newType) return;
      var oldType = doc.type;
      var wasAuto = isAutoNumber(doc.number, oldType);
      doc.type = newType;
      if (wasAuto) {
        doc.number = autoNumber(newType);
        $("f-number").value = doc.number;
      }
      if (newType === "receipt") doc.status = "paid";
      else if (oldType === "receipt" && doc.status === "paid" && !savedId) doc.status = "draft";
      syncTypeUI();
      render();
      persistDraft();
    });
  });

  $("layout-btns").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    doc.layout = b.dataset.layout;
    settings.layout = b.dataset.layout;
    syncLayoutUI();
    render();
    persistDraft();
  });

  $("f-profile").addEventListener("change", function () {
    syncProfileSnapshot();
    loadProfile(+this.value);
    fillEditor();
    render();
    persistDraft();
  });
  $("btn-profile-new").addEventListener("click", function () {
    syncProfileSnapshot();
    settings.profiles.push({ bizName: "", bizVat: "", bizAddress: "", logo: "", payment: "", notes: "" });
    loadProfile(settings.profiles.length - 1);
    fillEditor();
    render();
    persistDraft();
    $("f-biz-name").focus();
  });
  $("btn-profile-del").addEventListener("click", function () {
    if (settings.profiles.length < 2) return;
    var label = settings.bizName || "this profile";
    if (!confirm("Delete " + label + "? Its saved details are removed (documents are kept).")) return;
    settings.profiles.splice(settings.activeProfile, 1);
    loadProfile(0);
    fillEditor();
    render();
    persistDraft();
  });

  $("theme-swatches").addEventListener("click", function (e) {
    var sw = e.target.closest(".swatch");
    if (!sw) return;
    doc.theme = sw.dataset.theme;
    settings.theme = sw.dataset.theme;
    if (sw.dataset.theme === "custom") {
      doc.customAccent = sw.dataset.accent || settings.logoAccent || "";
      settings.customAccent = doc.customAccent;
    }
    syncThemeUI();
    render();
    persistDraft();
  });

  $("f-logo").addEventListener("change", function () {
    var file = this.files && this.files[0];
    if (!file) return;
    if (file.size > 1.5 * 1024 * 1024) {
      alert("Logo is over 1.5 MB — please use a smaller image so it fits in browser storage.");
      this.value = "";
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      // downscale before storing — the logo lives in settings and every profile
      // snapshot, so a full-size base64 blob can blow the localStorage quota
      downscaleImage(reader.result, 600, function (stored) {
        settings.logo = stored;
        save(LS.settings, settings);
        syncLogoUI();
        render();
        sampleLogoColor(stored, function (hex) {
          settings.logoAccent = hex;
          save(LS.settings, settings);
          renderAccentSwatch();
        });
      });
    };
    reader.readAsDataURL(file);
  });

  $("btn-logo-remove").addEventListener("click", function () {
    settings.logo = "";
    settings.logoAccent = "";
    // the custom swatch disappears with the logo, so a doc still themed "custom"
    // would keep the colour with no way to reselect it — revert to a preset instead
    if (doc.theme === "custom") {
      doc.theme = "forest";
      settings.theme = "forest";
      doc.customAccent = "";
      settings.customAccent = "";
    }
    save(LS.settings, settings);
    $("f-logo").value = "";
    syncLogoUI();
    syncThemeUI();
    render();
    persistDraft();
  });

  function hasContent(d) {
    return !!(d.client.name.trim() || d.items.some(function (it) {
      return (it.desc && String(it.desc).trim()) || num(it.price) > 0;
    }));
  }

  // Signature of the fields a user actually edits — used to detect unsaved changes.
  // Item numerics are normalised so re-typing the same value (which turns a stored
  // number into an identical string) doesn't read as a change.
  function docSignature(d) {
    return JSON.stringify({
      type: d.type, number: d.number, currency: d.currency, date: d.date, due: d.due,
      reference: d.reference, theme: d.theme, layout: d.layout, lang: d.lang,
      client: d.client,
      items: d.items.map(function (it) { return { desc: it.desc || "", qty: num(it.qty), price: num(it.price), vat: num(it.vat) }; }),
      discount: num(d.discount), discountType: d.discountType,
      amountPaid: num(d.amountPaid), payment: d.payment, notes: d.notes, status: d.status
    });
  }
  // Unsaved changes exist when: (a) a new document has real content and was never
  // saved, or (b) an already-saved document has been edited since it was saved.
  function isDirty() {
    if (!hasContent(doc)) return false;
    if (!doc.id) return true;
    var saved = docs.find(function (x) { return x.id === doc.id; });
    if (!saved) return true;
    return docSignature(doc) !== docSignature(saved);
  }

  // ----- unsaved-changes dialog -----
  // onclick assignment (not addEventListener) means each open overwrites the last
  // handlers, so nothing stacks and no manual cleanup bookkeeping is needed.
  function closeConfirm() {
    $("confirm-modal").hidden = true;
    $("confirm-backdrop").hidden = true;
  }
  function openConfirm(onSave, onDiscard) {
    var saved = doc.id && docs.find(function (x) { return x.id === doc.id; });
    $("confirm-title").textContent = saved
      ? "Save changes to " + doc.number + "?"
      : "Save this " + doc.type + "?";
    $("confirm-body").textContent = saved
      ? "You've edited this " + doc.type + " since it was saved."
      : "This " + doc.type + " hasn't been saved yet.";
    $("confirm-backdrop").hidden = false;
    $("confirm-modal").hidden = false;

    $("confirm-save").onclick = function () { closeConfirm(); onSave(); };
    $("confirm-discard").onclick = function () { closeConfirm(); onDiscard(); };
    $("confirm-cancel").onclick = closeConfirm;
    $("confirm-backdrop").onclick = closeConfirm;
    $("confirm-save").focus();
  }
  function confirmModalOpen() { return !$("confirm-modal").hidden; }

  function startNewDoc() {
    doc = newDoc(doc.type);
    savedId = null;
    fillEditor();
    render();
    persistDraft();
  }

  $("btn-new").addEventListener("click", function () {
    readEditor();
    if (!sharedView && !isDemo && isDirty()) {
      openConfirm(
        function () { // Save
          var keptNumber = doc.number;
          saveDocument();
          startNewDoc();
          toast(keptNumber + " saved");
        },
        function () { startNewDoc(); } // Discard
      );
      return;
    }
    startNewDoc();
  });

  $("btn-save").addEventListener("click", saveFromToolbar);
  $("btn-history").addEventListener("click", openHistory);
  $("btn-close-history").addEventListener("click", closeHistory);
  $("drawer-backdrop").addEventListener("click", closeHistory);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      if (upsellOpen()) { dismissUpsell(); return; } // close the upsell only
      if (confirmModalOpen()) { closeConfirm(); return; } // cancel the dialog only
      closeHistory();
      if (!$("welcome").hidden && !$("welcome-all").hidden) { welcomeShowView("home"); }
      else hideWelcome();
    }
    var k = e.key && e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); saveFromToolbar(); }
    if ((e.ctrlKey || e.metaKey) && k === "p") { e.preventDefault(); printPDF(); }
  });

  var titleBeforePrint = null;
  function printPDF() {
    readEditor();
    render();
    if (titleBeforePrint === null) titleBeforePrint = document.title;
    document.title = (doc.number || "document") + (doc.client.name ? " — " + doc.client.name : "");
    window.print();
    // Safari's print dialog is async — restore on afterprint, with a fallback
    setTimeout(restoreTitle, 3000);
  }
  function restoreTitle() {
    if (titleBeforePrint !== null) { document.title = titleBeforePrint; titleBeforePrint = null; }
  }
  window.addEventListener("afterprint", restoreTitle);
  $("btn-download").addEventListener("click", printPDF);

  $("btn-convert").addEventListener("click", function () {
    readEditor();
    doc.type = "invoice";
    doc.reference = doc.reference || "Quote " + doc.number;
    doc.number = autoNumber("invoice");
    doc.id = null;
    doc.status = "draft";
    doc.date = todayISO(0);
    doc.due = todayISO(14);
    savedId = null;
    fillEditor();
    render();
    persistDraft();
  });

  // ---------- share links ----------
  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return decodeURIComponent(escape(atob(s)));
  }

  $("btn-share").addEventListener("click", function () {
    readEditor();
    var shareDoc = JSON.parse(JSON.stringify(doc));
    delete shareDoc._sharedBiz;
    delete shareDoc.id;
    var payload = {
      v: 1,
      doc: shareDoc,
      biz: { bizName: settings.bizName, bizVat: settings.bizVat, bizAddress: settings.bizAddress }
    };
    var url = location.origin + location.pathname + "#d=" + b64urlEncode(JSON.stringify(payload));
    if (url.length > 7500) { alert("This document is too large to share as a link. Documents with many line items (or very long notes) can exceed the limit — try removing some lines or shortening notes, or use Download PDF and send that instead."); return; }
    var btn = this;
    function done() {
      var old = "Copy share link";
      btn.textContent = "Link copied ✓";
      setTimeout(function () { btn.textContent = old; }, 1600);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function () { prompt("Copy this link:", url); });
    } else {
      prompt("Copy this link:", url);
    }
  });

  // ---------- send by email (mailto) ----------
  // mailto can't carry attachments, so we download the PDF first and remind the
  // user to attach it, then open a pre-filled draft (recipient pulled from the
  // client contact block if an email address is present there).
  $("btn-email").addEventListener("click", function () {
    readEditor();
    var L = LANGS[doc.lang] || LANGS.en;
    var typeName = doc.type.charAt(0).toUpperCase() + doc.type.slice(1);
    var t = calcTotals();
    var amount = money(t.paid > 0 ? t.balance : t.total, doc.currency);
    // first email address found in the client contact block, if any
    var m = (doc.client.address || "").match(/[^\s,;<]+@[^\s,;>]+\.[^\s,;>]+/);
    var to = m ? m[0] : "";
    var subject = typeName + " " + (doc.number || "") + (settings.bizName ? " from " + settings.bizName : "");
    var lines = [
      "Hi" + (doc.client.name ? " " + doc.client.name : "") + ",",
      "",
      "Please find attached " + typeName.toLowerCase() + " " + (doc.number || "") + " for " + amount + "."
    ];
    if (doc.type === "quote" && doc.due) lines.push("This quote is valid until " + fmtDate(doc.due, L.locale) + ".");
    else if (doc.type === "invoice" && doc.due) lines.push("Payment is due by " + fmtDate(doc.due, L.locale) + ".");
    lines.push("", "Thank you,");
    if (settings.bizName) lines.push(settings.bizName);
    // download the PDF so it's ready to attach, then open the draft
    toast("PDF downloaded — attach it before sending.");
    printPDF();
    setTimeout(function () {
      location.href = "mailto:" + encodeURIComponent(to) +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(lines.join("\n"));
    }, 500);
  });

  function exitSharedView(keepDoc) {
    sharedView = false;
    $("shared-banner").hidden = true;
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.search);
    if (keepDoc) {
      delete doc._sharedBiz;
      savedId = null;
    } else {
      doc = newDoc("invoice");
      savedId = null;
    }
    fillEditor();
    render();
  }
  $("btn-shared-save").addEventListener("click", function () {
    exitSharedView(true);
    saveDocument();
  });
  $("btn-shared-new").addEventListener("click", function () {
    exitSharedView(false);
    persistDraft();
  });

  // ---------- dark mode ----------
  function applyUITheme() {
    var t = settings.uiTheme;
    if (t !== "dark" && t !== "light") {
      t = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    document.body.dataset.ui = t;
    $("btn-uitheme").textContent = t === "dark" ? "☀" : "☾";
    $("btn-uitheme").title = t === "dark" ? "Switch to light mode" : "Switch to dark mode";
  }
  $("btn-uitheme").addEventListener("click", function () {
    settings.uiTheme = document.body.dataset.ui === "dark" ? "light" : "dark";
    save(LS.settings, settings);
    applyUITheme();
  });

  // ---------- welcome / resume screen ----------
  function typeLabel(t) { return t.charAt(0).toUpperCase() + t.slice(1); }
  function relTime(ts) {
    if (!ts) return "";
    var mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return "edited just now";
    if (mins < 60) return "edited " + mins + " min ago";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return "edited " + hrs + (hrs === 1 ? " hour" : " hours") + " ago";
    var days = Math.floor(hrs / 24);
    return "edited " + days + (days === 1 ? " day" : " days") + " ago";
  }
  // One saved-document row, shared by the welcome home list and the all-documents page.
  function buildDocRow(d, opts) {
    opts = opts || {};
    var li = document.createElement("li");
    li.className = "welcome-recent-item";

    // Pro bulk-select checkbox (all-documents page only). Free rows have none, so
    // single-doc open/duplicate/PDF/delete are exactly as before.
    if (opts.selectable) {
      var check = document.createElement("input");
      check.type = "checkbox";
      check.className = "wr-check";
      check.checked = !!waSelected[d.id];
      check.setAttribute("aria-label", "Select " + d.number);
      check.addEventListener("change", function () {
        if (check.checked) waSelected[d.id] = true; else delete waSelected[d.id];
        updateBulkUI();
      });
      li.appendChild(check);
    }

    var open = document.createElement("button");
    open.type = "button";
    open.className = "wr-open";
    open.setAttribute("aria-label", "Open " + d.number);
    open.addEventListener("click", function () { loadDoc(d.id); hideWelcome(); });

    var num = document.createElement("span");
    num.className = "wr-num";
    num.textContent = d.number;
    var client = document.createElement("span");
    client.className = "wr-client";
    client.textContent = (d.client.name || "No client") + (opts.showDate ? " · " + fmtDate(d.date) : "");
    var pill = document.createElement("span");
    pill.className = "wr-pill " + d.status;
    pill.textContent = d.status;
    var total = document.createElement("span");
    total.className = "wr-total";
    total.textContent = money(d.totalSnapshot || 0, d.currency);
    open.append(num, client, pill);
    if (isOverdue(d)) {
      var od = document.createElement("span");
      od.className = "wr-pill overdue";
      od.textContent = "overdue";
      open.append(od);
    }
    open.append(total);
    li.appendChild(open);

    function act(label, title, fn) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "btn tiny ghost wr-act";
      b.textContent = label;
      if (title) b.title = title;
      b.addEventListener("click", fn);
      return b;
    }
    li.appendChild(act("Duplicate", "New copy for the same client", function () { duplicateDoc(d.id); hideWelcome(); }));
    li.appendChild(act("PDF", "Open and download as PDF", function () { loadDoc(d.id); hideWelcome(); printPDF(); }));
    if (opts.onDelete) {
      var del = act("Delete", null, function () { deleteDoc(d.id, opts.onDelete); });
      del.classList.add("danger");
      li.appendChild(del);
    }
    return li;
  }
  // Start a fresh document seeded from a client's most recent document — their
  // details and last line items. Numbering still auto-increments as normal.
  function newFromClient(name) {
    if (!name) return;
    var src = docs.find(function (d) {
      return d.client && d.client.name && d.client.name.toLowerCase() === name.toLowerCase();
    });
    keepCurrentIfMeaningful();
    if (src) {
      doc = JSON.parse(JSON.stringify(src));
      doc.id = null;
      doc.status = doc.type === "receipt" ? "paid" : "draft";
      doc.date = todayISO(0);
      doc.due = todayISO(14);
      doc.number = autoNumber(doc.type);
      doc.amountPaid = 0;
      // reset per-document fields (last job's PO/discount must not carry over);
      // keep items, payment, currency, layout and theme; notes fall back to your saved terms
      doc.reference = "";
      doc.notes = settings.notes || "";
      doc.discount = 0;
      doc.discountType = "percent";
      delete doc.savedAt;
      delete doc.totalSnapshot;
    } else {
      doc = newDoc("invoice");
      var c = clients.find(function (x) { return x.name.toLowerCase() === name.toLowerCase(); });
      if (c) doc.client = { name: c.name, vat: c.vat || "", address: c.address || "" };
    }
    savedId = null;
    fillEditor();
    render();
    persistDraft();
    hideWelcome();
    toast("New " + doc.type + " for " + name);
  }
  // Populate the welcome "new from a client" picker with clients that have a
  // saved document to seed from (most-recent order follows docs[]).
  function renderWelcomeClientNew() {
    var wrap = $("welcome-client-wrap");
    var sel = $("welcome-client-new");
    if (!wrap || !sel) return;
    var names = [];
    docs.forEach(function (d) {
      var nm = d.client && d.client.name;
      if (nm && names.indexOf(nm) < 0) names.push(nm);
    });
    if (!names.length) { wrap.hidden = true; return; }
    sel.textContent = "";
    var def = document.createElement("option");
    def.value = ""; def.textContent = "New from a client…";
    sel.appendChild(def);
    names.forEach(function (nm) {
      var o = document.createElement("option");
      o.value = nm; o.textContent = nm;
      sel.appendChild(o);
    });
    wrap.hidden = false;
  }

  // ---------- reusable templates (B3, Pro) ----------
  var UPSELL_TEMPLATE = "Save a document as a reusable template and start new ones from it — a Pro feature.";
  // Capture the current document's reusable parts. Deliberately excludes client,
  // number and dates (a template is a starting point, not a copy) and stores no
  // logo or images, so templates stay tiny and quota-safe.
  function saveAsTemplate() {
    if (isDemo) { toast("Demo mode — changes aren't saved"); return; }
    readEditor();
    var firstDesc = (doc.items.find(function (it) { return it.desc; }) || {}).desc || "";
    var tpl = {
      id: "t_" + Date.now(),
      name: typeLabel(doc.type) + (firstDesc ? " · " + firstDesc : ""),
      type: doc.type,
      currency: doc.currency,
      layout: doc.layout,
      payment: doc.payment || "",
      notes: doc.notes || "",
      items: JSON.parse(JSON.stringify(doc.items || []))
    };
    templates.unshift(tpl);
    if (!save(LS.templates, templates)) { templates.shift(); toast("Storage full — template not saved"); return; }
    renderTemplatePick();
    toast("Saved as template");
  }
  // Fresh draft seeded from a template: newDoc() supplies a new auto number, today's
  // dates and a blank client (exactly like a normal New); the template only fills in
  // items, terms, notes, layout and currency.
  function newFromTemplate(id) {
    var tpl = templates.find(function (t) { return t.id === id; });
    if (!tpl) return;
    keepCurrentIfMeaningful();
    doc = newDoc(tpl.type);
    if (tpl.currency) doc.currency = tpl.currency;
    if (tpl.layout) doc.layout = tpl.layout;
    doc.payment = tpl.payment || "";
    doc.notes = tpl.notes || "";
    if (tpl.items && tpl.items.length) doc.items = JSON.parse(JSON.stringify(tpl.items));
    savedId = null;
    fillEditor();
    render();
    persistDraft();
    hideWelcome();
    toast("New " + doc.type + " from template");
  }
  // Home-screen template picker. Free users always see it as a locked, tagged teaser
  // (click → upsell); Pro users see it only when they have templates to pick from.
  function renderTemplatePick() {
    var wrap = $("welcome-template-wrap");
    var sel = $("welcome-template-new");
    if (!wrap || !sel) return;
    var pro = isPro();
    if (pro && !templates.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    sel.textContent = "";
    var def = document.createElement("option");
    def.value = ""; def.textContent = "New from a template…";
    sel.appendChild(def);
    if (pro) {
      templates.forEach(function (t) {
        var o = document.createElement("option");
        o.value = t.id; o.textContent = t.name;
        sel.appendChild(o);
      });
    }
    lockProBox(wrap, "New from template — Pro feature"); // inert + tagged while Free
  }

  function showWelcome(force) {
    if (isDemo || sharedView) return;
    var hasDraftContent = doc && hasContent(doc);

    // first visit: greet and capture the user's name before anything else
    var home = $("welcome-home");
    if (!settings.userName) {
      home.classList.add("is-firstrun");
      $("welcome-firstrun").hidden = false;
      $("welcome").hidden = false;
      setTimeout(function () { var i = $("welcome-name-input"); if (i) i.focus(); }, 60);
      return; // rest of the home screen stays hidden until we have a name
    }
    home.classList.remove("is-firstrun");
    $("welcome-firstrun").hidden = true;

    // greeting — returning users are welcomed back by name
    $("welcome-greeting").textContent = "Welcome back, " + settings.userName;
    var bizline = $("welcome-bizline");
    bizline.textContent = settings.bizName || "";
    bizline.hidden = !settings.bizName;

    // money at a glance — report cash reality (same definitions in renderReports)
    // Outstanding = balance due on SENT invoices = total - deposit already taken.
    var outstanding = sumByCur(
      docs.filter(function (d) { return d.type === "invoice" && d.status === "sent"; }),
      balanceDueOf
    );
    // Collected = cash actually received: deposits on SENT invoices + full total
    // on PAID invoices. Receipts are excluded because a receipt is usually issued
    // alongside a paid invoice for the same money — counting both would double it.
    var collected = sumByCur(
      docs.filter(function (d) { return d.type === "invoice" && (d.status === "sent" || d.status === "paid"); }),
      function (d) { return d.status === "paid" ? (d.totalSnapshot || 0) : nonneg(d.amountPaid); }
    );
    $("wstat-outstanding").textContent = outstanding;
    $("wstat-collected").textContent = collected;
    $("wstat-count").textContent = docs.length;
    $("welcome-stats").hidden = docs.length === 0;
    var overdueCount = docs.filter(isOverdue).length;
    $("wstat-overdue").textContent = overdueCount;
    $("wstat-overdue-tile").hidden = overdueCount === 0;

    // continue-draft card
    var draftBtn = $("welcome-draft");
    if (hasDraftContent) {
      var t = calcTotals();
      $("welcome-draft-label").textContent = "Continue where you left off" + (draftTs ? " · " + relTime(draftTs) : "");
      $("welcome-draft-main").textContent = (doc.number || "Draft") + (doc.client.name ? " — " + doc.client.name : "");
      $("welcome-draft-sub").textContent = typeLabel(doc.type) + " · " + money(t.total, doc.currency);
      draftBtn.hidden = false;
    } else {
      draftBtn.hidden = true;
    }

    // recent documents with status + quick actions (Delete rebuilds this screen)
    var ul = $("welcome-recent");
    ul.textContent = "";
    docs.slice(0, 5).forEach(function (d) { ul.appendChild(buildDocRow(d, { onDelete: function () { showWelcome(true); } })); });
    $("welcome-recent-wrap").hidden = docs.length === 0;
    $("welcome-reports-btn").hidden = docs.length === 0;
    renderWelcomeClientNew();
    renderTemplatePick();

    $("welcome").hidden = false;
  }
  function hideWelcome() {
    $("welcome").hidden = true;
    welcomeShowView("home");
    window.scrollTo(0, 0); // land at the top of the editor, not wherever the page was scrolled
  }

  // ----- welcome: switch between the home page and the all-documents page -----
  function welcomeShowView(name) {
    $("welcome-home").hidden = name !== "home";
    $("welcome-all").hidden = name !== "all";
    $("welcome-reports").hidden = name !== "reports";
    $("welcome").scrollTop = 0;
    var card = document.querySelector(".welcome-card");
    if (card) { card.style.animation = "none"; void card.offsetWidth; card.style.animation = ""; }
  }

  var waFilter = "all";   // status filter (free)
  var waType = "all";     // type filter (Pro)
  var waSort = "date";    // sort key (Pro)
  var waSelected = {};    // id -> true, bulk selection (Pro); always a subset of the current view
  var waShownIds = [];    // ids currently rendered, in view order (for select-all)

  // Sort a copy of the docs (never mutates the source array). Pro-only.
  function sortDocs(arr, key) {
    var out = arr.slice();
    out.sort(function (x, y) {
      switch (key) {
        case "number": return (x.number || "").localeCompare(y.number || "", undefined, { numeric: true });
        case "total":  return (y.totalSnapshot || 0) - (x.totalSnapshot || 0); // high → low
        case "client": return (x.client.name || "").localeCompare(y.client.name || "");
        default:       return (y.date || "").localeCompare(x.date || ""); // newest first
      }
    });
    return out;
  }

  // Lock/unlock the Pro controls row to match entitlement. When locked the
  // children are inert (CSS pointer-events) and out of the tab order; the row
  // itself becomes a single focusable target that opens the upsell.
  function lockProBox(box, label) {
    if (!box) return;
    var pro = isPro();
    box.classList.toggle("is-locked", !pro);
    box.querySelectorAll("button, select, input").forEach(function (el) {
      el.tabIndex = pro ? 0 : -1;
    });
    if (pro) {
      box.removeAttribute("role"); box.removeAttribute("tabindex"); box.removeAttribute("aria-label");
    } else {
      box.setAttribute("role", "button"); box.setAttribute("tabindex", "0");
      box.setAttribute("aria-label", label);
    }
  }
  function syncProControls() {
    lockProBox($("wa-pro-controls"), "Search notes, filter and sort — Pro feature");
    lockProBox($("wa-bulk"), "Select multiple documents for bulk actions — Pro feature");
  }

  // Pure view over docs — never mutates. Free users get today's exact behaviour
  // (search number/client + status). Pro adds notes-search, type + date filters,
  // and sort; those inputs are ignored while Free so nothing leaks through.
  function renderWelcomeAll() {
    syncProControls();
    var pro = isPro();
    var q = $("wa-search").value.trim().toLowerCase();
    var from = pro ? $("wa-date-from").value : "";
    var to = pro ? $("wa-date-to").value : "";
    var list = $("welcome-all-list");
    list.textContent = "";
    var shown = docs.filter(function (d) {
      if (waFilter !== "all" && d.status !== waFilter) return false;          // status (free)
      if (pro && waType !== "all" && d.type !== waType) return false;          // type (Pro)
      if (pro && from && (d.date || "") < from) return false;                 // date range (Pro)
      if (pro && to && (d.date || "") > to) return false;
      if (!q) return true;
      var hit = (d.number || "").toLowerCase().indexOf(q) > -1 ||
                (d.client.name || "").toLowerCase().indexOf(q) > -1;
      if (!hit && pro) hit = (d.notes || "").toLowerCase().indexOf(q) > -1;    // notes (Pro)
      return hit;
    });
    if (pro) shown = sortDocs(shown, waSort);
    // Keep the bulk selection a strict subset of what's on screen, so "select all"
    // and every bulk action only ever touch the currently-filtered view.
    var shownSet = {};
    shown.forEach(function (d) { shownSet[d.id] = true; });
    Object.keys(waSelected).forEach(function (id) { if (!shownSet[id]) delete waSelected[id]; });
    waShownIds = shown.map(function (d) { return d.id; });
    $("wa-empty").hidden = shown.length > 0;
    shown.forEach(function (d) {
      list.appendChild(buildDocRow(d, { showDate: true, selectable: pro, onDelete: renderWelcomeAll }));
    });
    updateBulkUI();
  }

  // ----- welcome: read-only reports dashboard -----
  // Sum a numeric field across docs, grouped by currency so mixed-currency
  // books don't silently add euros to dollars. Returns a joined string.
  function sumByCur(list, fn) {
    var by = {};
    list.forEach(function (d) { by[d.currency] = (by[d.currency] || 0) + fn(d); });
    var parts = Object.keys(by)
      .filter(function (c) { return Math.abs(by[c]) > 0.005; })
      .map(function (c) { return money(by[c], c); });
    return parts.length ? parts.join(" + ") : money(0, settings.currency);
  }
  function repCell(text) { var td = document.createElement("td"); td.textContent = text; return td; }
  function monthLabel(m) {
    var p = m.split("-");
    var d = new Date(+p[0], +p[1] - 1, 1);
    return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
  function renderReports() {
    var invoices = docs.filter(function (d) { return d.type === "invoice"; });
    var outstanding = docs.filter(function (d) { return d.type === "invoice" && d.status === "sent"; });
    var overdue = docs.filter(isOverdue);
    // paid INVOICES only — receipts for the same money would double-count
    // (same rule as the welcome-screen "Collected" stat)
    var paidDocs = docs.filter(function (d) { return d.type === "invoice" && d.status === "paid"; });

    // Cash reality (same definitions as showWelcome):
    // Outstanding/Overdue = balance due (total - deposit); Collected = deposits on
    // SENT invoices + full total on PAID invoices.
    var collectedInvoices = docs.filter(function (d) { return d.type === "invoice" && (d.status === "sent" || d.status === "paid"); });
    $("rep-outstanding").textContent = sumByCur(outstanding, balanceDueOf);
    $("rep-overdue").textContent = sumByCur(overdue, balanceDueOf);
    $("rep-collected").textContent = sumByCur(collectedInvoices, function (d) { return d.status === "paid" ? (d.totalSnapshot || 0) : nonneg(d.amountPaid); });

    var ol = $("rep-overdue-list");
    ol.textContent = "";
    if (!overdue.length) {
      var li0 = document.createElement("li");
      li0.className = "rep-empty-row";
      li0.textContent = "Nothing overdue.";
      ol.appendChild(li0);
    } else {
      overdue.slice().sort(function (a, b) { return (a.due || "").localeCompare(b.due || ""); }).forEach(function (d) {
        var li = document.createElement("li");
        var b = document.createElement("button");
        b.type = "button"; b.className = "rep-od-row";
        b.addEventListener("click", function () { loadDoc(d.id); hideWelcome(); });
        var n = document.createElement("span"); n.className = "wr-num"; n.textContent = d.number;
        var c = document.createElement("span"); c.className = "wr-client";
        c.textContent = (d.client.name || "No client") + " · due " + fmtDate(d.due);
        var t = document.createElement("span"); t.className = "wr-total";
        t.textContent = money(d.totalSnapshot || 0, d.currency);
        b.append(n, c, t);
        li.appendChild(b);
        ol.appendChild(li);
      });
    }

    var months = [];
    docs.forEach(function (d) {
      var m = (d.date || "").slice(0, 7);
      if (m && months.indexOf(m) < 0) months.push(m);
    });
    months.sort().reverse();
    months = months.slice(0, 6);
    var tb = $("rep-month-body");
    tb.textContent = "";
    $("rep-month-wrap").hidden = months.length === 0;
    months.forEach(function (m) {
      var inMonth = function (d) { return (d.date || "").slice(0, 7) === m; };
      var monInv = invoices.filter(inMonth);
      var monPaid = paidDocs.filter(inMonth);
      var tr = document.createElement("tr");
      tr.append(
        repCell(monthLabel(m)),
        repCell(sumByCur(monInv, function (d) { return d.totalSnapshot || 0; })),
        repCell(sumByCur(monInv, function (d) { return calcTotals(d).vatTotal; })),
        repCell(sumByCur(monPaid, function (d) { return d.totalSnapshot || 0; }))
      );
      tb.appendChild(tr);
    });
  }
  $("welcome-reports-btn").addEventListener("click", function () { renderReports(); welcomeShowView("reports"); });
  $("welcome-reports-back").addEventListener("click", function () { showWelcome(); welcomeShowView("home"); });
  $("welcome-client-new").addEventListener("change", function () {
    var name = this.value;
    this.value = "";
    if (name) newFromClient(name);
  });

  // Templates (B3): save from the editor foot, start from the home picker. Gated.
  $("btn-save-template").addEventListener("click", guardPro(UPSELL_TEMPLATE, saveAsTemplate));
  $("welcome-template-new").addEventListener("change", function () {
    if (!isPro()) return; // locked select can't normally fire, but guard anyway
    var id = this.value;
    this.value = "";
    if (id) newFromTemplate(id);
  });
  $("welcome-template-wrap").addEventListener("click", function (e) {
    if (isPro()) return;
    e.preventDefault();
    openUpsell(UPSELL_TEMPLATE);
  });
  $("welcome-template-wrap").addEventListener("keydown", function (e) {
    if (isPro()) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openUpsell(UPSELL_TEMPLATE); }
  });

  // first-visit: save the user's name, then re-render the home screen as a returning user
  $("welcome-name-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var v = $("welcome-name-input").value.trim();
    if (!v) { $("welcome-name-input").focus(); return; }
    settings.userName = v;
    save(LS.settings, settings);
    showWelcome(true);
  });

  // Reset every filter (free + Pro) to its default so "View all" always opens clean.
  function resetWaControls() {
    waFilter = "all"; waType = "all"; waSort = "date";
    waSelected = {};
    $("wa-search").value = "";
    $("wa-date-from").value = ""; $("wa-date-to").value = "";
    $("wa-sort").value = "date";
    document.querySelectorAll("#wa-filters button").forEach(function (b) {
      b.classList.toggle("is-on", b.dataset.waFilter === "all");
    });
    document.querySelectorAll("#wa-type-filters button").forEach(function (b) {
      b.classList.toggle("is-on", b.dataset.waType === "all");
    });
  }
  $("welcome-viewall").addEventListener("click", function () {
    resetWaControls();
    renderWelcomeAll();
    welcomeShowView("all");
  });
  $("welcome-all-back").addEventListener("click", function () { showWelcome(); welcomeShowView("home"); });
  $("wa-search").addEventListener("input", renderWelcomeAll);
  document.querySelectorAll("#wa-filters button").forEach(function (b) {
    b.addEventListener("click", function () {
      waFilter = b.dataset.waFilter;
      document.querySelectorAll("#wa-filters button").forEach(function (x) {
        x.classList.toggle("is-on", x === b);
      });
      renderWelcomeAll();
    });
  });

  // ----- Pro controls (B1): type + date filters, sort. Inert until unlocked. -----
  var UPSELL_LIBRARY = "Search your notes, filter by type or date, and sort your whole library — a Pro feature.";
  document.querySelectorAll("#wa-type-filters button").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!isPro()) return; // locked: the row handler shows the upsell instead
      waType = b.dataset.waType;
      document.querySelectorAll("#wa-type-filters button").forEach(function (x) {
        x.classList.toggle("is-on", x === b);
      });
      renderWelcomeAll();
    });
  });
  $("wa-date-from").addEventListener("change", function () { if (isPro()) renderWelcomeAll(); });
  $("wa-date-to").addEventListener("change", function () { if (isPro()) renderWelcomeAll(); });
  $("wa-sort").addEventListener("change", function () {
    if (!isPro()) return;
    waSort = this.value;
    renderWelcomeAll();
  });
  // While locked, a click or Enter anywhere in the row opens the single upsell.
  $("wa-pro-controls").addEventListener("click", function (e) {
    if (isPro()) return;
    e.preventDefault();
    openUpsell(UPSELL_LIBRARY);
  });
  $("wa-pro-controls").addEventListener("keydown", function (e) {
    if (isPro()) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openUpsell(UPSELL_LIBRARY); }
  });

  // ----- Bulk actions (B2): multi-select PDF / CSV / status / delete. Pro-only. -----
  var UPSELL_BULK = "Select several documents and export, print or update them together — a Pro feature.";
  function selectedIds() {
    // Preserve the on-screen order so bulk PDF paginates the way the list reads.
    return waShownIds.filter(function (id) { return waSelected[id]; });
  }
  function updateBulkUI() {
    var count = selectedIds().length;
    var sc = $("wa-selcount");
    if (sc) { sc.hidden = count === 0; sc.textContent = count + " selected"; }
    var actions = $("wa-bulk-actions");
    if (actions) actions.hidden = count === 0;
    var all = $("wa-select-all");
    if (all) {
      all.checked = count > 0 && count === waShownIds.length;
      all.indeterminate = count > 0 && count < waShownIds.length;
    }
  }
  // Accent/ink for a doc's theme, mirroring applyTheme() but returned as values so
  // each cloned bulk sheet can carry its own colours (a shared :root var can't).
  function themeVars(d) {
    if (d.theme === "custom" && d.customAccent) return { accent: d.customAccent, ink: darken(d.customAccent, 0.22) };
    var t = THEMES[d.theme] || THEMES.forest;
    return { accent: t.accent, ink: t.ink };
  }
  // Render each selected doc into its own .sheet clone in #bulk-print, then print
  // the lot as one job — one A4 per doc via CSS break-before. Reuses render() and the
  // existing one-page print rules; no PDF library. Never mutates docs.
  function bulkPrintDocs(ids) {
    if (!ids.length) return;
    var stage = $("bulk-print");
    stage.textContent = "";
    var restore = doc; // preserve the live editor document
    ids.forEach(function (id) {
      var d = docs.find(function (x) { return x.id === id; });
      if (!d) return;
      doc = JSON.parse(JSON.stringify(d)); // render() reads the global `doc`
      render();
      var clone = $("sheet").cloneNode(true);
      clone.removeAttribute("id");
      clone.querySelectorAll("[id]").forEach(function (el) { el.removeAttribute("id"); }); // no duplicate ids
      var v = themeVars(doc);
      clone.style.setProperty("--accent", v.accent);
      clone.style.setProperty("--accent-ink", v.ink);
      stage.appendChild(clone);
    });
    doc = restore; render(); // put the editor's own sheet back
    document.body.classList.add("bulk-printing");
    printPDF();
  }
  function afterBulkPrint() {
    document.body.classList.remove("bulk-printing");
    var stage = $("bulk-print");
    if (stage) stage.textContent = "";
  }
  window.addEventListener("afterprint", afterBulkPrint);

  function bulkCSV(ids) {
    if (!ids.length) return;
    var pick = {};
    ids.forEach(function (id) { pick[id] = true; });
    var sel = docs.filter(function (d) { return pick[d.id]; }); // store order, stable
    downloadCSV(sel, "tidyinvoice-selected-" + todayISO(0) + ".csv");
  }
  // One atomic write for the whole batch — no partial saves if something's off.
  function bulkStatus(status, ids) {
    if (!status || !ids.length) return;
    if (isDemo) { toast("Demo mode — changes aren't saved"); return; }
    var pick = {};
    ids.forEach(function (id) { pick[id] = true; });
    var n = 0;
    docs.forEach(function (d) {
      if (pick[d.id]) { d.status = status; n++; if (savedId === d.id) doc.status = status; }
    });
    save(LS.docs, docs);
    renderHistory();
    renderWelcomeAll();
    toast(n + " marked " + status);
  }
  function bulkDelete(ids) {
    if (!ids.length) return;
    if (isDemo) { toast("Demo mode — changes aren't saved"); return; }
    if (!confirm("Delete " + ids.length + " document" + (ids.length > 1 ? "s" : "") + "? This can't be undone.")) return;
    var pick = {};
    ids.forEach(function (id) { pick[id] = true; });
    docs = docs.filter(function (d) { return !pick[d.id]; }); // rebuild once, then a single save
    if (savedId && pick[savedId]) savedId = null;
    save(LS.docs, docs);
    waSelected = {};
    renderHistory();
    renderWelcomeAll();
    toast(ids.length + " deleted");
  }

  $("wa-select-all").addEventListener("change", function () {
    if (!isPro()) return;
    if (this.checked) waShownIds.forEach(function (id) { waSelected[id] = true; });
    else waSelected = {};
    renderWelcomeAll(); // rebuild rows with the new checked state
  });
  $("wa-bulk-pdf").addEventListener("click", function () { if (isPro()) bulkPrintDocs(selectedIds()); });
  $("wa-bulk-csv").addEventListener("click", function () { if (isPro()) bulkCSV(selectedIds()); });
  $("wa-bulk-status").addEventListener("change", function () {
    if (!isPro()) return;
    var v = this.value; this.value = "";
    if (v) bulkStatus(v, selectedIds());
  });
  $("wa-bulk-delete").addEventListener("click", function () { if (isPro()) bulkDelete(selectedIds()); });
  // While locked (Free), a click or Enter anywhere in the bulk row opens the upsell.
  $("wa-bulk").addEventListener("click", function (e) {
    if (isPro()) return;
    e.preventDefault();
    openUpsell(UPSELL_BULK);
  });
  $("wa-bulk").addEventListener("keydown", function (e) {
    if (isPro()) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openUpsell(UPSELL_BULK); }
  });

  $("welcome-draft").addEventListener("click", hideWelcome);
  // click the dimmed area outside the card to dismiss (Escape also works)
  $("welcome").addEventListener("click", function (e) { if (e.target === this) hideWelcome(); });

  // Back to home from the editor: capture current work into the draft first
  // so the "continue where you left off" card is up to date, then open home.
  function goHome() {
    if (isDemo || sharedView) return;
    readEditor();
    draftTs = Date.now();
    persistDraft();
    welcomeShowView("home");
    showWelcome(true);
  }
  $("btn-home").addEventListener("click", goHome);
  $("btn-home-text").addEventListener("click", goHome);
  document.querySelectorAll("[data-welcome-new]").forEach(function (b) {
    b.addEventListener("click", function () {
      readEditor();
      if (hasContent(doc)) {
        var keptNumber = doc.number;
        saveDocument();
        toast(keptNumber + " kept as a draft — it's under Saved");
      }
      doc = newDoc(b.dataset.welcomeNew);
      savedId = null;
      fillEditor();
      render();
      persistDraft();
      hideWelcome();
    });
  });

  // mobile edit/preview tabs
  document.querySelectorAll(".mobile-tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".mobile-tabs button").forEach(function (x) {
        var on = x === b;
        x.classList.toggle("is-on", on);
        x.setAttribute("aria-selected", on ? "true" : "false");
      });
      document.body.dataset.mview = b.dataset.mtab;
      if (b.dataset.mtab === "preview") scalePreview();
    });
  });

  window.addEventListener("hashchange", function () {
    // opening a share link while the app is already loaded — boot again
    if (location.hash.indexOf("#d=") === 0) location.reload();
  });
  window.addEventListener("resize", debounce(scalePreview, 100));
  window.addEventListener("beforeprint", function () { readEditor(); render(); });

  // ---------- boot ----------
  var draft = isDemo ? null : load(LS.draft, null);
  var sharedPayload = null;
  if (!isDemo && location.hash.indexOf("#d=") === 0) {
    try {
      var sp = JSON.parse(b64urlDecode(location.hash.slice(3)));
      if (sp && sp.doc && Array.isArray(sp.doc.items)) sharedPayload = sp;
    } catch (e) { /* malformed link — fall through to normal boot */ }
  }
  if (sharedPayload) {
    doc = sharedPayload.doc;
    doc.id = null;
    doc._sharedBiz = sharedPayload.biz || null;
    savedId = null;
    sharedView = true;
    $("shared-banner").hidden = false;
    $("shared-from").textContent = sharedPayload.biz && sharedPayload.biz.bizName ? "from " + sharedPayload.biz.bizName : "";
  } else if (isDemo) {
    doc = newDoc("invoice");
    settings.bizName = "Aoife Byrne Design";
    settings.bizAddress = "12 Main Street, Tullamore, Co. Offaly\nhello@aoifebyrne.ie\n+353 87 123 4567";
    settings.bizVat = "IE1234567A";
    doc.client = { name: "Murphy's Hardware Ltd", vat: "IE7654321B", address: "Unit 4, Business Park, Tullamore\naccounts@murphys.ie" };
    doc.items = [
      { desc: "Website design — 5 page business site", qty: 1, price: 700, vat: 23 },
      { desc: "12 months hosting & domain", qty: 1, price: 120, vat: 23 },
      { desc: "Logo refresh", qty: 1, price: 150, vat: 23 }
    ];
    doc.payment = "Bank: AIB\nIBAN: IE00 AIBK 0000 0000 0000 00\nBIC: AIBKIE2D";
    doc.notes = "Payment due within 14 days. Thank you for your business!";
    var mLayout = location.search.match(/[?&]layout=(\w+)/);
    if (mLayout) doc.layout = mLayout[1];
    var mLang = location.search.match(/[?&]lang=(\w+)/);
    if (mLang && LANGS[mLang[1]]) doc.lang = mLang[1];
  } else if (draft && draft.doc && draft.doc.items) {
    doc = draft.doc;
    savedId = draft.savedId || null;
    draftTs = draft.ts || null;
  } else {
    doc = newDoc("invoice");
  }
  // forward-compat: fill any missing fields from a fresh doc (drafts, shares, old backups)
  var fresh = newDoc(doc.type || "invoice");
  Object.keys(fresh).forEach(function (k) {
    if (doc[k] === undefined) doc[k] = fresh[k];
  });
  document.body.dataset.mview = sharedView ? "preview" : "edit";
  if (sharedView) {
    document.querySelectorAll(".mobile-tabs button").forEach(function (x) {
      var on = x.dataset.mtab === "preview";
      x.classList.toggle("is-on", on);
      x.setAttribute("aria-selected", on ? "true" : "false");
    });
  }
  applyUITheme();
  enhanceSteppers();
  initEntitlement(); // offline Pro-licence check; stamps <body data-pro>, fails safe to free
  $("foot-year").textContent = new Date().getFullYear();
  if (isDemo) {
    var note = $("autosave-note");
    note.textContent = "Demo data — nothing saves in demo mode";
    note.style.color = "var(--danger)";
  }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch(function () { /* offline support is optional */ });
    // when an updated service worker takes over, reload once so new code actually runs
    var swReloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (swReloaded) return;
      swReloaded = true;
      location.reload();
    });
  }
  fillEditor();
  render();
  renderHistory();
  scalePreview();
  showWelcome();

  // fade out the loading splash after a short beat so the animation is seen
  (function () {
    var splash = $("splash");
    if (!splash) return;
    var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(function () {
      splash.classList.add("is-hiding");
      setTimeout(function () { splash.hidden = true; }, 500);
    }, reduce ? 200 : 1100);
  })();
})();
