import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import StudioPage from "./page.tsx";
import OpenInStudio from "../_components/OpenInStudio.tsx";

const state: { ad: unknown; adError: boolean; mine: unknown[] } = { ad: undefined, adError: false, mine: [] };

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    if (name === "ads:getById") {
      if (state.adError) throw new Error("ArgumentValidationError");
      return state.ad;
    }
    if (name === "studio:mine") return state.mine;
    return undefined;
  },
}));
vi.mock("../ad-spy/_components/AdVideoAnalysis.tsx", () => ({
  default: ({ ad }: { ad: { headline: string } }) => <div>analysis for {ad.headline}</div>,
}));
vi.mock("./_components/Playground.tsx", () => ({ default: () => <div>playground</div> }));

const AD = { _id: "a1", headline: "Cooling mat for dogs", advertiserName: "PawCo", videoUrl: "https://v/ad.mp4" };

function Where() {
  return <div data-testid="where">{useLocation().search}</div>;
}
const show = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/dashboard/studio" element={<><StudioPage /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  state.ad = AD;
  state.adError = false;
  state.mine = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("AI Studio", () => {
  it("opens the remake tab for the ad in the link", () => {
    show("/dashboard/studio?ad=a1");
    expect(screen.getByRole("tab", { name: "Remake an ad" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Cooling mat for dogs" })).toBeInTheDocument();
    expect(screen.getByText("analysis for Cooling mat for dogs")).toBeInTheDocument();
  });

  it("opens the playground without an ad", () => {
    show("/dashboard/studio");
    expect(screen.getByRole("tab", { name: "Playground" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("playground")).toBeInTheDocument();
  });

  it("asks for an ad when none is picked", () => {
    show("/dashboard/studio?tab=remake");
    expect(screen.getByText("Open an ad in Ad Spy and click Open in AI Studio to remake it here.")).toBeInTheDocument();
  });

  it("says when the ad has no video", () => {
    state.ad = { ...AD, videoUrl: undefined };
    show("/dashboard/studio?ad=a1");
    expect(screen.getByText("This ad has no video to remake.")).toBeInTheDocument();
  });

  it("says when the ad isn't there", () => {
    state.ad = null;
    show("/dashboard/studio?ad=a1");
    expect(screen.getByText("Ad not found")).toBeInTheDocument();
  });

  it("says the ad isn't there for a broken link instead of crashing", () => {
    state.adError = true;
    show("/dashboard/studio?ad=not-an-id");
    expect(screen.getByText("Ad not found")).toBeInTheDocument();
  });

  it("switches tabs in the URL", () => {
    show("/dashboard/studio?ad=a1");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "My videos" }), { button: 0 });
    fireEvent.click(screen.getByRole("tab", { name: "My videos" }));
    expect(screen.getByTestId("where").textContent).toContain("tab=videos");
    expect(screen.getByTestId("where").textContent).toContain("ad=a1");
  });

  it("lists my videos with downloads", () => {
    state.mine = [
      { kind: "clip", id: "c1", title: "A dog on a mat", videoUrl: "https://v/1.mp4", at: 2 },
      { kind: "ugc", id: "r1", title: "Cooling mat", videoUrl: "https://v/2.mp4", at: 1, adId: "a1" },
    ];
    show("/dashboard/studio?tab=videos");
    expect(screen.getAllByRole("link", { name: /Download MP4/ })).toHaveLength(2);
    expect(screen.getByText("A dog on a mat")).toBeInTheDocument();
  });

  it("tells you when there are no videos yet", () => {
    show("/dashboard/studio?tab=videos");
    expect(screen.getByText("Your AI videos and clips will show here.")).toBeInTheDocument();
  });
});

describe("OpenInStudio", () => {
  it("opens the studio for this ad in a new tab", () => {
    render(<OpenInStudio adId="a1" />);
    const link = screen.getByRole("link", { name: /Open in AI Studio/ });
    expect(link).toHaveAttribute("href", "/dashboard/studio?tab=remake&ad=a1");
    expect(link).toHaveAttribute("target", "_blank");
  });
});
