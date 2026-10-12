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
