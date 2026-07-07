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
    draft: "tidyinvoice_draft"
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
  function save(key, val) {
    if (isDemo) return; // demo mode never touches real data
    try { localStorage.setItem(key, JSON.stringify(val)); }
    catch (e) { /* quota exceeded (usually huge logo) — warn once */ warnQuota(); }
  }
  var quotaWarned = false;
  function warnQuota() {
    if (quotaWarned) return;
    quotaWarned = true;
    alert("Couldn't save — browser storage is full. Try a smaller logo image.");
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

  // ---------- state ----------
  var settings = load(LS.settings, {
    bizName: "", bizVat: "", bizAddress: "", logo: "",
    counters: { invoice: 1, quote: 1, receipt: 1 },
    defaultVat: 23, currency: "EUR", theme: "forest",
    payment: "", notes: ""
  });
  var docs = load(LS.docs, []);
  var clients = load(LS.clients, []);
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
      client: { name: "", vat: "", address: "" },
      items: [blankItem()],
      discount: 0,
      discountType: "percent",
      amountPaid: 0,
      layout: settings.layout || "classic",
      lang: settings.lang || "en",
      payment: settings.payment || "", // bank details persist — same on every invoice
      notes: "",                        // per-document message — always starts blank
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
    settings.payment = doc.payment; // bank details are business-wide; notes stay per-document
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
  function calcTotals() {
    var subtotal = 0;
    doc.items.forEach(function (it) { subtotal += num(it.qty) * num(it.price); });

    var discountAmt = 0;
    if (doc.discount > 0) {
      discountAmt = doc.discountType === "percent"
        ? subtotal * Math.min(doc.discount, 100) / 100
        : Math.min(doc.discount, subtotal);
    }
    var factor = subtotal > 0 ? (subtotal - discountAmt) / subtotal : 0;

    var vatByRate = {};
    doc.items.forEach(function (it) {
      var net = num(it.qty) * num(it.price) * factor;
      var rate = num(it.vat);
      if (rate > 0 && net > 0) {
        vatByRate[rate] = (vatByRate[rate] || 0) + net * rate / 100;
      }
    });

    var vatTotal = 0;
    Object.keys(vatByRate).forEach(function (r) { vatTotal += vatByRate[r]; });
    var total = subtotal - discountAmt + vatTotal;
    var paid = doc.type === "invoice" ? Math.min(num(doc.amountPaid), total) : 0;
    return { subtotal: subtotal, discountAmt: discountAmt, vatByRate: vatByRate, total: total, paid: paid, balance: total - paid };
  }

  // ---------- preview render ----------
  function render() {
    var meta = TYPE_META[doc.type];
    var L = LANGS[doc.lang] || LANGS.en;
    var cur = doc.currency;
    var biz = doc._sharedBiz || settings;

    $("sheet").dataset.layout = doc.layout || "classic";

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
      var amount = num(it.qty) * num(it.price);
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
  }
  function cell(cls, text) {
    var td = document.createElement("td");
    td.className = cls;
    td.textContent = text;
    return td;
  }

  function applyTheme(name) {
    var t = THEMES[name] || THEMES.forest;
    document.documentElement.style.setProperty("--accent", t.accent);
    document.documentElement.style.setProperty("--accent-ink", t.ink);
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
    document.querySelectorAll(".swatch").forEach(function (s) {
      s.classList.toggle("is-on", s.dataset.theme === doc.theme);
    });
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

  function toast(msg) {
    var t = $("toast");
    if (!t) {
      t = document.createElement("div");
      t.id = "toast";
      t.className = "no-print";
      t.setAttribute("role", "status");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove("show"); }, 2600);
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
    savedId = null;
    fillEditor();
    render();
    persistDraft();
    closeHistory();
  }
  function deleteDoc(id) {
    var d = docs.find(function (x) { return x.id === id; });
    if (!d) return;
    if (!confirm("Delete " + d.number + "? This can't be undone.")) return;
    docs = docs.filter(function (x) { return x.id !== id; });
    save(LS.docs, docs);
    if (savedId === id) savedId = null;
    renderHistory();
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

  $("btn-csv").addEventListener("click", function () {
    if (docs.length === 0) { alert("Nothing saved yet — save a document first."); return; }
    function esc(v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }
    var rows = [["Number", "Type", "Status", "Date", "Due", "Client", "Currency", "Total"].join(",")];
    docs.forEach(function (d) {
      rows.push([
        esc(d.number), esc(d.type), esc(d.status), esc(d.date), esc(d.due || ""),
        esc(d.client && d.client.name), esc(d.currency), (d.totalSnapshot || 0).toFixed(2)
      ].join(","));
    });
    var blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tidyinvoice-documents-" + todayISO(0) + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
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
    $("history-drawer").hidden = false;
    $("drawer-backdrop").hidden = false;
  }
  function closeHistory() {
    $("history-drawer").hidden = true;
    $("drawer-backdrop").hidden = true;
  }

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
      settings.logo = reader.result;
      save(LS.settings, settings);
      syncLogoUI();
      render();
    };
    reader.readAsDataURL(file);
  });

  $("btn-logo-remove").addEventListener("click", function () {
    settings.logo = "";
    save(LS.settings, settings);
    $("f-logo").value = "";
    syncLogoUI();
    render();
  });

  function hasContent(d) {
    return !!(d.client.name.trim() || d.items.some(function (it) {
      return (it.desc && String(it.desc).trim()) || num(it.price) > 0;
    }));
  }

  // Signature of the fields a user actually edits — used to detect unsaved changes.
  function docSignature(d) {
    return JSON.stringify({
      type: d.type, number: d.number, currency: d.currency, date: d.date, due: d.due,
      reference: d.reference, theme: d.theme, layout: d.layout, lang: d.lang,
      client: d.client, items: d.items, discount: d.discount, discountType: d.discountType,
      amountPaid: d.amountPaid, payment: d.payment, notes: d.notes, status: d.status
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

    function cleanup() {
      $("confirm-modal").hidden = true;
      $("confirm-backdrop").hidden = true;
      saveBtn.removeEventListener("click", onSaveClick);
      discardBtn.removeEventListener("click", onDiscardClick);
      cancelBtn.removeEventListener("click", cleanup);
      $("confirm-backdrop").removeEventListener("click", cleanup);
    }
    function onSaveClick() { cleanup(); onSave(); }
    function onDiscardClick() { cleanup(); onDiscard(); }

    var saveBtn = $("confirm-save");
    var discardBtn = $("confirm-discard");
    var cancelBtn = $("confirm-cancel");
    saveBtn.addEventListener("click", onSaveClick);
    discardBtn.addEventListener("click", onDiscardClick);
    cancelBtn.addEventListener("click", cleanup);
    $("confirm-backdrop").addEventListener("click", cleanup);
    confirmOpen = cleanup;
    saveBtn.focus();
  }
  var confirmOpen = null;
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
      if (confirmModalOpen()) { if (confirmOpen) confirmOpen(); return; } // cancel the dialog only
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
    if (url.length > 7500) { alert("This document is too large to share as a link — try shortening the notes."); return; }
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
  function sumByCurrency(list) {
    var by = {};
    list.forEach(function (d) { by[d.currency] = (by[d.currency] || 0) + (d.totalSnapshot || 0); });
    var parts = Object.keys(by).map(function (c) { return money(by[c], c); });
    return parts.length ? parts.join(" + ") : null;
  }
  function showWelcome(force) {
    if (isDemo || sharedView) return;
    var hasDraftContent = doc && hasContent(doc);
    // on plain load, first-time visitors skip straight to the editor;
    // an explicit Home click always opens the screen
    if (!force && !hasDraftContent && docs.length === 0) return;

    // greeting
    var h = new Date().getHours();
    $("welcome-greeting").textContent = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    var bizline = $("welcome-bizline");
    bizline.textContent = settings.bizName || "";
    bizline.hidden = !settings.bizName;

    // money at a glance
    var outstanding = sumByCurrency(docs.filter(function (d) { return d.type === "invoice" && d.status === "sent"; }));
    var collected = sumByCurrency(docs.filter(function (d) { return d.status === "paid"; }));
    $("wstat-outstanding").textContent = outstanding || money(0, settings.currency);
    $("wstat-collected").textContent = collected || money(0, settings.currency);
    $("wstat-count").textContent = docs.length;
    $("welcome-stats").hidden = docs.length === 0;

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

    // recent documents with status + quick actions
    var ul = $("welcome-recent");
    ul.textContent = "";
    docs.slice(0, 5).forEach(function (d) {
      var li = document.createElement("li");
      li.className = "welcome-recent-item";

      var open = document.createElement("button");
      open.type = "button";
      open.className = "wr-open";
      var num = document.createElement("span");
      num.className = "wr-num";
      num.textContent = d.number;
      var client = document.createElement("span");
      client.className = "wr-client";
      client.textContent = d.client.name || "No client";
      var pill = document.createElement("span");
      pill.className = "wr-pill " + d.status;
      pill.textContent = d.status;
      var total = document.createElement("span");
      total.className = "wr-total";
      total.textContent = money(d.totalSnapshot || 0, d.currency);
      open.append(num, client, pill, total);
      open.setAttribute("aria-label", "Open " + d.number);
      open.addEventListener("click", function () { loadDoc(d.id); hideWelcome(); });

      var dup = document.createElement("button");
      dup.type = "button";
      dup.className = "btn tiny ghost wr-act";
      dup.textContent = "Duplicate";
      dup.title = "New copy for the same client";
      dup.addEventListener("click", function () { duplicateDoc(d.id); hideWelcome(); });

      var pdf = document.createElement("button");
      pdf.type = "button";
      pdf.className = "btn tiny ghost wr-act";
      pdf.textContent = "PDF";
      pdf.title = "Open and download as PDF";
      pdf.addEventListener("click", function () { loadDoc(d.id); hideWelcome(); printPDF(); });

      li.append(open, dup, pdf);
      ul.appendChild(li);
    });
    $("welcome-recent-wrap").hidden = docs.length === 0;

    $("welcome").hidden = false;
  }
  function hideWelcome() { $("welcome").hidden = true; welcomeShowView("home"); }

  // ----- welcome: switch between the home page and the all-documents page -----
  function welcomeShowView(name) {
    $("welcome-home").hidden = name !== "home";
    $("welcome-all").hidden = name !== "all";
    $("welcome").scrollTop = 0;
    var card = document.querySelector(".welcome-card");
    if (card) { card.style.animation = "none"; void card.offsetWidth; card.style.animation = ""; }
  }

  var waFilter = "all";
  function renderWelcomeAll() {
    var q = $("wa-search").value.trim().toLowerCase();
    var list = $("welcome-all-list");
    list.textContent = "";
    var shown = docs.filter(function (d) {
      if (waFilter !== "all" && d.status !== waFilter) return false;
      if (!q) return true;
      return (d.number || "").toLowerCase().indexOf(q) > -1 ||
             (d.client.name || "").toLowerCase().indexOf(q) > -1;
    });
    $("wa-empty").hidden = shown.length > 0;

    shown.forEach(function (d) {
      var li = document.createElement("li");
      li.className = "welcome-recent-item";

      var open = document.createElement("button");
      open.type = "button";
      open.className = "wr-open";
      var num = document.createElement("span");
      num.className = "wr-num";
      num.textContent = d.number;
      var client = document.createElement("span");
      client.className = "wr-client";
      client.textContent = (d.client.name || "No client") + " · " + fmtDate(d.date);
      var pill = document.createElement("span");
      pill.className = "wr-pill " + d.status;
      pill.textContent = d.status;
      var total = document.createElement("span");
      total.className = "wr-total";
      total.textContent = money(d.totalSnapshot || 0, d.currency);
      open.append(num, client, pill, total);
      open.setAttribute("aria-label", "Open " + d.number);
      open.addEventListener("click", function () { loadDoc(d.id); hideWelcome(); });

      var dup = document.createElement("button");
      dup.type = "button";
      dup.className = "btn tiny ghost wr-act";
      dup.textContent = "Duplicate";
      dup.addEventListener("click", function () { duplicateDoc(d.id); hideWelcome(); });

      var pdf = document.createElement("button");
      pdf.type = "button";
      pdf.className = "btn tiny ghost wr-act";
      pdf.textContent = "PDF";
      pdf.addEventListener("click", function () { loadDoc(d.id); hideWelcome(); printPDF(); });

      var del = document.createElement("button");
      del.type = "button";
      del.className = "btn tiny ghost danger wr-act";
      del.textContent = "Delete";
      del.addEventListener("click", function () { deleteDoc(d.id); renderWelcomeAll(); });

      li.append(open, dup, pdf, del);
      list.appendChild(li);
    });
  }

  $("welcome-viewall").addEventListener("click", function () {
    waFilter = "all";
    $("wa-search").value = "";
    document.querySelectorAll("#wa-filters button").forEach(function (b) {
      b.classList.toggle("is-on", b.dataset.waFilter === "all");
    });
    renderWelcomeAll();
    welcomeShowView("all");
  });
  $("welcome-all-back").addEventListener("click", function () { showWelcome(); welcomeShowView("home"); });
  $("welcome-all-skip").addEventListener("click", hideWelcome);
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

  $("welcome-skip").addEventListener("click", hideWelcome);
  $("welcome-draft").addEventListener("click", hideWelcome);

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
})();
