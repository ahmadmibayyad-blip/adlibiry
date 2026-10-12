import { describe, expect, it } from "vitest";
import { offerTags } from "./offerTags";

// Ad copy below is from Meta Ad Library ads seen in DK, SE, NO, DE, NL and the US (Oct 2026), shortened.
const labels = (text: string) => offerTags(text).map((t) => t.label);

describe("offer tags", () => {
  it("reads Buy X get Y in every language", () => {
    expect(labels("Køb 2 par støttestrømper og få 3 par gratis. I alt 5 par til prisen for 2.")).toEqual(["Buy 2 get 3", "5 for 2"]);
    expect(labels("🧡 KØB 2 OG FÅ 1 GRATIS 1-2 dages levering")).toEqual(["Buy 2 get 1"]);
    expect(labels("Last Chance: BUY 1 GET 1 FREE")).toEqual(["Buy 1 get 1", "Ends soon"]);
    expect(labels("💛 Jetzt im 2+1 Deal: Kaufe 2 Packungen Glow25 Balance und erhalte 1 Packung gratis dazu")).toEqual(["Buy 2 get 1"]);
    expect(labels("BE 2 + 1 GRATIS 🔥 + Gratis Verzending")).toEqual(["Buy 2 get 1", "Free shipping"]);
    expect(labels("Köp 2, få 1 på köpet")).toEqual(["Buy 2 get 1"]);
    expect(labels("Kjøp 3 og få 2 gratis")).toEqual(["Buy 3 get 2"]);
    expect(labels("Koop 2 en krijg er 1 gratis")).toEqual(["Buy 2 get 1"]);
    expect(labels("Achetez 2, le 3e offert ! 1 acheté = 1 offert")).toEqual(["Buy 1 get 1"]);
    expect(labels("Compra 2 y llévate 1 más")).toEqual(["Buy 2 get 1"]);
    expect(labels("Huge BOGO weekend")).toEqual(["Buy 1 get 1"]);
    // "get 10%" is a discount, not free units.
    expect(labels("Buy 1 and get 10% off your next order")).toEqual(["10% off"]);
  });

  it("reads 'X for Y' bundles", () => {
    expect(labels("Køb 3 – betal for 2 🎉")).toEqual(["3 for 2"]);
    expect(labels("Jetzt im 2 für 1 Angebot")).toEqual(["2 for 1"]);
    expect(labels("3 smykker til 2")).toEqual(["3 for 2"]);
    expect(labels("Promo 3x2 en toda la tienda")).toEqual(["3 for 2"]);
    // Prices and sizes aren't bundles.
    expect(labels("2 for $30 · 30x20 cm · 3x2 m")).toEqual([]);
  });

  it("reads percentages off, and leaves other percentages alone", () => {
    expect(labels("⚜️50% OFF Sale Ending Soon⚜️")).toEqual(["50% off", "Ends soon"]);
    expect(labels("DK 40% rabat, kun i dag ★★★★★ 4.7/5")).toEqual(["40% off", "Ends today"]);
    expect(labels("Spare heute zusätzlich 20%")).toEqual(["20% off"]);
    expect(labels("Bis zu 60 % Rabatt")).toEqual(["Up to 60% off"]);
    expect(labels("Tot wel 50% korting op geselecteerde items")).toEqual(["Up to 50% off"]);
    expect(labels("Upp till 30% rabatt")).toEqual(["Up to 30% off"]);
    expect(labels("-50% første 2 måneder")).toEqual(["50% off"]);
    expect(labels("Shop now and save up to an additional 75% Off ALL rugs today")).toEqual(["75% off"]);
    expect(labels("Livraison offerte et 30% de réduction")).toEqual(["30% off", "Free shipping"]);
    expect(labels("Hasta 40% de descuento")).toEqual(["Up to 40% off"]);
    expect(labels("100% organic, 93% said it worked, 50% less sugar")).toEqual([]);
  });

  it("reads free shipping with its minimum order", () => {
    expect(labels("📦 Gratis fragt ved køb over 799 kr")).toEqual(["Free shipping over 799 kr"]);
    expect(labels("✓ Gratis verzending vanaf €75,-")).toEqual(["Free shipping over €75"]);
    expect(labels("📦 Kostenloser Versand ab 69 € 📢")).toEqual(["Free shipping over 69 €"]);
    expect(labels("Fri frakt · versandkostenfrei · free worldwide shipping")).toEqual(["Free shipping"]);
    expect(labels("Envío gratis en todos los pedidos")).toEqual(["Free shipping"]);
  });

  it("reads discount codes but not the word 'code' alone", () => {
    expect(labels("Deutschlands Nr. 1 Airstyler ✔️ ▶Rabattcode: Lena20◀ Spare heute zusätzlich 20% ✅")).toEqual(["20% off", "Code LENA20"]);
    expect(labels("🎁 BRUG KODE: GAVE20 for 20% Rabat I Dag")).toEqual(["20% off", "Code GAVE20"]);
    expect(labels('de har sendt os rabatkoden "Senior100", som giver dig 100kr rabat')).toEqual(["Code SENIOR100"]);
    expect(labels("Ontvang 10% korting met de code WELKOM10")).toEqual(["10% off", "Code WELKOM10"]);
    expect(labels("Använd koden DC26 i kassan")).toEqual(["Code DC26"]);
    expect(labels("Use code at checkout. Scan the QR code here")).toEqual([]);
  });

  it("reads free gifts and urgency", () => {
    expect(labels("🎁 Kaufe 2 Bike Bags und erhalte ein GRATIS Geschenk im Wert von 29,99€")).toEqual(["Buy 2 get 1", "Free gift"]);
    expect(labels("Free gifts with every order")).toEqual(["Free gift"]);
    expect(labels("Gratis gave til de første 100")).toEqual(["Free gift"]);
    expect(labels("🔥 LETZTER TAG – 50% RABATT")).toEqual(["50% off", "Ends today"]);
    expect(labels("ALLEEN VANDAAG 10% KORTING OP ALLES")).toEqual(["10% off", "Ends today"]);
    expect(labels("75% RABAT – kun i dag")).toEqual(["75% off", "Ends today"]);
    expect(labels("Udsalget slutter snart")).toEqual(["Ends soon"]);
    expect(labels("Nur für kurze Zeit: 4 Energy Sirupe")).toEqual(["Limited time"]);
    expect(labels("Endast idag!")).toEqual(["Ends today"]);
  });

  it("orders, dedupes and keeps the matched words", () => {
    const tags = offerTags("FREE SHIPPING · 50% off · free shipping · 50% OFF · Code SAVE10");
    expect(tags.map((t) => t.label)).toEqual(["50% off", "Free shipping", "Code SAVE10"]);
    expect(tags[0]).toEqual({ kind: "percent", label: "50% off", match: "50% off" });
    expect(offerTags("")).toEqual([]);
    expect(offerTags(undefined)).toEqual([]);
    expect(labels("Er du træt af beskidte bagsæder, hundehår og ridser overalt? 🐾")).toEqual([]);
  });
});
