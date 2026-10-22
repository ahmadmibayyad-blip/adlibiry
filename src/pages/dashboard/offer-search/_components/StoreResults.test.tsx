import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { FoundStore } from "@/convex/lib/offerSearch.ts";
import { StoreResults } from "./StoreResults.tsx";

vi.mock("convex/react", () => ({
  useQuery: () => [],
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));
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
});
