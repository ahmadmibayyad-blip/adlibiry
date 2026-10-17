import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { landingMarkup } from "../../../api/landing";
import Hero from "./Hero.tsx";
import StatsBar from "./StatsBar.tsx";

// Before live data arrives every query is still loading.
vi.mock("convex/react", () => ({ useQuery: () => undefined, useConvexAuth: () => ({ isLoading: true, isAuthenticated: false }) }));

const stats = {
  ads: { total: 12345, activeCount: 678, countries: [{ value: "US", n: 9 }, { value: "DE", n: 4 }] },
  products: { total: 4321, categories: [{ value: "Pet Supplies", n: 30 }] },
};

afterEach(() => {
  delete window.__ADSPY_STATS__;
});

describe("the home page the server sends", () => {
  it("is exactly what the app draws first, so nothing changes when the app starts", () => {
    window.__ADSPY_STATS__ = stats;
    const app = renderToStaticMarkup(
      <div className="min-h-screen bg-background text-foreground">
        <Hero />
        <StatsBar />
      </div>,
    );
    // If this fails after changing Hero.tsx or StatsBar.tsx, copy the new markup into api/landing.ts landingMarkup().
    expect(landingMarkup(stats)).toBe(app);
  });
});
