import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { FoundStore } from "@/convex/lib/offerSearch.ts";
import { StoreResults } from "./StoreResults.tsx";

const translate = vi.fn(async (_: unknown) => ({ words: "Magnetische Einlegesohlen" }));
vi.mock("convex/react", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    useQuery: () => [],
    useMutation: () => vi.fn(),
    useAction: (ref: unknown) => (getFunctionName(ref as never) === "offerSearch:translateWords" ? translate : vi.fn()),
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

  it("shows the AliExpress match and who else sells the product", () => {
    show([
      {
        ...store("relivex.nl", 5, { score: 4, likely: true, type: "niche", reasons: [] }),
        advertisers: ["ReliveX"],
        products: [{
          handle: "zolen", url: "https://relivex.nl/products/zolen", title: "ReliveX™ Magnetische Inlegzolen | Verlies Gewicht", price: 29.95, compareAt: 50,
          sourcing: { price: 9.5, url: "https://www.aliexpress.com/item/1.html", title: "Magnetic insoles", markup: 4.2 },
        }],
      },
    ]);
    expect(screen.getByRole("link", { name: "AliExpress $9.50 · ×4.2" })).toHaveAttribute("href", "https://www.aliexpress.com/item/1.html");
    fireEvent.click(screen.getByRole("button", { name: /Who else sells this/ }));
    // This search's country: the same words, no translation.
    expect(screen.getByRole("menuitem", { name: "Netherlands (this search)" })).toHaveAttribute("href", "/dashboard/offer-search?country=NL&words=Magnetische+Inlegzolen");
    expect(screen.getByRole("menuitem", { name: "Germany" })).toBeInTheDocument();
  });

  it("searches another country with the product's name in its language", async () => {
    function Where() {
      return <div data-testid="where">{useLocation().search}</div>;
    }
    render(
      <MemoryRouter initialEntries={["/r"]}>
        <Routes>
          <Route
            path="/r"
            element={
              <StoreResults
                country="NL"
                stores={[{
                  ...store("relivex.nl", 5, { score: 4, likely: true, type: "niche", reasons: [] }),
                  advertisers: ["ReliveX"],
                  products: [{ handle: "zolen", url: "https://relivex.nl/products/zolen", title: "ReliveX™ Magnetische Inlegzolen | Verlies Gewicht", price: 29.95 }],
                }]}
              />
            }
          />
          <Route path="/dashboard/offer-search" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Who else sells this/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Germany" }));
    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("?country=DE&words=Magnetische+Einlegesohlen"));
    expect(translate).toHaveBeenCalledWith({ words: "Magnetische Inlegzolen", country: "DE" });
  });
});
