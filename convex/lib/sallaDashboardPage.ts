// The HTML of the merchant's page inside Salla's admin (served by convex/sallaEmbedded.ts at /salla/app).
// Plain HTML + JS on purpose: it loads inside Salla's iframe, talks to the same origin only, and uses
// Salla's Embedded SDK for the title, the Save button, toasts and the loading overlay (no own chrome).
// The script avoids backticks and "${" so it can live in this template string.

const SDK_URL = "https://cdn.jsdelivr.net/npm/@salla.sa/embedded-sdk@0.2.6/dist/umd/index.js";

export function dashboardPage(): string {
  return `<!doctype html>
<html lang="ar" dir="rtl" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AdSpy COD Confirm</title>
<style>
:root { --color-primary:#004d5b; --color-secondary:#73fcd7; --color-success:#00b259; --color-danger:#f5434a;
  --color-bg:#f8f8f8; --color-surface:#fff; --color-border:#e5e7eb; --color-text:#1f2937; --color-muted:#6b7280; --color-on-primary:#fff; }
[data-theme="dark"] { --color-primary:#baefe3; --color-secondary:#baefe3; --color-bg:#1d1e20; --color-surface:#26282b;
  --color-border:#3a3d41; --color-text:#e5e7eb; --color-muted:#9ca3af; --color-on-primary:#1d1e20; }
* { box-sizing:border-box; }
body { margin:0; background:var(--color-bg); color:var(--color-text); font-family:"PingARLT","IBM Plex Sans Arabic",system-ui,sans-serif; font-size:14px; line-height:1.5; }
.app-page { padding:24px; }
.app-content { max-width:960px; margin:0 auto; display:grid; gap:24px; }
.card { background:var(--color-surface); border:1px solid var(--color-border); border-radius:8px; overflow:hidden; }
.card-header { padding:16px 24px; border-bottom:1px solid var(--color-border); display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; }
.card-title { margin:0; font-size:16px; font-weight:600; color:var(--color-primary); }
.card-body { padding:24px; }
.muted { color:var(--color-muted); font-size:13px; }
.stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:16px; }
.stat { border:1px solid var(--color-border); border-radius:8px; padding:16px; }
.stat .v { font-size:20px; font-weight:700; }
.stat .l { color:var(--color-muted); font-size:13px; }
.stat.hero { border-color:var(--color-success); }
.stat.hero .v { color:var(--color-success); }
.seg { display:inline-flex; border:1px solid var(--color-border); border-radius:6px; overflow:hidden; }
.seg button { border:0; background:transparent; color:var(--color-text); padding:4px 12px; font:inherit; font-size:13px; cursor:pointer; }
.seg button[aria-pressed="true"] { background:var(--color-primary); color:var(--color-on-primary); }
.row { display:flex; align-items:center; gap:16px; flex-wrap:wrap; padding-block:8px; }
.row label { font-weight:500; min-width:200px; }
input[type=number] { width:120px; padding:6px 8px; border:1px solid var(--color-border); border-radius:6px; background:var(--color-surface); color:var(--color-text); font:inherit; }
.switch { position:relative; width:44px; height:24px; border-radius:12px; border:0; background:var(--color-border); cursor:pointer; padding:0; }
.switch::after { content:""; position:absolute; top:3px; inset-inline-start:3px; width:18px; height:18px; border-radius:50%; background:#fff; transition:inset-inline-start .15s; }
.switch[aria-checked="true"] { background:var(--color-success); }
.switch[aria-checked="true"]::after { inset-inline-start:23px; }
button:focus-visible, input:focus-visible { outline:2px solid var(--color-primary); outline-offset:2px; }
.table-wrap { overflow-x:auto; }
table { width:100%; border-collapse:collapse; font-size:13px; }
th, td { text-align:start; padding:8px 12px; border-bottom:1px solid var(--color-border); white-space:nowrap; }
th { color:var(--color-muted); font-weight:500; }
.badge { display:inline-block; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; }
.b-confirmed { background:rgba(0,178,89,.12); color:var(--color-success); }
.b-cancelled { background:rgba(245,67,74,.12); color:var(--color-danger); }
.b-info { background:transparent; color:var(--color-primary); border:1px solid var(--color-primary); margin-inline-start:4px; }
.b-warn { background:rgba(245,67,74,.08); color:var(--color-danger); border:1px solid var(--color-danger); margin-inline-start:4px; }
.b-pending { background:var(--color-bg); color:var(--color-muted); border:1px solid var(--color-border); }
.err { color:var(--color-danger); font-size:11px; white-space:normal; }
.empty { text-align:center; color:var(--color-muted); padding:24px; }
.btn { border:1px solid var(--color-primary); background:var(--color-primary); color:var(--color-on-primary); border-radius:6px; padding:6px 14px; font:inherit; font-size:13px; cursor:pointer; text-decoration:none; display:inline-block; }
.btn.ghost { background:transparent; color:var(--color-primary); }
.feed { width:100%; max-width:560px; padding:6px 8px; border:1px solid var(--color-border); border-radius:6px; background:var(--color-bg); color:var(--color-text); font:inherit; font-size:12px; direction:ltr; }
.notice { border:1px solid var(--color-danger); color:var(--color-danger); border-radius:8px; padding:16px; display:none; }
</style>
</head>
<body>
<div class="app-page"><main class="app-content">
  <div class="notice" id="notice"></div>
  <section class="card">
    <div class="card-header">
      <h2 class="card-title" data-t="results"></h2>
      <div class="seg" id="range">
        <button type="button" data-days="7"></button><button type="button" data-days="30" aria-pressed="true"></button><button type="button" data-days="90"></button>
      </div>
    </div>
    <div class="card-body">
      <div class="stats" id="stats"></div>
      <p class="muted" data-t="savedNote"></p>
    </div>
  </section>
  <section class="card">
    <div class="card-header"><h2 class="card-title" data-t="settings"></h2></div>
    <div class="card-body">
      <div class="row"><label id="l-on" data-t="onLabel"></label><button type="button" class="switch" id="on" role="switch" aria-labelledby="l-on" aria-checked="true"></button><span class="muted" id="onHint"></span></div>
      <div class="row"><label id="l-block" data-t="blockLabel"></label><button type="button" class="switch" id="block" role="switch" aria-labelledby="l-block" aria-checked="false"></button><span class="muted" data-t="blockHint"></span></div>
      <div class="row"><label for="cost" data-t="costLabel"></label><input type="number" id="cost" min="0" max="1000" step="1"><span class="muted" data-t="costHint"></span></div>
      <p class="muted" data-t="flow"></p>
    </div>
  </section>
  <section class="card">
    <div class="card-header"><h2 class="card-title" data-t="sheets"></h2></div>
    <div class="card-body">
      <p class="muted" data-t="sheetsHint"></p>
      <div class="row" id="feedNone"><button type="button" class="btn" id="feedMake" data-t="feedMake"></button></div>
      <div id="feedSome" hidden>
        <div class="row"><input class="feed" id="feedFormula" readonly aria-labelledby="l-formula"><button type="button" class="btn" id="feedCopy" data-t="feedCopy"></button></div>
        <p class="muted" id="l-formula" data-t="feedSteps"></p>
        <div class="row"><a class="btn ghost" id="feedDownload" target="_blank" rel="noopener" data-t="feedDownload"></a><button type="button" class="btn ghost" id="feedRotate" data-t="feedRotate"></button><span class="muted" data-t="feedPrivate"></span></div>
      </div>
    </div>
  </section>
  <section class="card">
    <div class="card-header"><h2 class="card-title" data-t="recent"></h2></div>
    <div class="table-wrap"><table>
      <thead><tr><th data-t="colOrder"></th><th data-t="colTotal"></th><th data-t="colStatus"></th><th data-t="colDate"></th></tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
  </section>
</main></div>
<!-- The SDK's UMD build still reads process.env.NODE_ENV in its message handler; without this every message from Salla throws and init() times out. -->
<script>window.process = window.process || { env: { NODE_ENV: "production" } };</script>
<script src="${SDK_URL}"></script>
<script>
(function () {
  var T = {
    ar: { title:"تأكيد طلبات الدفع عند الاستلام", results:"النتائج", settings:"الإعدادات", recent:"آخر الطلبات",
      d7:"7 أيام", d30:"30 يوماً", d90:"90 يوماً",
      asked:"طلبات أُرسل لها تأكيد", confirmed:"أكدها العميل", byCustomer:"ألغاها العميل", noAnswer:"أُلغيت لعدم الرد", pending:"بانتظار الرد",
      confirmRate:"نسبة التأكيد", answerRate:"نسبة الرد", saved:"وفّرت تقريباً", failed:"لم تصل الرسالة",
      refused:"أكدها ثم رفض الاستلام", blocked:"أُلغيت: رفض سابقاً",
      blockLabel:"إلغاء طلبات من رفض الاستلام سابقاً", blockHint:"إن أكد العميل طلباً ثم أُرجع أو أُلغي، يُلغى طلبه التالي بالدفع عند الاستلام تلقائياً. إن أوقفته، يُرسل له التأكيد ويُعلَّم الطلب فقط.",
      warn:"سبق أن رفض", sRefused:"رُفض عند التسليم", sBlocked:"ملغي (رفض سابق)",
      sheets:"التصدير إلى Google Sheets", sheetsHint:"رابط خاص بمتجرك فيه طلبات الدفع عند الاستلام (رقم الطلب، المبلغ، الحالة، التواريخ) دون بيانات العملاء. يتحدّث في Google Sheets تلقائياً كل ساعة تقريباً.",
      feedMake:"إنشاء رابط التصدير", feedCopy:"نسخ", feedCopied:"تم النسخ",
      feedSteps:"افتح جدولاً في Google Sheets، والصق هذه الصيغة في الخلية A1.", feedDownload:"تنزيل CSV (Excel)",
      feedRotate:"رابط جديد", feedPrivate:"من يملك الرابط يرى طلباتك؛ «رابط جديد» يوقف القديم.",
      rotateTitle:"إنشاء رابط جديد؟", rotateMsg:"سيتوقف الرابط الحالي، وتحتاج إلى لصق الصيغة الجديدة في جداولك.", feedErr:"تعذّر إنشاء الرابط",
      addressChanged:"أرسل عنواناً جديداً", sAddress:"عنوان جديد في سجل الطلب",
      e_setup:"واتساب غير مُعدّ، لم يُرسل السؤال للعميل", e_no_mobile:"لا يوجد رقم جوال صالح في الطلب",
      e_whatsapp:"تعذّر إرسال رسالة واتساب للعميل", e_no_status:"تعذّر تعليق الطلب: لا توجد حالة «قيد المراجعة» في المتجر",
      e_address_note:"تعذّر إضافة العنوان الجديد إلى سجل الطلب", e_salla:"تعذّر الاتصال بسلة لهذا الطلب", e_other:"حدث خطأ في هذا الطلب",
      savedNote:"التوفير = الطلبات الملغاة قبل الشحن × تكلفة الطرد المرتجع التي تحددها أدناه.",
      onLabel:"إرسال التأكيد عبر واتساب", onYes:"يعمل: كل طلب دفع عند الاستلام جديد يصل العميل سؤال تأكيد", onNo:"متوقف: الطلبات الجديدة لا تُرسل لها رسائل",
      costLabel:"تكلفة الطرد المرتجع (ر.س)", costHint:"شحن ذهاباً وإياباً، عادةً 30–40 ر.س",
      flow:"كيف يعمل: الطلب الجديد يُعلَّق بحالة «بانتظار التأكيد» ويصل العميل زرّا «تأكيد الطلب» و«إلغاء الطلب». تذكير بعد ساعتين وبعد 24 ساعة، ثم يُلغى الطلب تلقائياً ويُعاد المخزون إذا لم يرد. إن غيّر العميل عنوانه عبر واتساب يُضاف العنوان إلى سجل الطلب.",
      colOrder:"الطلب", colTotal:"المبلغ", colStatus:"الحالة", colDate:"التاريخ",
      sConfirmed:"مؤكد", sCancelled:"ملغي", sNoAnswer:"ملغي (لا رد)", sPending:"بانتظار الرد", reminders:"تذكير",
      empty:"لا توجد طلبات دفع عند الاستلام في هذه الفترة بعد.", save:"حفظ", saved_ok:"تم حفظ الإعدادات", save_err:"تعذر الحفظ",
      badCost:"أدخل تكلفة بين 0 و1000 ر.س", load_err:"تعذر تحميل البيانات. حدّث الصفحة.", outside:"افتح هذه الصفحة من لوحة تحكم سلة.",
      notInstalled:"التطبيق غير مثبت على هذا المتجر." },
    en: { title:"COD order confirmation", results:"Results", settings:"Settings", recent:"Latest orders",
      d7:"7 days", d30:"30 days", d90:"90 days",
      asked:"Orders asked to confirm", confirmed:"Confirmed by customer", byCustomer:"Cancelled by customer", noAnswer:"Cancelled, no answer", pending:"Awaiting answer",
      confirmRate:"Confirm rate", answerRate:"Answer rate", saved:"Saved, about", failed:"Message not delivered",
      refused:"Confirmed, then refused", blocked:"Cancelled: refused before",
      blockLabel:"Cancel orders from past refusers", blockHint:"If a customer confirmed an order and it came back or was cancelled, their next cash-on-delivery order is cancelled automatically. Off: they still get the question and the order is only flagged.",
      warn:"Refused before", sRefused:"Refused at delivery", sBlocked:"Cancelled (refused before)",
      sheets:"Export to Google Sheets", sheetsHint:"A private link with your cash-on-delivery orders (order number, total, status, dates), no customer data. Google Sheets refreshes it about every hour.",
      feedMake:"Create export link", feedCopy:"Copy", feedCopied:"Copied",
      feedSteps:"Open a Google Sheets spreadsheet and paste this formula into cell A1.", feedDownload:"Download CSV (Excel)",
      feedRotate:"New link", feedPrivate:"Anyone with the link sees your orders; “New link” stops the old one.",
      rotateTitle:"Create a new link?", rotateMsg:"The current link stops working and you'll need to paste the new formula into your sheets.", feedErr:"Couldn't create the link",
      addressChanged:"Sent a new address", sAddress:"New address in order history",
      e_setup:"WhatsApp isn't set up, so the customer wasn't asked", e_no_mobile:"The order has no usable mobile number",
      e_whatsapp:"The WhatsApp message couldn't be sent", e_no_status:"Couldn't hold the order: the store has no “Under review” status",
      e_address_note:"Couldn't add the new address to the order history", e_salla:"Couldn't reach Salla for this order", e_other:"Something went wrong with this order",
      savedNote:"Saved = orders cancelled before shipping × the refused-parcel cost you set below.",
      onLabel:"Ask customers on WhatsApp", onYes:"On: every new cash-on-delivery order gets a confirm question", onNo:"Paused: new orders get no messages",
      costLabel:"Refused parcel cost (SAR)", costHint:"Two-way shipping, usually SAR 30–40",
      flow:"How it works: a new order is held as \\u201cAwaiting confirmation\\u201d and the customer gets Confirm / Cancel buttons. Reminders after 2 h and 24 h; with no answer the order is cancelled and stock restored. A new address sent on WhatsApp is added to the order history.",
      colOrder:"Order", colTotal:"Total", colStatus:"Status", colDate:"Date",
      sConfirmed:"Confirmed", sCancelled:"Cancelled", sNoAnswer:"Cancelled (no answer)", sPending:"Awaiting answer", reminders:"reminder",
      empty:"No cash-on-delivery orders in this period yet.", save:"Save", saved_ok:"Settings saved", save_err:"Couldn't save",
      badCost:"Enter a cost between 0 and 1000 SAR", load_err:"Couldn't load the data. Reload the page.", outside:"Open this page from your Salla dashboard.",
      notInstalled:"The app isn't installed on this store." }
  };
  var sdk = window.salla && window.salla.embedded;
  var lang = "ar", t = T.ar, sid = null, days = 30, state = null;
  var $ = function (id) { return document.getElementById(id); };

  function applyLayout(layout) {
    if (!layout) return;
    lang = layout.locale === "en" ? "en" : "ar";
    t = T[lang];
    document.documentElement.setAttribute("lang", lang);
    document.documentElement.setAttribute("dir", layout.dir || (lang === "ar" ? "rtl" : "ltr"));
    document.documentElement.setAttribute("data-theme", layout.theme === "dark" ? "dark" : "light");
  }
  function texts() {
    document.querySelectorAll("[data-t]").forEach(function (el) { el.textContent = t[el.getAttribute("data-t")] || ""; });
    document.querySelectorAll("#range button").forEach(function (b) { b.textContent = t["d" + b.getAttribute("data-days")]; });
  }
  function num(n) { return new Intl.NumberFormat(lang === "ar" ? "ar-SA" : "en-US").format(n); }
  function pct(r) { return r == null ? "–" : new Intl.NumberFormat(lang === "ar" ? "ar-SA" : "en-US", { style: "percent", maximumFractionDigits: 0 }).format(r); }
  function money(n, cur) { return new Intl.NumberFormat(lang === "ar" ? "ar-SA" : "en-US", { style: "currency", currency: cur || "SAR", maximumFractionDigits: 0 }).format(n); }
  function toast(kind, msg) { try { sdk.ui.toast[kind](msg); } catch (e) {} }
  function notice(msg) { var n = $("notice"); n.textContent = msg; n.style.display = msg ? "block" : "none"; }

  function api(path, body) {
    return fetch(path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + (sid || "") }, body: JSON.stringify(body || {}) })
      .then(function (r) {
        // Our session or Salla's token ran out: Salla reloads the iframe with a fresh token.
        if (r.status === 401) { sdk.auth.refresh(); throw new Error("expired"); }
        return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || "failed"); return j; });
      });
  }

  function stat(label, value, hero) {
    return '<div class="stat' + (hero ? " hero" : "") + '"><div class="v">' + value + '</div><div class="l">' + label + "</div></div>";
  }
  function render() {
    var s = state.stats;
    $("stats").innerHTML =
      stat(t.saved, money(s.saved, "SAR"), true) + stat(t.asked, num(s.asked)) + stat(t.confirmRate, pct(s.confirmRate)) +
      stat(t.answerRate, pct(s.answerRate)) + stat(t.confirmed, num(s.confirmed)) + stat(t.byCustomer, num(s.cancelledByCustomer)) +
      stat(t.noAnswer, num(s.cancelledNoAnswer)) + stat(t.pending, num(s.pending)) + stat(t.refused, num(s.refused)) +
      (s.blocked ? stat(t.blocked, num(s.blocked)) : "") + (s.addressChanged ? stat(t.addressChanged, num(s.addressChanged)) : "") +
      (s.failed ? stat(t.failed, num(s.failed)) : "");
    var on = !state.settings.paused;
    $("on").setAttribute("aria-checked", on ? "true" : "false");
    $("onHint").textContent = on ? t.onYes : t.onNo;
    $("block").setAttribute("aria-checked", state.settings.blockRefusers ? "true" : "false");
    if (document.activeElement !== $("cost")) $("cost").value = state.settings.parcelCost;
    document.querySelectorAll("#range button").forEach(function (b) { b.setAttribute("aria-pressed", String(Number(b.getAttribute("data-days")) === days)); });
    renderFeed(state.feedKey);
    if (!state.recent.length) { $("rows").innerHTML = '<tr><td colspan="4" class="empty">' + t.empty + "</td></tr>"; return; }
    $("rows").innerHTML = state.recent.map(function (o) {
      var cls = o.refused ? "b-cancelled" : o.status === "confirmed" ? "b-confirmed" : o.status === "cancelled" ? "b-cancelled" : "b-pending";
      var label = o.refused ? t.sRefused : o.blocked ? t.sBlocked : o.status === "confirmed" ? t.sConfirmed :
        o.status === "cancelled" ? (o.answered ? t.sCancelled : t.sNoAnswer) : t.sPending;
      if (o.status === "pending" && o.reminders) label += " · " + num(o.reminders) + " " + t.reminders;
      return "<tr><td>#" + esc(o.reference) + "</td><td>" + (o.total != null ? money(o.total, o.currency) : "–") + '</td><td><span class="badge ' + cls + '">' +
        esc(label) + "</span>" + (o.priorRefusals && !o.blocked ? '<span class="badge b-warn">' + t.warn + " ×" + num(o.priorRefusals) + "</span>" : "") + (o.address ? '<span class="badge b-info">' + t.sAddress + "</span>" : "") +
        (o.error ? '<div class="err" title="' + esc(o.error) + '">' + esc(t["e_" + o.errorKind] || t.e_other) + "</div>" : "") + "</td><td>" +
        new Date(o.createdAt).toLocaleString(lang === "ar" ? "ar-SA" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) + "</td></tr>";
    }).join("");
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  function renderFeed(key) {
    $("feedNone").hidden = !!key;
    $("feedSome").hidden = !key;
    if (!key) return;
    var url = location.origin + "/salla/feed/" + key + ".csv";
    $("feedFormula").value = '=IMPORTDATA("' + url + '")';
    $("feedDownload").href = url + "?download=1";
  }
  function makeFeed(rotate) {
    return api("/salla/app/feed", { rotate: rotate }).then(function (j) { state.feedKey = j.feedKey; renderFeed(j.feedKey); })
      .catch(function (e) { if (e.message !== "expired") toast("error", t.feedErr); });
  }
  function load() {
    return api("/salla/app/data", { days: days }).then(function (d) {
      state = d;
      notice(d.installed ? "" : t.notInstalled);
      render();
    });
  }
  function save() {
    var cost = Number($("cost").value);
    if (!isFinite(cost) || cost < 0 || cost > 1000 || $("cost").value === "") { toast("error", t.badCost); return; }
    var paused = $("on").getAttribute("aria-checked") !== "true";
    var blockRefusers = $("block").getAttribute("aria-checked") === "true";
    try { sdk.ui.loading.show(); } catch (e) {}
    api("/salla/app/settings", { paused: paused, parcelCost: cost, blockRefusers: blockRefusers })
      .then(function () { toast("success", t.saved_ok); return load(); })
      .catch(function (e) { if (e.message !== "expired") toast("error", t.save_err); })
      .then(function () { try { sdk.ui.loading.hide(); } catch (e) {} });
  }

  $("on").addEventListener("click", function () {
    var on = this.getAttribute("aria-checked") !== "true";
    this.setAttribute("aria-checked", String(on));
    $("onHint").textContent = on ? t.onYes : t.onNo;
  });
  $("block").addEventListener("click", function () {
    this.setAttribute("aria-checked", String(this.getAttribute("aria-checked") !== "true"));
  });
  $("feedMake").addEventListener("click", function () { makeFeed(false); });
  $("feedRotate").addEventListener("click", function () {
    Promise.resolve(sdk.ui.confirm({ title: t.rotateTitle, message: t.rotateMsg, variant: "danger" }))
      .then(function (r) { if (r && r.confirmed) makeFeed(true); })
      .catch(function () {});
  });
  $("feedCopy").addEventListener("click", function () {
    // Salla's iframe doesn't grant clipboard-write, so copy from the selected field.
    var f = $("feedFormula"); f.focus(); f.select();
    var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
    if (ok) toast("success", t.feedCopied);
  });
  $("range").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    days = Number(b.getAttribute("data-days"));
    load().catch(function (err) { if (err.message !== "expired") toast("error", t.load_err); });
  });

  function boot() {
    if (!sdk) { texts(); notice(T.ar.outside + " / " + T.en.outside); return; }
    sdk.init({ debug: false }).then(function (res) {
      applyLayout(res && res.layout);
      texts();
      var token = sdk.auth.getToken();
      if (!token) { notice(t.outside); sdk.ready(); return; }
      return fetch("/salla/app/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: token }) })
        .then(function (r) { if (!r.ok) throw new Error("auth"); return r.json(); })
        .then(function (j) { sid = j.session; return load(); })
        .then(function () {
          sdk.page.setTitle(t.title);
          sdk.nav.setAction({ title: t.save, value: "save", icon: "hgi hgi-stroke hgi-tick-02" });
          sdk.nav.onActionClick(function (v) { if (v === "save") save(); });
          if (sdk.onThemeChange) sdk.onThemeChange(function (theme) { document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light"); });
          sdk.ready();
        });
    }).catch(function () {
      // A bad or expired token can't be fixed here: close instead of hanging on Salla's loader.
      try { sdk.destroy(); } catch (e) {}
    });
  }
  boot();
})();
</script>
</body>
</html>`;
}
