/* TidyInvoice — all data stays in localStorage. No network calls. */
(function () {
  "use strict";

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
    invoice: { title: "INVOICE", numLabel: "Invoice no.", prefix: "INV", dueLabel: "Due", totalLabel: "Total due", numberFieldLabel: "Invoice number", showDue: true },
    quote:   { title: "QUOTE",   numLabel: "Quote no.",   prefix: "QUO", dueLabel: "Valid until", totalLabel: "Total", numberFieldLabel: "Quote number", showDue: true },
    receipt: { title: "RECEIPT", numLabel: "Receipt no.", prefix: "REC", dueLabel: "Due", totalLabel: "Total paid", numberFieldLabel: "Receipt number", showDue: false }
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
  function fmtDate(iso) {
    if (!iso) return "";
    var parts = iso.split("-");
    if (parts.length !== 3) return iso;
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
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
      payment: settings.payment || "",
      notes: settings.notes || "",
      status: "draft"
    };
  }
  function blankItem() {
    return { desc: "", qty: 1, price: "", vat: num(settings.defaultVat) };
  }
  function autoNumber(type) {
    var meta = TYPE_META[type];
    return meta.prefix + "-" + pad(settings.counters[type] || 1);
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
    $("f-default-vat").value = settings.defaultVat;
    $("f-payment").value = doc.payment;
    $("f-notes").value = doc.notes;
    renderItemRows();
    syncTypeUI();
    syncThemeUI();
    syncLogoUI();
    renderClientDatalist();
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
    settings.defaultVat = num($("f-default-vat").value);
    doc.payment = $("f-payment").value;
    doc.notes = $("f-notes").value;
    settings.payment = doc.payment;
    settings.notes = doc.notes;
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
  }

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
    return { subtotal: subtotal, discountAmt: discountAmt, vatByRate: vatByRate, total: total };
  }

  // ---------- preview render ----------
  function render() {
    var meta = TYPE_META[doc.type];
    var cur = doc.currency;

    $("s-doctitle").textContent = meta.title;
    $("s-numlabel").textContent = meta.numLabel;
    $("s-number").textContent = doc.number || "—";
    $("s-date").textContent = fmtDate(doc.date);
    $("s-due-row").hidden = !meta.showDue || !doc.due;
    $("s-duelabel").textContent = meta.dueLabel;
    $("s-due").textContent = fmtDate(doc.due);
    $("s-ref-row").hidden = !doc.reference;
    $("s-reference").textContent = doc.reference;

    $("s-bizname").textContent = settings.bizName || "Your Business";
    $("s-bizaddress").textContent = settings.bizAddress;
    $("s-bizvat").textContent = settings.bizVat ? "VAT: " + settings.bizVat : "";

    var logo = $("s-logo");
    if (settings.logo) { logo.src = settings.logo; logo.hidden = false; }
    else { logo.hidden = true; logo.removeAttribute("src"); }

    $("s-billto-label").textContent = doc.type === "quote" ? "Prepared for" : "Billed to";
    $("s-clientname").textContent = doc.client.name || "Client name";
    $("s-clientaddress").textContent = doc.client.address;
    $("s-clientvat").textContent = doc.client.vat ? "VAT: " + doc.client.vat : "";

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
    $("s-subtotal").textContent = money(t.subtotal, cur);
    $("s-discount-row").hidden = t.discountAmt <= 0;
    if (t.discountAmt > 0) {
      $("s-discount-label").textContent = doc.discountType === "percent"
        ? "Discount (" + doc.discount + "%)"
        : "Discount";
      $("s-discount").textContent = "−" + money(t.discountAmt, cur);
    }
    var vatRows = $("s-vat-rows");
    vatRows.textContent = "";
    Object.keys(t.vatByRate).sort(function (a, b) { return a - b; }).forEach(function (rate) {
      var tr = document.createElement("tr");
      var th = document.createElement("th");
      th.textContent = "VAT (" + rate + "%)";
      var td = document.createElement("td");
      td.textContent = money(t.vatByRate[rate], cur);
      tr.append(th, td);
      vatRows.appendChild(tr);
    });
    $("s-total-label").textContent = meta.totalLabel;
    $("s-total").textContent = money(t.total, cur);

    // payment / notes blocks
    $("s-payment-block").hidden = !(doc.payment.trim() && doc.type !== "quote");
    $("s-payment").textContent = doc.payment;
    $("s-notes-block").hidden = !doc.notes.trim();
    $("s-notes").textContent = doc.notes;

    $("s-foot-thanks").textContent = doc.type === "quote"
      ? "This quote is valid until the date shown above."
      : "Thank you for your business.";

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
    document.querySelectorAll(".doc-type-switch button").forEach(function (b) {
      var on = b.dataset.doctype === doc.type;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("lbl-number").textContent = meta.numberFieldLabel;
    $("lbl-due").textContent = meta.dueLabel === "Due" ? "Due date" : meta.dueLabel;
    $("wrap-due").style.display = meta.showDue ? "" : "none";
    $("btn-convert").hidden = doc.type !== "quote";
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
      existing.vat = doc.client.vat;
      existing.address = doc.client.address;
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
    save(LS.draft, { doc: doc, savedId: savedId });
    save(LS.settings, settings);
  }, 400);

  function saveDocument() {
    readEditor();
    if (!doc.number) { doc.number = autoNumber(doc.type); $("f-number").value = doc.number; }

    if (!doc.id) doc.id = uid();
    doc.savedAt = Date.now();
    var totals = calcTotals();
    doc.totalSnapshot = totals.total;

    var idx = docs.findIndex(function (d) { return d.id === doc.id; });
    if (idx >= 0) docs[idx] = JSON.parse(JSON.stringify(doc));
    else docs.unshift(JSON.parse(JSON.stringify(doc)));
    savedId = doc.id;

    // bump counter when the auto number for this type was used
    if (doc.number === autoNumber(doc.type)) {
      settings.counters[doc.type] = (settings.counters[doc.type] || 1) + 1;
    }

    upsertClient();
    save(LS.docs, docs);
    save(LS.settings, settings);
    persistDraft();
    renderHistory();
    flashSaved();
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
      var status = document.createElement("span");
      status.className = "hi-status " + d.status;
      status.textContent = d.status;
      numEl.appendChild(status);
      var totalEl = document.createElement("span");
      totalEl.className = "hi-total";
      totalEl.textContent = money(d.totalSnapshot || 0, d.currency);
      top.append(numEl, totalEl);

      var client = document.createElement("div");
      client.className = "hi-client";
      client.textContent = (d.client.name || "No client") + " · " + fmtDate(d.date);

      var actions = document.createElement("div");
      actions.className = "hi-actions";
      actions.append(
        miniBtn("Open", function () { loadDoc(d.id); }),
        miniBtn("Duplicate", function () { duplicateDoc(d.id); }),
        miniBtn(nextStatusLabel(d.status), function () { cycleStatus(d.id); }),
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
  function nextStatusLabel(s) {
    return s === "draft" ? "Mark sent" : s === "sent" ? "Mark paid" : "Mark draft";
  }
  function cycleStatus(id) {
    var d = docs.find(function (x) { return x.id === id; });
    if (!d) return;
    d.status = d.status === "draft" ? "sent" : d.status === "sent" ? "paid" : "draft";
    save(LS.docs, docs);
    if (savedId === id) { doc.status = d.status; render(); persistDraft(); }
    renderHistory();
  }
  function loadDoc(id) {
    var d = docs.find(function (x) { return x.id === id; });
    if (!d) return;
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
      if (doc.items[idx] && field) {
        doc.items[idx][field] = field === "desc" ? t.value : t.value;
      }
    }
    readEditor();
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
      var autoPattern = new RegExp("^" + TYPE_META[oldType].prefix + "-\\d+$");
      doc.type = newType;
      if (!doc.number || autoPattern.test(doc.number)) {
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

  $("btn-new").addEventListener("click", function () {
    readEditor();
    doc = newDoc(doc.type);
    savedId = null;
    fillEditor();
    render();
    persistDraft();
  });

  $("btn-save").addEventListener("click", saveDocument);
  $("btn-history").addEventListener("click", openHistory);
  $("btn-close-history").addEventListener("click", closeHistory);
  $("drawer-backdrop").addEventListener("click", closeHistory);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeHistory();
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveDocument(); }
    if ((e.ctrlKey || e.metaKey) && e.key === "p") { e.preventDefault(); printPDF(); }
  });

  function printPDF() {
    readEditor();
    render();
    var oldTitle = document.title;
    document.title = (doc.number || "document") + (doc.client.name ? " — " + doc.client.name : "");
    window.print();
    document.title = oldTitle;
  }
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

  window.addEventListener("resize", debounce(scalePreview, 100));
  window.addEventListener("beforeprint", function () { readEditor(); render(); });

  // ---------- boot ----------
  var isDemo = /[?&]demo\b/.test(location.search);
  var draft = isDemo ? null : load(LS.draft, null);
  if (isDemo) {
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
  } else if (draft && draft.doc && draft.doc.items) {
    doc = draft.doc;
    savedId = draft.savedId || null;
    // forward-compat: fill any missing fields from a fresh doc
    var fresh = newDoc(doc.type);
    Object.keys(fresh).forEach(function (k) {
      if (doc[k] === undefined) doc[k] = fresh[k];
    });
  } else {
    doc = newDoc("invoice");
  }
  document.body.dataset.mview = "edit";
  $("foot-year").textContent = new Date().getFullYear();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("sw.js").catch(function () { /* offline support is optional */ });
  }
  fillEditor();
  render();
  renderHistory();
  scalePreview();
})();
