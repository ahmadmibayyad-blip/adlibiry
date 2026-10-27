// The HTML of Istilam's page inside Shopify admin (served by convex/shopifyCodEmbedded.ts at
// /shopify-istilam/app). App Bridge and Polaris web components come from Shopify's CDN: no own
// chrome, toasts via shopify.toast, every request carries a fresh session token (shopify.idToken()).
// The script avoids backticks and "${" so it can live in this template string.

import { SHOPIFY_PLANS } from "./shopifyCod";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function dashboardPage({ clientId, locale }: { clientId: string; locale: string }): string {
  const ar = /^ar\b/i.test(locale);
  const plans = JSON.stringify(SHOPIFY_PLANS.map((p) => ({ name: p.name, amount: p.amount, interval: p.interval, tier: p.tier })));
  return `<!doctype html>
<html lang="${ar ? "ar" : "en"}" dir="${ar ? "rtl" : "ltr"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="shopify-api-key" content="${esc(clientId)}">
<title>Istilam</title>
<script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
<script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
<style>
.stats { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:12px; }
.stat { border:1px solid var(--p-color-border, #e3e3e3); border-radius:8px; padding:12px; }
.stat b { display:block; font-size:20px; margin-top:4px; }
.plans { display:grid; grid-template-columns:repeat(auto-fill, minmax(180px, 1fr)); gap:12px; }
.plan { border:1px solid var(--p-color-border, #e3e3e3); border-radius:8px; padding:12px; display:grid; gap:8px; }
.plan[data-current] { border-color:#008060; }
.row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.feed { flex:1; min-width:220px; font-family:monospace; padding:6px 8px; border:1px solid #c9cccf; border-radius:6px; direction:ltr; }
[hidden] { display:none !important; }
</style>
</head>
<body>
<s-page heading="Istilam">
  <div id="banners"></div>
  <s-section id="planSec">
    <s-heading data-t="planTitle"></s-heading>
    <s-paragraph id="planUse"></s-paragraph>
    <div class="plans" id="plans"></div>
    <s-paragraph id="planNote" tone="subdued"></s-paragraph>
  </s-section>
  <s-section>
    <div class="row" style="justify-content:space-between">
      <s-heading data-t="results"></s-heading>
      <div class="row" id="range"></div>
    </div>
    <div class="stats" id="stats"></div>
    <s-paragraph tone="subdued" data-t="savedNote"></s-paragraph>
  </s-section>
  <s-section>
    <s-heading data-t="settings"></s-heading>
    <s-stack gap="base">
      <s-switch id="on" label="WhatsApp"></s-switch>
      <s-switch id="block" label="Refusers"></s-switch>
      <s-number-field id="cost" label="Cost" min="0" max="1000" step="1"></s-number-field>
      <div><s-button id="save" variant="primary"></s-button></div>
      <s-paragraph tone="subdued" data-t="flow"></s-paragraph>
    </s-stack>
  </s-section>
  <s-section>
    <s-heading data-t="sheets"></s-heading>
    <s-paragraph tone="subdued" data-t="sheetsHint"></s-paragraph>
    <div id="feedNone"><s-button id="feedMake"></s-button></div>
    <div id="feedSome" hidden>
      <div class="row"><input class="feed" id="feedFormula" readonly><s-button id="feedCopy"></s-button></div>
      <s-paragraph tone="subdued" data-t="feedSteps"></s-paragraph>
      <div class="row"><s-button id="feedDownload" target="_blank"></s-button><s-button id="feedRotate" variant="tertiary"></s-button></div>
      <s-paragraph tone="subdued" data-t="feedPrivate"></s-paragraph>
    </div>
  </s-section>
  <s-section>
    <s-heading data-t="recent"></s-heading>
    <s-table id="table">
      <s-table-header-row>
        <s-table-header listslot="primary" data-t="colOrder"></s-table-header><s-table-header data-t="colTotal"></s-table-header>
        <s-table-header data-t="colStatus"></s-table-header><s-table-header data-t="colDate"></s-table-header>
      </s-table-header-row>
      <s-table-body id="rows"></s-table-body>
    </s-table>
    <s-paragraph id="empty" tone="subdued" hidden data-t="empty"></s-paragraph>
  </s-section>
</s-page>
<script>
(function () {
  var T = {
    ar: { results:"النتائج", settings:"الإعدادات", recent:"آخر الطلبات", d7:"7 أيام", d30:"30 يوماً", d90:"90 يوماً",
      asked:"طلبات أُرسل لها تأكيد", confirmed:"أكدها العميل", byCustomer:"ألغاها العميل", noAnswer:"أُلغيت لعدم الرد", pending:"بانتظار الرد",
      confirmRate:"نسبة التأكيد", answerRate:"نسبة الرد", saved:"وفّرت تقريباً", failed:"لم تصل الرسالة",
      refused:"أكدها ثم رفض الاستلام", blocked:"أُلغيت: رفض سابقاً", addressChanged:"أرسل عنواناً جديداً",
      onLabel:"إرسال التأكيد عبر واتساب", onYes:"يعمل: كل طلب دفع عند الاستلام جديد يصل العميل سؤال تأكيد", onNo:"متوقف: الطلبات الجديدة لا تُرسل لها رسائل",
      blockLabel:"إلغاء طلبات من رفض الاستلام سابقاً", blockHint:"إن أكد العميل طلباً ثم أُرجع أو أُلغي، يُلغى طلبه التالي بالدفع عند الاستلام تلقائياً. إن أوقفته، يُرسل له التأكيد ويُعلَّم الطلب فقط.",
      costLabel:"تكلفة الطرد المرتجع", costHint:"شحن ذهاباً وإياباً بعملة متجرك",
      flow:"كيف يعمل: يُعلَّق شحن الطلب الجديد (Hold) ويصل العميل زرّا «تأكيد الطلب» و«إلغاء الطلب». التأكيد يرفع التعليق، والإلغاء يلغي الطلب ويعيد المخزون. تذكير بعد ساعتين وبعد 24 ساعة، ثم يُلغى الطلب تلقائياً إذا لم يرد. العنوان الجديد يُضاف إلى ملاحظة الطلب.",
      savedNote:"التوفير = الطلبات الملغاة قبل الشحن × تكلفة الطرد المرتجع التي تحددها أدناه.",
      sheets:"التصدير إلى Google Sheets", sheetsHint:"رابط خاص بمتجرك فيه طلبات الدفع عند الاستلام (رقم الطلب، المبلغ، الحالة، التواريخ) دون بيانات العملاء. يتحدّث في Google Sheets تلقائياً كل ساعة تقريباً.",
      feedMake:"إنشاء رابط التصدير", feedCopy:"نسخ", feedCopied:"تم النسخ", feedSteps:"افتح جدولاً في Google Sheets، والصق هذه الصيغة في الخلية A1.",
      feedDownload:"تنزيل CSV (Excel)", feedRotate:"رابط جديد", feedPrivate:"من يملك الرابط يرى طلباتك؛ «رابط جديد» يوقف القديم.", feedErr:"تعذّر إنشاء الرابط",
      colOrder:"الطلب", colTotal:"المبلغ", colStatus:"الحالة", colDate:"التاريخ",
      sConfirmed:"مؤكد", sCancelled:"ملغي", sNoAnswer:"ملغي (لا رد)", sPending:"بانتظار الرد", sRefused:"رُفض عند التسليم", sBlocked:"ملغي (رفض سابق)",
      sAddress:"عنوان جديد في ملاحظة الطلب", warn:"سبق أن رفض", reminders:"تذكير",
      e_setup:"واتساب غير مُعدّ، لم يُرسل السؤال للعميل", e_no_mobile:"لا يوجد رقم جوال صالح في الطلب", e_whatsapp:"تعذّر إرسال رسالة واتساب للعميل",
      e_no_fulfillment_order:"لم يُعلَّق الشحن: لا يوجد طلب تنفيذ مفتوح بعد", e_shopify:"تعذّر الاتصال بـ Shopify لهذا الطلب", e_other:"حدث خطأ في هذا الطلب",
      e_no_status:"حدث خطأ في هذا الطلب", e_address_note:"تعذّر إضافة العنوان الجديد إلى الطلب", e_salla:"حدث خطأ في هذا الطلب",
      empty:"لا توجد طلبات دفع عند الاستلام في هذه الفترة بعد.", save:"حفظ", saved_ok:"تم حفظ الإعدادات", save_err:"تعذر الحفظ",
      badCost:"أدخل تكلفة بين 0 و1000", load_err:"تعذر تحميل البيانات. حدّث الصفحة.",
      planTitle:"الباقة", t_confirm:"تأكيد", t_pro:"تأكيد برو", t_bundle:"تأكيد بلا حدود",
      p_Confirm:"500 تأكيد شهرياً", "p_Confirm Pro":"3,000 تأكيد شهرياً", "p_Confirm Unlimited":"بلا حدود", "p_Confirm Pro Yearly":"3,000 تأكيد شهرياً، سنوياً",
      perMonth:"/ شهرياً", perYear:"/ سنوياً", recommended:"الأنسب", choose:"اختيار", current:"باقتك الحالية", trialDays:"7 أيام مجاناً",
      useOf:"{n} من {limit} تأكيد هذا الشهر", useAll:"{n} طلب أُرسل للتأكيد هذا الشهر", trialEnds:"تنتهي الفترة التجريبية في {date}.",
      planNone:"اختر باقة لتبدأ: لن تُرسل رسائل التأكيد قبل الاشتراك. أول 7 أيام مجاناً.",
      planOff:"الاشتراك غير نشط، فالطلبات الجديدة لا تُرسل لها رسائل. اختر باقة أدناه.",
      planFull:"وصلت إلى حد باقتك: {n} طلب هذا الشهر لم يُرسل له تأكيد. اختر باقة أكبر أدناه.",
      planReset:"يتجدّد العدّاد أول كل شهر.", testPlan:"اشتراك تجريبي (متجر تطوير): لا يُحصَّل أي مبلغ.", billErr:"تعذّر فتح صفحة الاشتراك" },
    en: { results:"Results", settings:"Settings", recent:"Latest orders", d7:"7 days", d30:"30 days", d90:"90 days",
      asked:"Orders asked to confirm", confirmed:"Confirmed by customer", byCustomer:"Cancelled by customer", noAnswer:"Cancelled, no answer", pending:"Awaiting answer",
      confirmRate:"Confirm rate", answerRate:"Answer rate", saved:"Saved, about", failed:"Message not delivered",
      refused:"Confirmed, then refused", blocked:"Cancelled: refused before", addressChanged:"Sent a new address",
      onLabel:"Ask customers on WhatsApp", onYes:"On: every new cash-on-delivery order gets a confirm question", onNo:"Paused: new orders get no messages",
      blockLabel:"Cancel orders from past refusers", blockHint:"If a customer confirmed an order and it came back or was cancelled, their next cash-on-delivery order is cancelled automatically. Off: they still get the question and the order is only flagged.",
      costLabel:"Refused parcel cost", costHint:"Two-way shipping, in your store currency",
      flow:"How it works: a new order's fulfillment is put on hold and the customer gets Confirm / Cancel buttons. Confirm releases the hold; Cancel cancels the order and restocks. Reminders after 2 h and 24 h; with no answer the order is cancelled. A new address is added to the order note.",
      savedNote:"Saved = orders cancelled before shipping × the refused-parcel cost you set below.",
      sheets:"Export to Google Sheets", sheetsHint:"A private link with your cash-on-delivery orders (order number, total, status, dates), no customer data. Google Sheets refreshes it about every hour.",
      feedMake:"Create export link", feedCopy:"Copy", feedCopied:"Copied", feedSteps:"Open a Google Sheets spreadsheet and paste this formula into cell A1.",
      feedDownload:"Download CSV (Excel)", feedRotate:"New link", feedPrivate:"Anyone with the link sees your orders; New link stops the old one.", feedErr:"Couldn't create the link",
      colOrder:"Order", colTotal:"Total", colStatus:"Status", colDate:"Date",
      sConfirmed:"Confirmed", sCancelled:"Cancelled", sNoAnswer:"Cancelled (no answer)", sPending:"Awaiting answer", sRefused:"Refused at delivery", sBlocked:"Cancelled (refused before)",
      sAddress:"New address in the order note", warn:"Refused before", reminders:"reminder",
      e_setup:"WhatsApp isn't set up, so the customer wasn't asked", e_no_mobile:"The order has no usable mobile number", e_whatsapp:"The WhatsApp message couldn't be sent",
      e_no_fulfillment_order:"Not held: there was no open fulfillment order yet", e_shopify:"Couldn't reach Shopify for this order", e_other:"Something went wrong with this order",
      e_no_status:"Something went wrong with this order", e_address_note:"Couldn't add the new address to the order", e_salla:"Something went wrong with this order",
      empty:"No cash-on-delivery orders in this period yet.", save:"Save", saved_ok:"Settings saved", save_err:"Couldn't save",
      badCost:"Enter a cost between 0 and 1000", load_err:"Couldn't load the data. Reload the page.",
      planTitle:"Plan", t_confirm:"Confirm", t_pro:"Confirm Pro", t_bundle:"Confirm Unlimited",
      p_Confirm:"500 confirmations a month", "p_Confirm Pro":"3,000 confirmations a month", "p_Confirm Unlimited":"No limit", "p_Confirm Pro Yearly":"3,000 a month, billed yearly",
      perMonth:"/ month", perYear:"/ year", recommended:"Recommended", choose:"Choose", current:"Your plan", trialDays:"7 days free",
      useOf:"{n} of {limit} confirmations this month", useAll:"{n} orders sent for confirmation this month", trialEnds:"The trial ends on {date}.",
      planNone:"Pick a plan to start: no confirmations are sent before you subscribe. The first 7 days are free.",
      planOff:"The subscription isn't active, so new orders get no messages. Pick a plan below.",
      planFull:"You've reached your plan's limit: {n} orders this month got no confirmation. Pick a bigger plan below.",
      planReset:"The count starts again on the 1st of each month.", testPlan:"Test subscription (development store): nothing is charged.", billErr:"Couldn't open the subscription page" }
  };
  var lang = document.documentElement.lang === "ar" ? "ar" : "en";
  var L = T[lang];
  var PLANS = ${plans};
  var days = 30;
  var state = null;
  function t(k, vars) { var s = L[k] || T.en[k] || k; for (var v in (vars || {})) s = s.split("{" + v + "}").join(String(vars[v])); return s; }
  function $(id) { return document.getElementById(id); }
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    for (var a in (attrs || {})) e.setAttribute(a, attrs[a]);
    (kids || []).forEach(function (k) { e.append(k); });
    return e;
  }
  function num(n) { return Number(n).toLocaleString(lang === "ar" ? "ar-SA" : "en-US"); }
  function money(n, cur) { return n == null ? "-" : num(n) + (cur ? " " + cur : ""); }
  function pct(x) { return x == null ? "-" : Math.round(x * 100) + "%"; }
  function date(ms) { return new Date(ms).toLocaleDateString(lang === "ar" ? "ar-SA" : "en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); }
  function toast(msg, err) { try { shopify.toast.show(msg, { isError: !!err }); } catch (e) {} }

  async function api(path, body) {
    var token = await shopify.idToken();
    var res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify(body || {}) });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) { var err = new Error(data.error || String(res.status)); err.code = data.error; throw err; }
    return data;
  }

  document.querySelectorAll("[data-t]").forEach(function (n) { n.textContent = t(n.getAttribute("data-t")); });
  $("on").setAttribute("label", t("onLabel"));
  $("block").setAttribute("label", t("blockLabel"));
  $("block").setAttribute("details", t("blockHint"));
  $("cost").setAttribute("label", t("costLabel"));
  $("cost").setAttribute("details", t("costHint"));
  $("save").textContent = t("save");
  $("feedMake").textContent = t("feedMake");
  $("feedCopy").textContent = t("feedCopy");
  $("feedDownload").textContent = t("feedDownload");
  $("feedRotate").textContent = t("feedRotate");
  [7, 30, 90].forEach(function (d) {
    var b = el("s-button", { variant: d === days ? "primary" : "secondary", "data-days": String(d) }, [t("d" + d)]);
    b.addEventListener("click", function () { days = d; load(); });
    $("range").append(b);
  });

  function renderPlan(d) {
    var p = d.plan;
    $("banners").replaceChildren();
    var banner = null;
    if (!p.tier) banner = t("planNone");
    else if (!p.active) banner = t("planOff");
    else if (p.limit != null && p.sent >= p.limit) banner = t("planFull", { n: num(p.skipped) });
    if (banner) $("banners").append(el("s-banner", { tone: "warning" }, [banner]));
    $("planUse").textContent = p.tier
      ? (p.limit != null ? t("useOf", { n: num(p.sent), limit: num(p.limit) }) : t("useAll", { n: num(p.sent) }))
      : "";
    var notes = [];
    if (p.trialEndsAt && p.trialEndsAt > Date.now()) notes.push(t("trialEnds", { date: date(p.trialEndsAt) }));
    if (p.test) notes.push(t("testPlan"));
    if (p.limit != null) notes.push(t("planReset"));
    $("planNote").textContent = notes.join(" ");
    $("plans").replaceChildren();
    PLANS.forEach(function (pl) {
      var current = p.name === pl.name && p.active;
      var card = el("div", { class: "plan" }, [
        el("s-text", { type: "strong" }, [pl.name]),
        el("s-text", {}, ["$" + pl.amount + " " + t(pl.interval === "ANNUAL" ? "perYear" : "perMonth")]),
        el("s-text", { tone: "subdued" }, [t("p_" + pl.name)]),
      ]);
      if (pl.name === "Confirm Pro") card.prepend(el("s-badge", { tone: "info" }, [t("recommended")]));
      if (current) {
        card.setAttribute("data-current", "");
        card.append(el("s-badge", { tone: "success" }, [t("current")]));
      } else {
        var b = el("s-button", { variant: pl.name === "Confirm Pro" ? "primary" : "secondary" }, [t("choose") + (p.tier ? "" : " · " + t("trialDays"))]);
        b.addEventListener("click", function () { subscribe(pl.name, b); });
        card.append(b);
      }
      $("plans").append(card);
    });
  }

  async function subscribe(name, button) {
    button.setAttribute("loading", "");
    try {
      var r = await api("/shopify-istilam/app/billing", { plan: name });
      open(r.confirmationUrl, "_top");
    } catch (e) {
      button.removeAttribute("loading");
      toast(t("billErr"), true);
    }
  }

  function renderStats(d) {
    var s = d.stats, cur = d.currency;
    var items = [["asked", num(s.asked)], ["confirmed", num(s.confirmed)], ["byCustomer", num(s.cancelledByCustomer)], ["noAnswer", num(s.cancelledNoAnswer)],
      ["pending", num(s.pending)], ["confirmRate", pct(s.confirmRate)], ["answerRate", pct(s.answerRate)], ["saved", money(s.saved, cur)]];
    if (s.failed) items.push(["failed", num(s.failed)]);
    if (s.refused) items.push(["refused", num(s.refused)]);
    if (s.blocked) items.push(["blocked", num(s.blocked)]);
    if (s.addressChanged) items.push(["addressChanged", num(s.addressChanged)]);
    $("stats").replaceChildren.apply($("stats"), items.map(function (i) { return el("div", { class: "stat" }, [el("s-text", { tone: "subdued" }, [t(i[0])]), el("b", {}, [i[1]])]); }));
    document.querySelectorAll("#range s-button").forEach(function (b) { b.setAttribute("variant", Number(b.getAttribute("data-days")) === days ? "primary" : "secondary"); });
  }

  function statusBadge(o) {
    if (o.refused) return el("s-badge", { tone: "critical" }, [t("sRefused")]);
    if (o.blocked) return el("s-badge", { tone: "critical" }, [t("sBlocked")]);
    if (o.status === "confirmed") return el("s-badge", { tone: "success" }, [t("sConfirmed")]);
    if (o.status === "cancelled") return el("s-badge", { tone: "warning" }, [t(o.answered ? "sCancelled" : "sNoAnswer")]);
    return el("s-badge", { tone: "info" }, [t("sPending") + (o.reminders ? " · " + num(o.reminders) + " " + t("reminders") : "")]);
  }

  function renderRows(d) {
    $("rows").replaceChildren();
    $("empty").hidden = d.recent.length > 0;
    $("table").hidden = d.recent.length === 0;
    d.recent.forEach(function (o) {
      var status = el("div", {}, [statusBadge(o)]);
      if (o.priorRefusals) status.append(" ", el("s-badge", { tone: "warning" }, [t("warn") + " ×" + num(o.priorRefusals)]));
      if (o.address) status.append(el("div", {}, [el("s-text", { tone: "subdued" }, [t("sAddress")])]));
      if (o.errorKind) status.append(el("div", {}, [el("s-text", { tone: "critical" }, [t("e_" + o.errorKind)])]));
      $("rows").append(el("s-table-row", {}, [
        el("s-table-cell", {}, [el("s-link", { href: "shopify://admin/orders/" + o.orderId }, [o.orderName])]),
        el("s-table-cell", {}, [money(o.total, o.currency)]),
        el("s-table-cell", {}, [status]),
        el("s-table-cell", {}, [date(o.createdAt)]),
      ]));
    });
  }

  function renderSettings(d) {
    $("on").checked = d.settings.enabled;
    $("on").setAttribute("details", t(d.settings.enabled ? "onYes" : "onNo"));
    $("block").checked = d.settings.blockRefusers;
    $("cost").value = String(d.settings.parcelCost);
    if (d.currency) $("cost").setAttribute("suffix", d.currency);
  }

  function renderFeed(key) {
    $("feedNone").hidden = !!key;
    $("feedSome").hidden = !key;
    if (!key) return;
    var url = location.origin + "/shopify-istilam/feed/" + key + ".csv";
    $("feedFormula").value = '=IMPORTDATA("' + url + '")';
    $("feedDownload").setAttribute("href", url + "?download=1");
  }

  async function load() {
    try { shopify.loading(true); } catch (e) {}
    try {
      state = await api("/shopify-istilam/app/data", { days: days });
      renderPlan(state); renderStats(state); renderRows(state); renderSettings(state); renderFeed(state.feedKey);
    } catch (e) {
      $("banners").replaceChildren(el("s-banner", { tone: "critical" }, [t("load_err")]));
    }
    try { shopify.loading(false); } catch (e) {}
  }

  $("on").addEventListener("change", function () { $("on").setAttribute("details", t($("on").checked ? "onYes" : "onNo")); });
  $("save").addEventListener("click", async function () {
    var raw = String($("cost").value || "").trim();
    var cost = raw === "" ? NaN : Number(raw);
    if (!(cost >= 0 && cost <= 1000)) { toast(t("badCost"), true); return; }
    try {
      await api("/shopify-istilam/app/settings", { enabled: !!$("on").checked, blockRefusers: !!$("block").checked, parcelCost: cost });
      toast(t("saved_ok"));
      load();
    } catch (e) { toast(t(e.code === "bad_cost" ? "badCost" : "save_err"), true); }
  });
  async function feed(rotate) {
    try { renderFeed((await api("/shopify-istilam/app/feed", { rotate: rotate })).feedKey); } catch (e) { toast(t("feedErr"), true); }
  }
  $("feedMake").addEventListener("click", function () { feed(false); });
  $("feedRotate").addEventListener("click", function () { feed(true); });
  $("feedCopy").addEventListener("click", function () {
    var f = $("feedFormula");
    var done = function () { toast(t("feedCopied")); };
    if (navigator.clipboard) navigator.clipboard.writeText(f.value).then(done, function () { f.select(); document.execCommand("copy"); done(); });
    else { f.select(); document.execCommand("copy"); done(); }
  });
  load();
})();
</script>
</body>
</html>`;
}
