/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import { PEGGED_PER_USD, ratesFromFrankfurter, withPegged } from "./lib/currency";
import { toUsd } from "./lib/priceParse";
import { sellingDays } from "./lib/sellingCalendar";
import { CALENDAR_COUNTRIES } from "./lib/calendarCountries";

const frankfurter = { amount: 1, base: "USD", date: "2026-10-15", rates: { EUR: 0.89222, GBP: 0.75491, DKK: 6.6693, SEK: 9.9719 } };

afterEach(() => vi.unstubAllGlobals());

describe("exchange rates", () => {
  it("reads Frankfurter's rates and adds the dollar-pegged Gulf currencies", () => {
    expect(ratesFromFrankfurter(frankfurter)).toEqual({
      rates: { USD: 1, EUR: 0.89222, GBP: 0.75491, DKK: 6.6693 },
      all: { USD: 1, EUR: 0.89222, GBP: 0.75491, DKK: 6.6693, SEK: 9.9719 },
      date: "2026-10-15",
    });
    expect(ratesFromFrankfurter({ base: "EUR", rates: {} })).toBeNull();
    expect(withPegged({ USD: 1 })).toMatchObject({ AED: 3.6725, SAR: 3.75, USD: 1 });
  });

  it("converts prices with today's rates when it has them, else the table", () => {
    expect(toUsd({ amount: 349, currency: "SEK" }, { SEK: 9.9719 })).toBe(35);
    expect(toUsd({ amount: 99, currency: "AED" }, withPegged({}))).toBe(26.96);
    expect(toUsd({ amount: 100, currency: "DKK" })).toBe(15); // the table
    expect(toUsd({ amount: 100, currency: "XYZ" }, {})).toBeUndefined();
  });

  it("falls back to Frankfurter when the ECB's file can't be read", async () => {
    const t = convexTest(schema, import.meta.glob("./**/*.ts"));
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      asked.push(String(u));
      if (String(u).includes("ecb.europa.eu")) return new Response("busy", { status: 503 });
      return Response.json(frankfurter);
    });
    expect(await t.action(internal.currency.refreshRates, {})).toEqual({ ok: true, source: "frankfurter" });
    expect(asked[1]).toBe("https://api.frankfurter.dev/v1/latest?base=USD");
    const all = await t.query(internal.currency.allRates, {});
    expect(all).toMatchObject({ SEK: 9.9719, AED: PEGGED_PER_USD.AED, SAR: 3.75 });
  });
});

describe("selling calendar countries", () => {
  it("covers every Nager.Date country plus the UAE and Saudi Arabia, with fitting days", () => {
    expect(Object.keys(CALENDAR_COUNTRIES).length).toBeGreaterThan(200);
    expect(CALENDAR_COUNTRIES).toMatchObject({ SE: "Sweden", AE: "United Arab Emirates", SA: "Saudi Arabia" });
    const names = (c: string) => sellingDays(c, 2026).map((d) => d.name);
    expect(names("JP")).toEqual(["Valentine's Day", "Singles' Day (11.11)", "Black Friday", "Cyber Monday", "Christmas"]);
    expect(names("TR")).not.toContain("Christmas");
    expect(names("IE")).toContain("Halloween");
  });
});
