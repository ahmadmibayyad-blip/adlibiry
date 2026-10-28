# Istilam — Shopify App Store listing (copy to paste)

Paste into Partner Dashboard → Apps → Istilam → Distribution → Manage submission, once the App Store
registration ($19) is done. English is the primary listing; add Arabic under Translations.
Character limits are Shopify's listing limits; every line below fits.

## Basics

- **App name (30):** Istilam: COD WhatsApp Confirm
- **App icon:** 1200×1200, no text (still to make)
- **Primary category:** Orders and shipping → Order management
- **Search terms (5):** cash on delivery · COD confirmation · WhatsApp · order verification · fake orders
- **Languages:** English, Arabic
- **Works with:** Shopify admin (embedded)
- **Privacy policy URL:** https://adspypro.net/istilam/privacy.html
- **FAQ / support page URL:** https://adspypro.net/istilam/faq.html
- **Support email:** support@adspypro.net

## App card subtitle (62)

Confirm cash-on-delivery orders on WhatsApp before you ship

## App introduction (100)

Every COD order gets a WhatsApp message. Customers confirm, cancel or fix their address in one tap.

## App details (500)

Refused cash-on-delivery parcels cost you shipping twice. Istilam holds each new COD order and sends the
customer a WhatsApp message with Confirm, Cancel and Change address buttons. Confirmed orders are released for
fulfilment, cancelled ones are cancelled and restocked, and a new address or map pin is added to the order note.
No answer? Reminders go out after 2 and 24 hours, then the order is cancelled. Turn on refuser protection to
cancel orders from numbers that refused a parcel before.

## Features (up to 80 each)

1. Holds every new cash-on-delivery order until the customer answers
2. WhatsApp message with Confirm, Cancel and Change address buttons
3. Confirmed orders released for fulfilment and tagged istilam:confirmed
4. Cancelled orders cancelled and restocked automatically
5. New address or map pin added to the order note
6. Reminders after 2 h and 24 h, then auto-cancel if there's no answer
7. Optional: auto-cancel orders from numbers that refused a parcel before
8. Dashboard in Arabic and English: confirm rate and shipping money saved

## Key benefits (title / description)

1. **Fewer refused parcels** / Only ship orders the customer confirmed, and stop paying return shipping on fake orders.
2. **No calls to make** / Customers answer on WhatsApp in one tap, so your team stops phoning every COD order.
3. **Right address first time** / Customers send a corrected address or a map pin before the parcel leaves.

## Pricing (manual pricing / Billing API, NOT Shopify App Pricing; 7-day free trial on every plan)

Set up at https://apps.shopify.com/services/pricing/4b3a77f0787c36ef11a711aa57ea04f3 (the listing form's
"Manage" button goes there and drops unsaved form changes). Saved 2026-10-28:

| Handle | Billing | Price | Display name | Top features (listing form) |
|---|---|---|---|---|
| confirm | Monthly | $13 / month | Confirm | 500 WhatsApp confirmations a month · Confirm, cancel and change-address buttons · Reminders and auto-cancel |
| confirm-pro | Monthly + yearly | $27 / month or $264 / year | Confirm Pro | 3,000 WhatsApp confirmations a month · Everything in Confirm · Refuser protection |
| confirm-unlimited | Monthly | $53 / month | Confirm Unlimited | No confirmation limit · Everything in Confirm Pro · For high-volume COD stores |

## Listing form values as entered (Fraud category version, 2026-10-28)

- Category: Store management › Security › Fraud. Tags: Delivery, Fake accounts, Payments, COD validation,
  Order hold, Auto-cancel, Order validation, Blocklists, Risk reports.
- Languages: Arabic, English. Online Store/POS: not required. No account needed.
- Features (5): Holds every new cash-on-delivery order until the customer answers · WhatsApp message with
  Confirm, Cancel and Change address buttons · Confirmed orders released to ship, cancelled ones cancelled and
  restocked · Reminders after 2 h and 24 h, then auto-cancel if there's no answer · Arabic and English dashboard
  with confirm rate and shipping money saved
- Feature image alt: Istilam: confirm COD orders on WhatsApp. Screenshot alts: Istilam dashboard: plan,
  confirmation results and settings · The same dashboard in Arabic, right to left · Results, WhatsApp settings
  and refused-parcel cost
- Support email (preferred) support@adspypro.net; merchant-review email support@adspypro.net; submission
  email ahmadmibayyad@gmail.com
- Reviewer instruction notes:

```
1. Install Istilam on a development store. In Settings > Payments, add a manual payment method named "Cash on Delivery (COD)".
2. Open Istilam in the admin and pick any plan (development stores get a test charge, 7-day trial).
3. Place an order paid with Cash on Delivery (COD), with a mobile number that can receive WhatsApp on the shipping address.
4. The order's fulfilment is put on hold ("Istilam marked 1 item as on hold") and the number gets a WhatsApp message with Confirm, Cancel and Change address buttons.
5. Confirm: the hold is released and the order is tagged istilam:confirmed. Cancel: the order is cancelled with reason Customer and tagged istilam:cancelled. Change address: send a location pin or type an address; it is added to the order note, then confirm.
6. With no answer, reminders go out after 2 and 24 hours, then the order is cancelled.
7. The Istilam page shows the results (asked, confirmed, cancelled, confirm rate, money saved) and the settings (WhatsApp on/off, cancel orders from past refusers, refused-parcel cost).
WhatsApp messages are sent from Istilam's own WhatsApp Business number; nothing needs to be connected by the merchant.
```

- Images: scratchpad `icon/`, `shots/shot1-en.png`, `shot2-ar.png`, `shot3-orders.png`, `feature.png`
  (copies kept in docs/istilam-listing-images/).
- Still needed to save: screencast URL (3–8 min YouTube video of install → COD order → WhatsApp confirm).

## Screenshots (1600×900, 3–6)

1. Dashboard: plan, results (asked, confirmed, cancelled, confirm rate, saved) — from istilam-dev
2. The WhatsApp message on a phone with the three buttons
3. A confirmed order in Shopify admin: tag + released hold
4. The address note on an order (map link)
5. Settings: WhatsApp on/off, refuser protection, refused-parcel cost

## Testing instructions for the reviewer

1. Install on a development store with a manual payment method named "Cash on Delivery (COD)".
2. Pick any plan (development stores get a test charge).
3. Place an order with that payment method and a WhatsApp phone number on the shipping address.
   The order's fulfilment is put on hold and the number gets the confirm message.
4. Tap Confirm (hold released, tag istilam:confirmed), Cancel (order cancelled), or Change address
   (send text or a location; it lands in the order note, then confirm).
WhatsApp messages come from Istilam's own WhatsApp Business number; the reviewer's number must be able to receive WhatsApp.

---

## الترجمة العربية

- **اسم التطبيق:** استلام: تأكيد طلبات الدفع عند الاستلام
- **العنوان الفرعي:** أكّد طلبات الدفع عند الاستلام عبر واتساب قبل الشحن
- **المقدمة:** كل طلب دفع عند الاستلام يصله رسالة واتساب. العميل يؤكد أو يلغي أو يعدّل عنوانه بضغطة.
- **التفاصيل:** الطرود المرفوضة تكلّفك الشحن مرتين. يوقف استلام كل طلب دفع عند الاستلام جديد ويرسل للعميل رسالة واتساب
  فيها أزرار تأكيد وإلغاء وتعديل العنوان. الطلب المؤكَّد يُطلق للتجهيز، والملغى يُلغى ويعود مخزونه، والعنوان الجديد أو
  الموقع يُضاف إلى ملاحظة الطلب. لم يرد العميل؟ نذكّره بعد ساعتين وبعد 24 ساعة ثم يُلغى الطلب. فعّل الحماية من رافضي
  الاستلام لإلغاء طلبات الأرقام التي رفضت طرداً من قبل.
- **المزايا:**
  1. يوقف كل طلب دفع عند الاستلام جديد حتى يرد العميل
  2. رسالة واتساب بأزرار تأكيد وإلغاء وتعديل العنوان
  3. الطلب المؤكَّد يُطلق للتجهيز مع وسم istilam:confirmed
  4. الطلب الملغى يُلغى ويعود مخزونه تلقائياً
  5. العنوان الجديد أو الموقع يُضاف إلى ملاحظة الطلب
  6. تذكير بعد ساعتين و24 ساعة ثم إلغاء تلقائي إن لم يرد
  7. اختياري: إلغاء طلبات الأرقام التي رفضت طرداً من قبل
  8. لوحة بالعربية والإنجليزية: نسبة التأكيد وتكلفة الشحن الموفّرة
