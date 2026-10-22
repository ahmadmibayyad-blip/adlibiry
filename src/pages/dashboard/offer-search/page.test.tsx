import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OfferSearchPage from "./page.tsx";

const state: { search: unknown } = { search: null };
const findMore = vi.fn(async (_: unknown) => ({ ok: true }));
const start = vi.fn(async (_: unknown) => ({ id: "s2", cached: false }));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args?: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref as never);
    if (name === "offerSearch:recent") return { used: 1, limit: 30, searches: [] };
    if (name === "offerSearch:get") return state.search;
    if (name === "onboarding:mine") return null;
    return [];
  },
  useAction: (ref: unknown) => (getFunctionName(ref as never) === "offerSearch:findMore" ? findMore : start),
  useMutation: () => vi.fn(),
}));
vi.mock("@/components/AddToCollection.tsx", () => ({ default: () => null }));

const done = (extra: object = {}) => ({
  _id: "s1", country: "NL", offer: "bxgy", phrases: ["2+1 gratis"], status: "done", createdAt: "2026-10-22T00:00:00Z", adsFound: 3,
  stores: [{ host: "relivex.nl", advertisers: ["ReliveX"], ads: 3, copies: 3, oldestDays: 9, offers: [], productPaths: [], sample: [] }],
  ...extra,
});
const show = (url = "/dashboard/offer-search?id=s1") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <OfferSearchPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  state.search = done();
  findMore.mockClear();
});

describe("Offer Search page", () => {
  it("finds more stores for an offer search", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Find more stores (+150 ads)" }));
    await waitFor(() => expect(findMore).toHaveBeenCalledWith({ id: "s1" }));
  });

  it("says when more stores are being found, and when every phrase was searched", () => {
    state.search = done({ moreStatus: "running" });
    const { unmount } = show();
    expect(screen.getByText("Finding more stores…")).toBeInTheDocument();
    unmount();
    state.search = done({ moreStatus: "done" });
    show();
    expect(screen.getByText("All phrases searched")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Find more/ })).toBeNull();
  });

  it("has no Find more for the user's own words", () => {
    state.search = done({ offer: undefined });
    show();
    expect(screen.queryByRole("button", { name: /Find more/ })).toBeNull();
  });

  it("starts from a product name sent by Who else sells this", () => {
    state.search = null;
    show("/dashboard/offer-search?country=NL&words=Magnetische%20Inlegzolen");
    expect(screen.getByDisplayValue("Magnetische Inlegzolen")).toBeInTheDocument();
  });
});
