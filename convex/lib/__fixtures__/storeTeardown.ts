// Trimmed from product pages of Shopify stores running Meta ads (saved 2026-10-12), for
// lib/storeTeardown.test.ts. Only the markup the teardown reads is kept; long JSON lost the
// keys we ignore. Prices in the product .js are in cents, as Shopify serves them.

/** axzenia.com/products/instant-posture-corrector: Prestige theme, Kaching % tiers, Loox. */
export const axzeniaHtml = `<html><head><script>Shopify.currency = {"active":"USD","rate":"1.0"};</script></head><body>
<section id="shopify-section-template--25018463682900__main" class="shopify-section shopify-section--main-product">
<h1>Smart-Webbing Brace</h1>
<div class="loox-rating"
    data-id="8630241853780"
    data-rating="4.5"
    data-raters="691"
    data-pattern="[rating] ([count])"></div>
<p>✓ Fix Posture Without Restricting Movement</p><p>✓ Relieve Back, Shoulder &amp; Neck Pain</p><p>✓ Build Postural Muscle Strength</p>
<script class="kaching-bundles-deal-block-settings" data-product-id="8630241853780" type="application/json">{"blockTitle":"Select Quantity","stickyAtcEnabled":false,"preselectedDealBarId":"1868a4f0-19d7-4869-802b-f55354ef7984","dealBars":[{"id":"e46ba0ac-1fcc-4955-9819-0b9dfb948a5d","label":"","title":"1 Brace","quantity":1,"subtitle":"","badgeText":"","freeGifts":[],"dealBarType":"quantity-break","discountType":"default","discountValue":""},{"id":"1868a4f0-19d7-4869-802b-f55354ef7984","label":"$67.50\\/Bra","title":"2 Braces","quantity":2,"subtitle":"Free Shipping","badgeText":"Most Popular","freeGifts":[],"dealBarType":"quantity-break","discountType":"percentage","discountValue":10},{"id":"ff6adcdb-7e93-4bd6-9038-ef0206193546","label":"$60.00\\/Bra","title":"3 Braces","quantity":3,"subtitle":"Free Shipping","badgeText":"Best Value","freeGifts":[],"dealBarType":"quantity-break","discountType":"percentage","discountValue":20}]}</script>
<p>Please note we offer free shipping however if you are located outside mainland US…</p>
<script>const productLdJsonSchema = { "@type": "Product", "aggregateRating": { "@type": "AggregateRating", "ratingValue": "4.5", "reviewCount": 691 } }</script>
</section>
<section id="shopify-section-template--25018463682900__slideshow_zYxQhq" class="shopify-section shopify-section--slideshow"></section>
<section id="shopify-section-template--25018463682900__rich_text_9aHQfX" class="shopify-section shopify-section--rich-text"></section>
<section id="shopify-section-template--25018463682900__video_bWYUGR" class="shopify-section shopify-section--video"><video src="x.mp4"></video></section>
<section id="shopify-section-template--25018463682900__image_with_text_cTnBYF" class="shopify-section shopify-section--image-with-text"></section>
<section id="shopify-section-template--25018463682900__image_with_text_HyAJLd" class="shopify-section shopify-section--image-with-text"></section>
<section id="shopify-section-template--25018463682900__testimonials_cgUycn" class="shopify-section shopify-section--testimonials"></section>
<section id="shopify-section-template--25018463682900__1739378721fd79d6ee" class="shopify-section shopify-section--apps"><div id="shopify-block-ALzIvUkZpNEJuNFowT__loox_reviews_loox_dynamic_section_D4hqqc" class="shopify-block shopify-app-block"></div></section>
<footer id="shopify-section-sections--25014096429396__footer" class="shopify-section"></footer>
</body></html>`;

export const axzeniaProduct = {
  id: 8630241853780,
  title: "Smart-Webbing Brace",
  handle: "instant-posture-corrector",
  price: 7499,
  compare_at_price: 12500,
  variants: [
    { id: 1, price: 7499, compare_at_price: 12500, available: true },
    { id: 2, price: 7499, compare_at_price: 12500, available: true },
  ],
};

/** shophealthypetz.com/products/liquidcollagen: Kaching "Buy 2, Get 1 FREE" tiers, scarcity bar, countdown. */
export const healthypetzHtml = `<div id="shopify-section-template--1__main" class="shopify-section">
<script class="kaching-bundles-deal-block-settings" data-product-id="10316198052183" type="application/json">{"blockTitle":"","stickyAtcEnabled":false,"preselectedDealBarId":"aTpP","dealBars":[{"id":"6ad7ff42-87c1-43b3-831e-5760401129c3","title":"Buy 1 Bottle","subtitle":"You Save {{saved_percentage}}","label":"","badgeText":"","freeGifts":[],"dealBarType":"quantity-break","quantity":1,"discountType":"specific","discountValue":37},{"id":"aTpP","title":"Buy 2, Get 1 FREE","subtitle":"You Save {{saved_percentage}}","label":"","badgeText":"Most Popular","freeGifts":[],"dealBarType":"bxgy","buyQuantity":2,"getQuantity":1,"buyDiscountType":"specific","buyDiscountValue":74.99,"getDiscountType":"percentage","getDiscountValue":100},{"id":"dpMl","title":"Buy 3, Get 2 FREE","subtitle":"You Save 70%","label":"","badgeText":"Free Shipping","freeGifts":[],"dealBarType":"bxgy","buyQuantity":3,"getQuantity":2,"buyDiscountType":"specific","buyDiscountValue":111.99,"getDiscountType":"percentage","getDiscountValue":100}]}</script>
<p>Produced like cheap pills and chews — limited quantities available.</p>
<div class="hp-scarcity-row"> <span class="hp-scarcity-sold">89% sold</span> <span class="hp-scarcity-timer">Ends in <span id="hp-countdown">--:--:--</span></span> </div>
<ul><li class="btf-mt-list__item"><svg width="18" height="18"><path d="M15 9"/></svg><span>60-day money-back guarantee</span></li></ul>
<p>4.7 | 50,000+ Happy Pet Parents</p>
<h2>Frequently asked questions</h2>
</div>
<div id="shopify-section-template--1__faq_x1Y2z3" class="shopify-section"></div>`;

export const healthypetzProduct = { id: 10316198052183, title: "Premium Liquid Collagen", price: 3900, compare_at_price: null, variants: [{ id: 1, price: 3900, compare_at_price: null, available: true }] };

/** hairfiller.no/products/hairfiller-instant-dye-shampoo: Kaching fixed-price tiers with a free gift, Judge.me, Debutify sticky bar. */
export const hairfillerHtml = `<div id="shopify-section-template--25372756214094__main" class="shopify-section">
<div style='display:none' class='jdgm-prev-badge' data-average-rating='4.92' data-number-of-reviews='327' data-number-of-questions='0'> <span class='jdgm-prev-badge__stars' data-score='4.92'></span></div>
<script class="kaching-bundles-deal-block-settings" data-product-id="10759609352526" type="application/json">{"blockTitle":"","stickyAtcEnabled":false,"preselectedDealBarId":"004f7139-4a20-4a6b-93d6-5d8b4fee7510","dealBars":[{"id":"004f7139-4a20-4a6b-93d6-5d8b4fee7510","title":"1 Instant Dye Shampoo","subtitle":"","label":"349 kr/stk","badgeText":"","freeGifts":[],"dealBarType":"quantity-break","quantity":1,"discountType":"default","discountValue":319},{"id":"fe7252ab-d8da-4ee3-8e6d-aae1f4fef066","title":"2 Instant Dye Shampoo","subtitle":"+ Gratis frakt","label":"299 kr/stk","badgeText":"","freeGifts":[],"dealBarType":"quantity-break","quantity":2,"discountType":"specific","discountValue":599},{"id":"d9fc1ec9-024c-4176-ba82-79cd3a0dd81e","title":"3 Instant Dye Shampoo","subtitle":"+ Gratis frakt","label":"233 kr/stk","badgeText":"","freeGifts":[{"text":"+ Gratis hodebunnsmassasje-børste (verdi 149kr)🎁","quantity":1}],"dealBarType":"quantity-break","quantity":3,"discountType":"specific","discountValue":699}]}</script>
<p>⏰ Lagertømming – siste sjanse noensinne</p>
<p>Prøv risikofritt – 365 dagers åpent kjøp</p>
<p>Og med Klarna kan du betale etter at du har mottatt pakken.</p>
<div class="dbtfy-sticky-addtocart dbtfy-sticky-addtocart--bottom"></div>
</div>
<div id="shopify-section-template--25372756214094__dbtfy_faq_eKUUVm" class="shopify-section dbtfy-faq"></div>
<div id="shopify-section-template--25372756214094__173970493439d957e0" class="shopify-section"><div id="shopify-block-AdFk1blNkOU9xZkkrY__judge_me_reviews_review_widget_Mm9ryx" class="shopify-block shopify-app-block"></div></div>`;

export const hairfillerProduct = { id: 10759609352526, title: "Hairfiller Instant Dye Shampoo", price: 34900, compare_at_price: null, variants: [{ id: 1, price: 34900, compare_at_price: null, available: true }] };

/** helysta.dk/products/orthoseat…: Upsell Koala quantity breaks rendered into the page, live-viewer counter. */
export const helystaHtml = `<div id="shopify-section-template--27110140281153__main" class="shopify-section">
<ul class="koala-deal__tiers__list">
<li class="koala-deal__tiers__list-item tier-97a885f5"><input autocomplete="off" id="koala-contract-97a885f5" class="koala-deal__tier__input" type="radio" name="koala-deal" checked/><label for="koala-contract-97a885f5" class="koala-deal__tier"><div class='koala-deal__tier__body needsclick'><div class="koala-deal__tier__title needsclick" data-template="1 STK">1 STK</div><div class="koala-deal__tier__subtitle needsclick" data-template="36% Rabat">36% Rabat</div></div><ul style="display: none;" class='koala-deal__tier__variant-groups needsclick'><li class='koala-deal__tier__variant-group needsclick'><div class='koala-deal__tier__variant-group-number needsclick'>#1</div></li></ul></label></li>
<li class="koala-deal__tiers__list-item tier-833c253e"><input autocomplete="off" id="koala-contract-833c253e" class="koala-deal__tier__input" type="radio" name="koala-deal" /><label for="koala-contract-833c253e" class="koala-deal__tier"><div class="koala-ribbon koala-top-ribbon"><span title="Mest populære" data-template="Mest populære">Mest populære</span></div><div class='koala-deal__tier__body needsclick'><div class="koala-deal__tier__title needsclick" data-template="2 STK">2 STK</div><div class="koala-deal__tier__subtitle needsclick" data-template="Kun 300 kr/stk">Kun 300 kr/stk</div></div></label></li>
<li class="koala-deal__tiers__list-item tier-3bedb762"><input autocomplete="off" id="koala-contract-3bedb762" class="koala-deal__tier__input" type="radio" name="koala-deal" /><label for="koala-contract-3bedb762" class="koala-deal__tier"><div class="koala-ribbon koala-top-ribbon"><span title="Bedste tilbud" data-template="Bedste tilbud">Bedste tilbud</span></div><div class='koala-deal__tier__body needsclick'><div class="koala-deal__tier__title needsclick" data-template="3 STK">3 STK</div><div class="koala-deal__tier__subtitle needsclick" data-template="Kun 250 kr/stk">Kun 250 kr/stk</div></div></label></li>
</ul>
<p>16 personer ser på dette produkt lige nu</p>
<p>Gratis levering + Track &amp; Trace</p>
<div id="sticky-atc-template--27110140281153__main" class="sticky-atc"></div>
</div>`;

/** wander-plus.com/products/bogo-pillow: Okendo star rating. */
export const wanderHtml = `<div class="oke-sr-count"><span class="oke-sr-count-number">4.6</span><span class="oke-sr-label-text"> Stars</span><span class="oke-sr-total-text"> (1,263 Reviews)</span></div><script type="application/json" data-oke-metafield-data=""> {"averageRating":"4.6","reviewCount":1263} </script>`;

/** allthemma.se: Shopify's review metafields as printed for Klaviyo. */
export const allthemmaMetafieldHtml = `<script>var okendoProductReviewCount = null
  try { MetafieldReviews = {"rating":{"scale_min":"1.0","scale_max":"5.0","value":"4.77"},"rating_count":66};
  } catch (e) {}</script>`;

// Saved 2026-10-13.

/**
 * matrix-nutrition.co.uk/products/kong-sleep-aid: the Vitals app embed. The volume discount itself isn't
 * in the page; the embed carries what the widget needs to fetch it (shop id, cache key, offer types).
 */
export const matrixVitalsHtml = `<html><head><script>var Shopify = Shopify || {};
Shopify.shop = "matrix-nutrition.myshopify.com";
Shopify.locale = "en";
Shopify.currency = {"active":"GBP","rate":"1.0"};
Shopify.country = "GB";</script>
<!-- BEGIN app block: shopify://apps/vitals/blocks/app-embed/aeb48102-2a5a-4f39-bdbd-d8d49f4e20b8 --><link rel="preconnect" href="https://appsolve.io/" /><script data-ver="68" id="vtlsAebData" class="notranslate">window.vtlsLiquidData = window.vtlsLiquidData || {};window.vtlsLiquidData.buildId = 83577;window.vtlsLiquidData.apiHosts = {
	...window.vtlsLiquidData.apiHosts,
	"1": "https://appsolve.io"
};window.vtlsLiquidData.ubOfferTypes={"1":[1,2,6],"2":[1,2,6]};window.vtlsLiquidData.shopInfo={id:56358109371,domain:"www.matrix-nutrition.co.uk",shopifyDomain:"matrix-nutrition.myshopify.com",primaryLocaleIsoCode: "en",defaultCurrency:"GBP"};window.vtlsLiquidData.product = {"id": 7541618114778,"available": true,"title": "Kong Sleep Aid","handle": "kong-sleep-aid"};window.vtlsLiquidData.cacheKeys = [0,1762852506,0,1791838731,1646389186,0,1791838732,0,0 ];</script><!-- END app block -->
</head><body><div id="shopify-section-template--1__main" class="shopify-section"><h1>Kong Sleep Aid</h1></div></body></html>`;

export const matrixProduct = { id: 7541618114778, title: "Kong Sleep Aid", price: 1499, compare_at_price: null, variants: [{ id: 42395218968794, price: 1499, compare_at_price: null, available: true }] };

/** appsolve.io/bundle/api/v2/sf/ub/pp/…/7541618114778.json for that page: a radio list with a ribbon on tier 2 (styling keys dropped). */
export const matrixVitalsOffers = {
  productBundle: null,
  volumeDiscount: {
    vd: {
      id: 900504, name: "Buy more, save more!", title: "Buy more, save more!", type: "fixed", applicationType: "percent",
      tiersWithGifts: [
        { giftGroups: [], discountType: "full_price", tierQuantity: "1", discountValue: "0" },
        { giftGroups: [], discountType: "percent", tierQuantity: "2", discountValue: "15" },
        { giftGroups: [], discountType: "percent", tierQuantity: "3", discountValue: "20" },
        { giftGroups: [], discountType: "percent", tierQuantity: "4", discountValue: "30" },
      ],
      highlightTier: 2, highlightTierLabel: "MOST POPULAR", preselectHighlightedTier: false,
      discountFormatText: "Buy {{ quantity }} with {{ discount_amount }} off", discountFormatTextTierZero: "Buy {{ quantity }} for {{ price_each }}",
      discountFormatTierLabels: [
        { badge: "", label: "", title: "Buy {{ quantity }} for {{ price_each }}", subtitle: "" },
        { badge: "Save: {{ discount_total }}", label: "MOST POPULAR", title: "Buy {{ quantity }} with {{ discount_amount }} off", subtitle: "" },
        { badge: "Save: {{ discount_total }}", label: "", title: "Buy {{ quantity }} with {{ discount_amount }} off", subtitle: "" },
        { badge: "Save: {{ discount_total }}", label: "", title: "Buy {{ quantity }} with {{ discount_amount }} off", subtitle: "" },
      ],
    },
  },
  bogo: null,
  relatedProducts: null,
  productAddOn: null,
  clickAtc: { enabled: true },
};

/** abundanthealth4u.com, labels for sample vials: Vitals' table layout ("Buy 10 - 19 / 20 - 29 / 30+") with tier 2 selected. */
export const abundantVitalsOffers = {
  productBundle: null,
  volumeDiscount: {
    vd: {
      id: 1231542, title: "Buy more, save more!", type: "percent", applicationType: "full_price",
      tiersWithGifts: [
        { giftGroups: [], addOnGroups: [], discountType: "percent", tierQuantity: "10", discountValue: "10", selectedByDefault: false },
        { giftGroups: [], addOnGroups: [], discountType: "percent", tierQuantity: "20", discountValue: "20", selectedByDefault: true },
        { giftGroups: [], addOnGroups: [], discountType: "percent", tierQuantity: "30", discountValue: "30", selectedByDefault: false },
      ],
      highlightTier: null, highlightTierLabel: null, preselectHighlightedTier: false, discountFormatText: null,
      discountFormatTierLabels: [
        { badge: "", label: "", title: "Buy {{ quantity_interval }}", subtitle: "" },
        { badge: "", label: "", title: "Buy {{ quantity_interval }}", subtitle: "" },
        { badge: "", label: "", title: "Buy {{ quantity_interval }}", subtitle: "" },
      ],
    },
  },
};

/**
 * ryyook.myshopify.com/products/streetwear-cap (a Debutify 8 demo store): the quantity-break widget's
 * settings and blocks as the theme prints them, the free products cut to the keys we read. Breaks 2 and 3
 * come with a free product; the theme adds the single-unit option itself.
 */
export const ryyookDebutifyHtml = `<script>Shopify.currency = {"active":"DKK","rate":"6.825024"};</script>
<script>
  Debutify.widgets['qty-breaks'] = {"enable_quantity_breaks":true,"heading":"Quantity breaks","enable_single_quantity":true,"single_quantity_text":"Buy {COUNT}","single_quantity_subtext":"Standard price","multiple_quantity_text":"Buy {COUNT}","multiple_quantity_subtext":"You have saved {SAVED_AMOUNT}","enable_variant_selector":true,"text":"Add {count} more item to unlock {discount} off","highest_discount_text":"Highest discount applied!"};</script>
<script>
    Debutify.widgets['qty-breaks']['product_break'] = [];
    Debutify.widgets['qty-breaks']['cart_break'] = [];
  </script><div id="shopify-block-AVWdDMzF1NXdxWkdaO__dbtfy_product_qty_breaks_R8wzeV" class="shopify-block"><script>
  Debutify.widgets['qty-breaks']['product_break'].push({"product_break_layout_type":"layout-4","product_break_enable_grid":true,"enable_quantity_badge":false,"product_break_visibility":"all","product_break_collection":"","product_break_types":"","product_break_tags":"","product_break_product":""});
</script><div id="shopify-block-AbVpFZVJJWmdVTmx5c__dbtfy_product_qty_break_MaxXpC" class="shopify-block"><script>
  var qtyarr = Debutify.widgets['qty-breaks']['product_break']
  var qtylastElement = qtyarr.pop();
  if(qtylastElement.breaks === undefined) {
    qtylastElement.breaks = [];
  }
  var block_setting = {"heading":"","product_break_range":2,"title":"Buy 2","subtitle":"","product_break_badge_style":"most_popular","badge_title":"POPULAR","product_break_free_product":"cargo-pants","product_break_free_product_quantity":1,"product_break_discount_code":"10OFF","product_break_discount_amount":"10","product_break_discount_type":"%","product_break_tag_1":""};
    block_setting.free_product = {"id":8941240582167,"title":"Cargo Pants","handle":"cargo-pants","description":"\\u003cp\\u003eUpgrade your streetwear wardrobe with our Cargo Pants.\\u003c\\/p\\u003e","type":"Pants","price":67568,"available":true};
    block_setting.money_guarantee_product = {"error":"json not allowed for this object"};
  qtylastElement.breaks.push(block_setting);
  Debutify.widgets['qty-breaks']['product_break'].push(qtylastElement);
</script></div>
<div id="shopify-block-AdEtVcVVvUlNLbEMxa__dbtfy_product_qty_break_JdXLVj" class="shopify-block"><script>
  var qtyarr = Debutify.widgets['qty-breaks']['product_break']
  var qtylastElement = qtyarr.pop();
  var block_setting = {"heading":"","product_break_range":3,"title":"Buy 3","subtitle":"","product_break_badge_style":"simple","badge_title":"","product_break_free_product":"baggy-jeans","product_break_free_product_quantity":1,"product_break_discount_code":"20OFF","product_break_discount_amount":"20","product_break_discount_type":"%","product_break_tag_1":""};
    block_setting.free_product = {"id":8941240647703,"title":"Baggy Jeans","handle":"baggy-jeans","type":"Bodysuits","price":67568,"available":true};
  qtylastElement.breaks.push(block_setting);
  Debutify.widgets['qty-breaks']['product_break'].push(qtylastElement);
</script></div>
</div>
<div id="shopify-block-AMmhsNUR0RHFkaFpGR__product_quantity_breaks_H9h7Bz" class="shopify-block"><dbtfy-product-quantity-break
  data-current-variant="45497828147223"
  data-current-variant-price="45045"
  data-form-data
>
  <script type="application/json" data-quantity-break-product>{"id":8941241139223,"title":"Streetwear Cap","handle":"streetwear-cap","type":"Caps","tags":["cap","streetwear"],"price":45045}</script>
    <script type="application/json" data-quantity-break-collection>[{"id":490314891287,"handle":"womens-collection","title":"Women's Collection"},{"id":490314924055,"handle":"accessories","title":"Accessories"}]</script>
</dbtfy-product-quantity-break>
<script src="//ryyook.myshopify.com/cdn/shop/t/2/assets/dbtfy-product-quantity-break.js?v=66390802759606521681789359346" defer="defer"></script></div>`;

export const ryyookProduct = { id: 8941241139223, title: "Streetwear Cap", handle: "streetwear-cap", price: 45045, compare_at_price: null, variants: [{ id: 45497828147223, price: 45045, compare_at_price: null, available: true }] };
