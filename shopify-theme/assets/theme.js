/* AdSpy Storefront: cart drawer, add to cart, variants, gallery, sticky buy bar. No dependencies. */
(() => {
  const theme = window.theme || { routes: {}, strings: {}, cartType: 'drawer' };
  const root = (theme.routes.root || '/').replace(/\/?$/, '/');
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  // ── money ───────────────────────────────────────────────────────────
  function formatMoney(cents) {
    const format = theme.moneyFormat || '${{amount}}';
    const value = Number(cents) / 100;
    const fixed = (n, decimals, thousands, decimal) => {
      const [whole, frac] = n.toFixed(decimals).split('.');
      return whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands) + (frac ? decimal + frac : '');
    };
    return format.replace(/\{\{\s*(\w+)\s*\}\}/, (_, key) => {
      switch (key) {
        case 'amount_no_decimals': return fixed(value, 0, ',', '.');
        case 'amount_with_comma_separator': return fixed(value, 2, '.', ',');
        case 'amount_no_decimals_with_comma_separator': return fixed(value, 0, '.', ',');
        case 'amount_with_apostrophe_separator': return fixed(value, 2, "'", '.');
        case 'amount_with_space_separator': return fixed(value, 2, ' ', ',');
        default: return fixed(value, 2, ',', '.');
      }
    });
  }

  // ── toast ───────────────────────────────────────────────────────────
  let toastTimer;
  function toast(text) {
    let el = $('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = text;
    requestAnimationFrame(() => el.classList.add('is-visible'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2600);
  }

  // ── cart ────────────────────────────────────────────────────────────
  const drawer = () => $('[data-cart-drawer]');
  let lastFocus = null;

  function openDrawer() {
    const d = drawer();
    if (!d) return false;
    lastFocus = document.activeElement;
    d.hidden = false;
    document.body.classList.add('drawer-open');
    requestAnimationFrame(() => {
      d.classList.add('is-open');
      $('.drawer__panel', d)?.focus();
    });
    return true;
  }

  function closeDrawer() {
    const d = drawer();
    if (!d || d.hidden) return;
    d.classList.remove('is-open');
    document.body.classList.remove('drawer-open');
    setTimeout(() => { d.hidden = true; }, 320);
    lastFocus?.focus?.();
  }

  function setCount(count) {
    $$('[data-cart-count]').forEach((el) => {
      el.textContent = count;
      el.hidden = !count;
    });
  }

  // "Estimated delivery: 14–21 Oct": business days from today, in the page's language.
  function addBusinessDays(from, days) {
    const d = new Date(from);
    let left = days;
    while (left > 0) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) left -= 1;
    }
    return d;
  }
  function fillDeliveryDates(scope) {
    $$('[data-eta]', scope).forEach((el) => {
      const min = Number(el.dataset.min) || 0;
      const max = Math.max(min, Number(el.dataset.max) || 0);
      const out = $('[data-eta-dates]', el);
      if (!max || !out) return;
      const lang = document.documentElement.lang || undefined;
      const fmt = (d) => d.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
      const now = new Date();
      const a = fmt(addBusinessDays(now, min));
      const b = fmt(addBusinessDays(now, max));
      out.textContent = a === b ? a : `${a} – ${b}`;
      el.hidden = false;
    });
  }

  async function refreshDrawer() {
    const d = drawer();
    if (!d) return;
    const res = await fetch(`${root}?sections=cart-drawer`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const html = (await res.json())['cart-drawer'];
    if (!html) return;
    const fresh = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-cart-drawer]');
    if (!fresh) return;
    const wasOpen = d.classList.contains('is-open');
    d.innerHTML = fresh.innerHTML;
    fillDeliveryDates(d);
    loadUpsell(d);
    if (wasOpen) $('.drawer__panel', d)?.focus();
  }

  // Cart upsell (sections/cart-drawer.liquid): Shopify's recommendations for the first product,
  // minus what's already in the cart. Stays hidden when there are none.
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  async function loadUpsell(scope) {
    const box = $('[data-cart-upsell]', scope);
    const list = box && $('[data-cart-upsell-list]', box);
    if (!box || !list || !box.dataset.productId) return;
    try {
      const res = await fetch(`${root}recommendations/products.json?product_id=${encodeURIComponent(box.dataset.productId)}&limit=6`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const inCart = new Set((box.dataset.inCart || '').split(',').filter(Boolean));
      const products = ((await res.json()).products || []).filter((p) => !inCart.has(String(p.id)) && p.available).slice(0, 2);
      if (!products.length) return;
      list.innerHTML = products.map((p) => {
        const variant = (p.variants || []).find((v) => v.available) || p.variants?.[0];
        const img = p.featured_image ? `${p.featured_image}${p.featured_image.includes('?') ? '&' : '?'}width=120` : '';
        return `<li class="cart-upsell__item">
          ${img ? `<img src="${esc(img)}" alt="" loading="lazy" width="56" height="56">` : '<span></span>'}
          <div><a class="cart-upsell__title" href="${esc(p.url)}">${esc(p.title)}</a><div class="cart-upsell__price">${formatMoney(variant?.price ?? p.price)}</div></div>
          <button type="button" class="btn" data-upsell-add="${esc(variant?.id)}">${esc(theme.strings.addToCart)}</button>
        </li>`;
      }).join('');
      box.hidden = false;
    } catch {
      // No recommendations: the cart works the same without them.
    }
  }

  async function addVariant(id, button) {
    button?.classList.add('is-loading');
    try {
      const res = await fetch(`${root}cart/add.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items: [{ id: Number(id), quantity: 1 }] }),
      });
      if (!res.ok) { toast(theme.strings.error); return; }
      await syncCount();
      await refreshDrawer();
    } finally {
      button?.classList.remove('is-loading');
    }
  }

  async function syncCount() {
    const res = await fetch(`${root}cart.js`, { headers: { Accept: 'application/json' } });
    if (res.ok) setCount((await res.json()).item_count);
  }

  async function changeLine(line, quantity) {
    const res = await fetch(`${root}cart/change.js`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ line: Number(line), quantity: Math.max(0, Number(quantity) || 0) }),
    });
    if (!res.ok) {
      toast(theme.strings.error);
      return;
    }
    const cart = await res.json();
    setCount(cart.item_count);
    if ($('[data-cart-page]')) {
      window.location.reload();
      return;
    }
    await refreshDrawer();
  }

  async function addToCart(form) {
    const button = $('[data-add-button]', form);
    const error = $('[data-form-error]', form);
    if (error) error.hidden = true;
    button?.classList.add('is-loading');
    try {
      const res = await fetch(`${root}cart/add.js`, { method: 'POST', headers: { Accept: 'application/json' }, body: new FormData(form) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (error) {
          error.textContent = body.description || body.message || theme.strings.error;
          error.hidden = false;
        }
        return;
      }
      await syncCount();
      if (theme.cartType === 'drawer' && drawer()) {
        await refreshDrawer();
        openDrawer();
      } else {
        toast(theme.strings.added);
      }
    } catch {
      form.submit();
    } finally {
      button?.classList.remove('is-loading');
    }
  }

  document.addEventListener('submit', (e) => {
    // Order tracking page: the parcel's status on 17TRACK, in a new tab.
    const track = e.target.closest('[data-track-form]');
    if (track) {
      e.preventDefault();
      const number = new FormData(track).get('number').toString().replace(/\s+/g, '').toUpperCase();
      if (number) window.open(`https://t.17track.net/en#nums=${encodeURIComponent(number)}`, '_blank', 'noopener');
      return;
    }
    const form = e.target.closest('[data-product-form]');
    if (!form) return;
    e.preventDefault();
    addToCart(form);
  });

  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-cart-open]') && drawer() && theme.cartType === 'drawer') {
      e.preventDefault();
      openDrawer();
      return;
    }
    if (t.closest('[data-drawer-close]')) {
      closeDrawer();
      return;
    }
    const another = t.closest('[data-line-add]');
    if (another) {
      another.classList.add('is-loading');
      changeLine(another.dataset.lineAdd, another.dataset.lineNext);
      return;
    }
    const upsell = t.closest('[data-upsell-add]');
    if (upsell) {
      addVariant(upsell.dataset.upsellAdd, upsell);
      return;
    }
    const remove = t.closest('[data-line-remove]');
    if (remove) {
      changeLine(remove.dataset.lineRemove, 0);
      return;
    }
    const step = t.closest('[data-qty-change]');
    if (step) {
      const input = $('input', step.closest('[data-qty]'));
      const min = Number(input.min || 0);
      const next = Math.max(min, (Number(input.value) || 0) + Number(step.dataset.qtyChange));
      input.value = next;
      if (input.dataset.lineQty) changeLine(input.dataset.lineQty, next);
      const deals = $('[data-deals]', step.closest('[data-product]') || document.createElement('div'));
      if (deals) {
        const match = $(`[data-deal-qty="${next}"]`, deals);
        $$('[data-deal-qty]', deals).forEach((r) => { r.checked = r === match; r.closest('.tier').classList.toggle('is-selected', r === match); });
      }
      return;
    }
    // The star rating links to the reviews further down: the first reviews section on the page.
    const toReviews = t.closest('[data-scroll-reviews]');
    if (toReviews) {
      const target = $('.js-reviews');
      if (target) { e.preventDefault(); target.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      return;
    }
    const thumb = t.closest('[data-thumb]');
    if (thumb) showMedia(thumb.closest('[data-gallery]'), thumb.dataset.thumb);
    // Close open menus/search when clicking elsewhere.
    $$('details[open].mobile-nav, details[open].search-toggle').forEach((d) => {
      if (!d.contains(t)) d.open = false;
    });
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-line-qty]')) changeLine(t.dataset.lineQty, t.value);
    if (t.matches('[data-sort]')) {
      const url = new URL(window.location.href);
      url.searchParams.set('sort_by', t.value);
      url.searchParams.delete('page');
      window.location.href = url.toString();
    }
    if (t.closest('[data-option-index]')) selectVariant(t.closest('[data-product]'));
    if (t.matches('[data-deal-qty]')) {
      const qty = $('input[name="quantity"]', t.closest('[data-product]') || document);
      if (qty) qty.value = t.dataset.dealQty;
      $$('.tier', t.closest('[data-deals]')).forEach((d) => d.classList.toggle('is-selected', d.contains(t)));
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeDrawer();
    $$('details[open].mobile-nav, details[open].search-toggle').forEach((d) => { d.open = false; });
  });

  // ── product ─────────────────────────────────────────────────────────
  // On phones the photos sit side by side to swipe through (base.css), so showing one scrolls to it.
  const swipeable = (main) => main && main.scrollWidth > main.clientWidth + 1;
  function showMedia(gallery, id, scroll = true) {
    if (!gallery || !id) return;
    $$('[data-media-id]', gallery).forEach((s) => s.classList.toggle('is-active', s.dataset.mediaId === String(id)));
    $$('[data-thumb]', gallery).forEach((b) => b.classList.toggle('is-active', b.dataset.thumb === String(id)));
    const main = $('.gallery__main', gallery);
    const slide = $(`[data-media-id="${id}"]`, gallery);
    if (scroll && slide && swipeable(main)) main.scrollTo({ left: slide.offsetLeft - main.offsetLeft, behavior: 'smooth' });
  }
  $$('[data-gallery]').forEach((gallery) => {
    const main = $('.gallery__main', gallery);
    let timer;
    main?.addEventListener('scroll', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const i = Math.round(main.scrollLeft / main.clientWidth);
        const slide = $$('[data-media-id]', main)[i];
        if (slide) showMedia(gallery, slide.dataset.mediaId, false);
        const index = $('[data-gallery-index]', gallery);
        if (index) index.textContent = String(i + 1);
      }, 80);
    }, { passive: true });
  });

  // Bundle deals (snippets/product-block.liquid): picking one sets the quantity; prices follow the variant.
  // Struck out: the compare-at (else regular) price × items; paid: the price × items less the deal's %.
  function updateDeals(product, variant) {
    const was = Math.max(variant.compare_at_price || 0, variant.price);
    $$('[data-deal-qty]', product).forEach((input) => {
      const tier = input.closest('.tier');
      const qty = Number(input.dataset.dealQty);
      const off = Number(input.dataset.dealOff) || 0;
      const full = was * qty;
      const pay = Math.floor(((100 - off) * variant.price * qty) / 100);
      const saved = full - pay;
      const set = (sel, text) => { const el = $(sel, tier); if (el) el.textContent = text; };
      set('[data-deal-price]', formatMoney(pay));
      set('[data-deal-full]', formatMoney(full));
      set('[data-deal-unit]', formatMoney(Math.floor(pay / qty)));
      const fullEl = $('[data-deal-full]', tier);
      if (fullEl) fullEl.hidden = saved <= 0;
      const save = $('[data-deal-save]', tier);
      if (save) {
        save.hidden = saved <= 0;
        const amount = $('[data-deal-saved]', save);
        if (amount) amount.textContent = formatMoney(saved);
      }
    });
  }

  // "Only 4 left" / "In stock" (the urgency block in product-block.liquid) for the chosen variant.
  function updateStock(product, variant) {
    const line = $('[data-stock-line]', product);
    if (!line) return;
    let stock = {};
    try { stock = JSON.parse($('[data-stock]', product).textContent); } catch { /* no stock data */ }
    const strings = $('[data-stock-strings]', product)?.content;
    const left = stock[String(variant.id)];
    line.hidden = !variant.available;
    if (left) {
      line.innerHTML = `<span class="stock__dot stock__dot--low"></span><span>${esc(($('[data-low]', strings)?.textContent || '').replace('[count]', left))}</span>`;
    } else if (line.dataset.inStock === 'true' && variant.available) {
      line.innerHTML = `<span class="stock__dot"></span><span>${esc($('[data-in]', strings)?.textContent || '')}</span>`;
    } else {
      line.innerHTML = '';
    }
  }

  // Sale countdown: to the owner's end date, while the chosen variant is on sale.
  const timers = $$('[data-sale-timer]');
  function tickTimers() {
    const now = Date.now();
    timers.forEach((el) => {
      const end = Date.parse(el.dataset.end);
      const left = end - now;
      if (!Number.isFinite(left) || left <= 0) { el.hidden = true; return; }
      const s = Math.floor(left / 1000);
      const d = Math.floor(s / 86400);
      const pad = (n) => String(n).padStart(2, '0');
      const out = $('[data-sale-time]', el);
      if (out) out.textContent = `${d > 0 ? `${d}d ` : ''}${pad(Math.floor((s % 86400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
      el.hidden = false;
    });
  }
  if (timers.length) { tickTimers(); setInterval(tickTimers, 1000); }

  function selectVariant(product) {
    if (!product) return;
    let variants = [];
    try {
      variants = JSON.parse($('[data-variants]', product).textContent);
    } catch {
      return;
    }
    // Each option is a dropdown or a row of buttons (radio inputs).
    const chosen = $$('[data-option-index]', product).map((el) => (el.tagName === 'SELECT' ? el.value : $('input:checked', el)?.value));
    $$('fieldset[data-option-index]', product).forEach((el) => {
      const shown = $('[data-option-value]', el);
      if (shown) shown.textContent = $('input:checked', el)?.value || '';
    });
    const variant = variants.find((v) => v.options.every((o, i) => o === chosen[i]));
    const button = $('[data-add-button]', product);
    if (!variant) {
      if (button) { button.disabled = true; button.textContent = theme.strings.unavailable; }
      return;
    }
    $('[data-variant-id]', product).value = variant.id;
    if (button) {
      button.disabled = !variant.available;
      button.textContent = variant.available ? theme.strings.addToCart : theme.strings.soldOut;
    }
    const price = $('[data-price]', product);
    if (price) {
      const onSale = variant.compare_at_price > variant.price;
      const pct = onSale ? Math.floor(((variant.compare_at_price - variant.price) * 100) / variant.compare_at_price) : 0;
      price.classList.toggle('price--sale', onSale);
      price.innerHTML = `<span class="price__current">${formatMoney(variant.price)}</span>` +
        (onSale ? `<s class="price__compare">${formatMoney(variant.compare_at_price)}</s><span class="badge badge--sale">${esc(theme.strings.save || '')} ${pct}%</span>` : '');
    }
    const stickyPrice = $('[data-sticky-price]');
    if (stickyPrice && product.closest('.template-product')) stickyPrice.textContent = formatMoney(variant.price);
    updateDeals(product, variant);
    updateStock(product, variant);
    if (timers.length) tickTimers();
    if (variant.featured_media) showMedia($('[data-gallery]', product), variant.featured_media.id);
    if (product.closest('.template-product')) {
      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url.toString());
    }
  }

  fillDeliveryDates(document);
  loadUpsell(document);

  // Sticky add-to-cart bar once the main button scrolls out of view.
  const sticky = $('[data-sticky-buy]');
  const mainButton = $('.template-product [data-add-button]');
  if (sticky && mainButton && 'IntersectionObserver' in window) {
    sticky.hidden = false;
    new IntersectionObserver(([entry]) => {
      sticky.classList.toggle('is-visible', !entry.isIntersecting && entry.boundingClientRect.top < 0);
    }).observe(mainButton);
    $('[data-sticky-add]', sticky)?.addEventListener('click', () => {
      const form = mainButton.closest('form');
      if (form) addToCart(form);
    });
  }
})();
