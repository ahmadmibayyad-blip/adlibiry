import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { FoundStore } from "@/convex/lib/offerSearch.ts";
import { StoreResults } from "./StoreResults.tsx";

const keywords = vi.fn(async (_: unknown) => ({ keywords: ["Magnetische Einlegesohlen", "Abnehm Einlagen"] }));
const start = vi.fn(async (_: unknown) => ({ id: "s9", cached: false }));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: () => [],
    useMutation: () => vi.fn(),
    useAction: (ref: unknown) =>
      ({ "whoElse:keywords": keywords, "offerSearch:start": start } as Record<string, unknown>)[getFunctionName(ref as never)] ?? vi.fn(),
  };
});
vi.mock("@/components/AddToCollection.tsx", () => ({ default: () => null }));

const store = (host: string, ads: number, dropship?: FoundStore["dropship"]): FoundStore => ({
  host, advertisers: [host], ads, copies: ads, oldestDays: 30, offers: [], productPaths: [], sample: [], ...(dropship ? { dropship } : {}),
});

const show = (stores: FoundStore[]) =>
  render(
    <MemoryRouter>
      <StoreResults stores={stores} country="NL" />
    </MemoryRouter>,
  );

const hosts = () => screen.getAllByRole("link").map((a) => a.textContent).filter((t) => t?.includes("."));

describe("StoreResults", () => {
  const scored = [
    store("etos.nl", 9, { score: 1, likely: false, reasons: [] }),
    store("middo.nl", 4, { score: 6, likely: true, reasons: ["Shopify", "7 products", "−50%", "Urgency ads"] }),
    store("relivex.nl", 3, { score: 4, likely: true, reasons: ["Shopify", "12 products"] }),
  ];

  it("shows likely dropshippers first, most likely on top, with why", () => {
    show(scored);
    expect(hosts()).toEqual(["middo.nl", "relivex.nl"]);
    expect(screen.getAllByText("Likely dropshipper")).toHaveLength(2);
    expect(screen.getByText("Shopify · 7 products · −50% · Urgency ads")).toBeInTheDocument();
  });

  it("shows every store with one click", () => {
    show(scored);
    fireEvent.click(screen.getByRole("button", { name: "Show all 3 stores" }));
    expect(hosts()).toEqual(["middo.nl", "relivex.nl", "etos.nl"]);
  });

  it("shows older searches without scores as before", () => {
    show([store("a.nl", 2), store("b.nl", 5)]);
    expect(hosts()).toEqual(["b.nl", "a.nl"]);
    expect(screen.queryByText("Likely dropshipper")).toBeNull();
  });

  it("labels each store with its type", () => {
    show([
      store("moobalm.store", 7, { score: 1, likely: true, type: "hero", reasons: [] }),
      store("relivex.nl", 5, { score: 3, likely: true, type: "niche", reasons: [] }),
      store("vahlery.de", 2, { score: 3, likely: true, type: "general", reasons: [] }),
    ]);
    expect(screen.getByText("Hero store")).toBeInTheDocument();
    expect(screen.getByText("Niche dropship")).toBeInTheDocument();
    expect(screen.getByText("General store")).toBeInTheDocument();
  });

  const relivex = (): FoundStore => ({
    ...store("relivex.nl", 5, { score: 4, likely: true, type: "niche", reasons: [] }),
    advertisers: ["ReliveX"],
    products: [{
      handle: "zolen", url: "https://relivex.nl/products/zolen", title: "ReliveX™ Magnetische Inlegzolen | Verlies Gewicht", price: 29.95, compareAt: 50,
      image: "https://cdn.shopify.com/zolen.jpg",
      sourcing: { price: 9.5, url: "https://www.aliexpress.com/item/1.html", title: "Magnetic therapy insoles", markup: 4.2 },
    }],
  });

  it("shows the AliExpress match", () => {
    show([relivex()]);
    expect(screen.getByRole("link", { name: "AliExpress $9.50 · ×4.2" })).toHaveAttribute("href", "https://www.aliexpress.com/item/1.html");
  });

  it("searches Meta for the product in another country, with its photo to compare", async () => {
    function Where() {
      return <div data-testid="where">{useLocation().search}</div>;
    }
    render(
      <MemoryRouter initialEntries={["/r"]}>
        <Routes>
          <Route path="/r" element={<StoreResults country="NL" stores={[relivex()]} />} />
          <Route path="/dashboard/offer-search" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Who else sells this/ }));
    expect(screen.getByRole("menuitem", { name: "Netherlands (this search)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "Germany" }));
    expect(keywords).toHaveBeenCalledWith({ title: "ReliveX™ Magnetische Inlegzolen | Verlies Gewicht", supplierTitle: "Magnetic therapy insoles", country: "DE" });
    const box = await screen.findByLabelText("Search words");
    expect(box).toHaveValue("Magnetische Einlegesohlen, Abnehm Einlagen");
    fireEvent.change(box, { target: { value: "Magnet Einlegesohlen, Abnehm Einlagen" } });
    fireEvent.click(screen.getByRole("button", { name: "Search Meta in Germany" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("?id=s9"));
    expect(start).toHaveBeenCalledWith({ country: "DE", keywords: ["Magnet Einlegesohlen", "Abnehm Einlagen"], productImage: "https://cdn.shopify.com/zolen.jpg" });
  });

  it("puts the product's made-up name first in the search words", async () => {
    const vest: FoundStore = {
      ...relivex(),
      host: "middo.nl",
      advertisers: ["Middo"],
      products: [{ handle: "vest", url: "https://middo.nl/products/vest", title: "VitaBoost PowerVest™ | Verhoog Energie", price: 24.95, image: "https://cdn.shopify.com/vest.jpg" }],
    };
    show([vest]);
    fireEvent.click(screen.getByRole("button", { name: /Who else sells this/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sweden" }));
    expect(await screen.findByLabelText("Search words")).toHaveValue("PowerVest, Magnetische Einlegesohlen, Abnehm Einlagen");
  });

  it("shows the stores selling the same product first, by picture match", () => {
    const st = (host: string, match: number) => ({ ...store(host, 2), match });
    render(
      <MemoryRouter>
        <StoreResults stores={[st("dramabox.com", 12), st("north-alpine.com", 81), st("weckmethod.eu", 64)]} country="SE" pictures />
      </MemoryRouter>,
    );
    expect(hosts()).toEqual(["north-alpine.com", "weckmethod.eu"]);
    expect(screen.getByText("81% picture match")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 3 stores" }));
    expect(hosts()).toEqual(["north-alpine.com", "weckmethod.eu", "dramabox.com"]);
  });
});
