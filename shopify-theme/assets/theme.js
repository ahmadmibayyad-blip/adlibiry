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
    if (wasOpen) $('.drawer__panel', d)?.focus();
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
    if (t.matches('[data-option-index]')) selectVariant(t.closest('[data-product]'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeDrawer();
    $$('details[open].mobile-nav, details[open].search-toggle').forEach((d) => { d.open = false; });
  });

  // ── product ─────────────────────────────────────────────────────────
  function showMedia(gallery, id) {
    if (!gallery || !id) return;
    $$('[data-media-id]', gallery).forEach((s) => s.classList.toggle('is-active', s.dataset.mediaId === String(id)));
    $$('[data-thumb]', gallery).forEach((b) => b.classList.toggle('is-active', b.dataset.thumb === String(id)));
  }

  function selectVariant(product) {
    if (!product) return;
    let variants = [];
    try {
      variants = JSON.parse($('[data-variants]', product).textContent);
    } catch {
      return;
    }
    const chosen = $$('[data-option-index]', product).map((s) => s.value);
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
      price.classList.toggle('price--sale', onSale);
      price.innerHTML = `<span class="price__current">${formatMoney(variant.price)}</span>` +
        (onSale ? `<s class="price__compare">${formatMoney(variant.compare_at_price)}</s>` : '');
    }
    if (variant.featured_media) showMedia($('[data-gallery]', product), variant.featured_media.id);
    if (product.closest('.template-product')) {
      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url.toString());
    }
  }

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
