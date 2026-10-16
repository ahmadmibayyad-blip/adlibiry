/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import { daysUntil, easter, sellingDays, upcoming } from "./lib/sellingCalendar";
import { ageLabel, storeHistory } from "./lib/storeHistory";

const day = (country: string, year: number, name: string) => sellingDays(country, year).find((d) => d.name === name)?.date;

describe("selling calendar", () => {
  it("knows each country's gift and deal days", () => {
    expect([2024, 2025, 2026, 2027].map((y) => easter(y).toISOString().slice(0, 10))).toEqual(["2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28"]);
    expect(day("US", 2026, "Mother's Day")).toBe("2026-05-10");
    expect(day("GB", 2026, "Mother's Day")).toBe("2026-03-15"); // Mothering Sunday, 3 weeks before Easter
    expect(day("SE", 2026, "Mother's Day")).toBe("2026-05-31");
    expect(day("NO", 2026, "Mother's Day")).toBe("2026-02-08");
    expect(day("ES", 2026, "Mother's Day")).toBe("2026-05-03");
    expect(day("FR", 2026, "Mother's Day")).toBe("2026-05-31");
    expect(day("FR", 2004, "Mother's Day")).toBe("2004-06-06"); // the last Sunday of May was Pentecost
    expect(day("US", 2026, "Father's Day")).toBe("2026-06-21");
    expect(day("DE", 2026, "Father's Day")).toBe("2026-05-14"); // Ascension Day
    expect(day("DK", 2026, "Father's Day")).toBe("2026-06-05");
    expect(day("SE", 2026, "Father's Day")).toBe("2026-11-08");
    expect(day("AU", 2026, "Father's Day")).toBe("2026-09-06");
    expect(day("DK", 2026, "Black Friday")).toBe("2026-11-27");
    expect(day("DK", 2026, "Cyber Monday")).toBe("2026-11-30");
    expect(day("DK", 2026, "Christmas")).toBe("2026-12-24");
    expect(day("US", 2026, "Christmas")).toBe("2026-12-25");
    expect(day("SA", 2026, "Christmas")).toBeUndefined();
    expect(sellingDays("SE", 2026).find((d) => d.name === "Father's Day")?.readyBy).toBe("2026-10-18"); // three weeks ahead for delivery
  });

  it("lists what's coming up with the public holidays, soonest first, without doubles", () => {
    const holidays = [
      { date: "2026-12-24", name: "Christmas Eve", localName: "Julafton" },
      { date: "2026-11-01", name: "All Saints' Day", localName: "Alla helgons dag" },
      { date: "2026-10-01", name: "Past", localName: "" },
    ];
    const list = upcoming("SE", "2026-10-16", holidays, 70);
    expect(list.map((d) => `${d.date} ${d.name}`)).toEqual([
      "2026-10-31 Halloween",
      "2026-11-01 Alla helgons dag (All Saints' Day)",
      "2026-11-08 Father's Day",
      "2026-11-11 Singles' Day (11.11)",
      "2026-11-27 Black Friday",
      "2026-11-30 Cyber Monday",
      "2026-12-24 Christmas", // the public holiday on the same day isn't listed twice
    ]);
    expect(daysUntil("2026-10-31", "2026-10-16")).toBe(15);
  });
});

describe("store age", () => {
  it("reads the archive's saved copies", () => {
    const h = storeHistory([["timestamp", "statuscode"], ["20231227114120", "-"], ["20240425223929", "-"], ["20240601000000", "200"], ["20260112214214", "200"]], "customlove.se");
    expect(h).toEqual({
      months: 4,
      firstSeen: "2023-12-27",
      lastSeen: "2026-01-12",
      years: [
        { year: 2023, url: "https://web.archive.org/web/20231227114120/https://customlove.se/" },
        { year: 2024, url: "https://web.archive.org/web/20240601000000/https://customlove.se/" }, // the copy that loaded
        { year: 2026, url: "https://web.archive.org/web/20260112214214/https://customlove.se/" },
      ],
    });
    expect(ageLabel(h!, Date.parse("2026-10-16"))).toBe("About 3 years old (first saved Dec 2023)");
    expect(ageLabel({ months: 1, firstSeen: "2026-09-01", years: [] }, Date.parse("2026-10-16"))).toBe("New: first saved Sep 2026");
    expect(ageLabel(storeHistory([], "x.com")!)).toMatch(/most likely a new store/);
    expect(storeHistory("busy", "x.com")).toBeNull();
  });
});

describe("public holidays", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("loads a country's holidays once and serves them from the cache", async () => {
    const t = convexTest(schema, import.meta.glob("./**/*.ts"));
    await t.run((ctx) => ctx.db.insert("users", { tokenIdentifier: "u1", role: "user" }));
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (u: string) => {
      asked.push(String(u));
      if (String(u).endsWith("/2026/SE")) return Response.json([{ date: "2026-12-24", name: "Christmas Eve", localName: "Julafton", global: true }, { date: "2026-06-06", name: "Regional", localName: "x", global: false }]);
      return new Response("", { status: 404 });
    });
    const me = t.withIdentity({ subject: "u1|s" });
    expect(await me.query(api.sellingCalendar.holidays, { country: "SE", year: 2026 })).toEqual({ days: [], missing: true });
    await me.action(api.sellingCalendar.load, { country: "SE", year: 2026 });
    expect(await me.query(api.sellingCalendar.holidays, { country: "SE", year: 2026 })).toEqual({ days: [{ date: "2026-12-24", name: "Christmas Eve", localName: "Julafton" }], missing: false });
    await me.action(api.sellingCalendar.load, { country: "SE", year: 2026 });
    expect(asked).toHaveLength(2); // 2026 and 2027, once
  });
});
