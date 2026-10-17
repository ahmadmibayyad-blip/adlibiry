import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ResearchVerdictCard from "./ResearchVerdictCard.tsx";

type Data = Record<string, unknown>;
let data: Data = {};

vi.mock("convex/react", () => ({
  useQuery: (ref: string) => data[ref],
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
}));
vi.mock("@/convex/_generated/api.js", () => ({
  api: {
    researchReports: { latest: "latest" },
    currency: { mine: "currency" },
    onboarding: { mine: "onboarding" },
    ai: { researchProduct: "research" },
    shopifyApp: { startInstall: "install" },
  },
}));
vi.mock("@/hooks/use-user-plan.ts", () => ({ useUserPlan: () => ({ isPro: true, isLoading: false }) }));

const report = {
  call: "test",
  bottomLine: "Worth a test.",
  reasons: [],
  risks: [],
  fixes: [],
  missing: [],
  checklist: [],
  nextTask: "product validation",
  nextTaskWhy: "Because.",
};
const margin = { price: 30, cost: 8, fees: 1.2, profit: 20.8, profitPct: 69, breakEvenAdCost: 20.8 };
const rules = {
  signals: [
    { key: "ads", seen: true, detail: "" },
    { key: "supplier", seen: true, detail: "" },
    { key: "adspy", seen: false, detail: "" },
    { key: "tiktok", seen: false, detail: "" },
    { key: "ownStore", seen: false, detail: "" },
  ],
  blockers: [],
  ceiling: "test",
  costKnown: true,
  breakEven: 16,
  afterVat: true,
};
const row = (over: Data = {}) => ({
  report,
  margin,
  rules,
  rulesVersion: 2,
  aiCall: "test",
  vat: { rate: 0.25, country: "DK" },
  ownStore: {},
  createdAt: "2026-10-16T10:00:00.000Z",
  ...over,
});

function show(latest: Data | null, mine: Data = { targetCountry: "DK" }) {
  data = {
    latest,
    currency: { code: "DKK", rate: 6.93, rates: {}, date: "2026-10-15" },
    onboarding: mine,
  };
  render(
    <MemoryRouter>
      <ResearchVerdictCard productId={"p1" as never} hasSuppliers={false} />
    </MemoryRouter>,
  );
}

describe("ResearchVerdictCard", () => {
  beforeEach(() => {
    data = {};
  });

  it("explains the verdict with VAT, in the display currency", () => {
    show(row());
    expect(screen.getByText("Why this verdict")).toBeInTheDocument();
    expect(screen.getByText(/2 of 5 demand signals/)).toBeInTheDocument();
    expect(screen.getAllByText(/after VAT/).length).toBeGreaterThan(0);
    expect(screen.getByText(/1 \$ = 6\.93 DKK, rate of 2026-10-15/)).toBeInTheDocument();
    const breakEven = screen.getByText(/break-even/);
    expect(breakEven.textContent?.replace(/\s/g, " ")).toContain("DKK 110.88");
  });

  it("says what capped a research call", () => {
    show(row({ rules: { ...rules, cappedBy: "supplier cost unknown" }, aiCall: "test", report: { ...report, call: "research" } }));
    expect(screen.getByText("Capped at research more: supplier cost unknown")).toBeInTheDocument();
  });

  it("says what blocked a skip call", () => {
    show(row({ rules: { ...rules, cappedBy: "Shipping over 15 days" }, report: { ...report, call: "skip" } }));
    expect(screen.getByText("Skipped: Shipping over 15 days")).toBeInTheDocument();
  });

  it("says what the AI skipped on when no cap applied", () => {
    show(row({ rules: { ...rules, cappedBy: undefined, blockers: ["Famous brand: Stanley"] }, report: { ...report, call: "skip" } }));
    expect(screen.getByText("Skipped: Famous brand: Stanley")).toBeInTheDocument();
  });

  it("offers a refresh on a row made with older rules", () => {
    show(row({ rulesVersion: undefined, rules: undefined }));
    expect(screen.getByText("Made with older rules · Refresh")).toBeInTheDocument();
  });

  it("asks to reconnect when the store lacks the orders scope", () => {
    show(row({ ownStore: { reason: "no_scope" } }));
    expect(screen.getByText("Reconnect your store to count your own sales")).toBeInTheDocument();
  });

  it("tells a pasted-token store which scope to add", () => {
    show(row({ ownStore: { reason: "pasted_token" } }));
    expect(screen.getByText("Add read_orders to your app's access scopes")).toBeInTheDocument();
  });

  it("shows the store's own orders", () => {
    show(row({ ownStore: { orders: 7 } }));
    expect(screen.getByText("Your store: 7 orders in 30 days")).toBeInTheDocument();
  });

  it("asks for the country even when there is no margin", () => {
    show(row({ vat: null, margin: null }), {});
    expect(screen.getByText("Set the country you sell to")).toBeInTheDocument();
  });

  it("asks for the country when VAT is unknown", () => {
    show(row({ vat: null }), {});
    expect(screen.getByText("Set the country you sell to")).toBeInTheDocument();
  });
});
