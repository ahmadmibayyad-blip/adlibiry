import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Playground from "./Playground.tsx";

type Model = { key: string; name: string; blurb: string; lengths: number[]; aspects: string[]; photoAspect: boolean; multiplier: number; needsPhoto: boolean };
type Latest = {
  _id: string; status: string; error: string | null; videoUrl: string | null; model: string; prompt: string; aspect: string; length: number;
  seed: number | null; imageId: string | null; seconds: number;
} | null;

const MODELS: Model[] = [
  { key: "kling-2.5", name: "Kling 2.5 Turbo", blurb: "Fast", lengths: [5, 10], aspects: ["9:16", "1:1", "16:9"], photoAspect: false, multiplier: 0.5, needsPhoto: false },
  { key: "kling-3", name: "Kling 3 Pro", blurb: "Best", lengths: [5, 10], aspects: ["9:16", "1:1", "16:9"], photoAspect: false, multiplier: 1, needsPhoto: false },
  { key: "photo-only", name: "Photo Only", blurb: "Needs a photo", lengths: [6], aspects: ["9:16"], photoAspect: false, multiplier: 1, needsPhoto: true },
];
const PACK = { seconds: 30, cents: 900 };
const state: { allowance: unknown; latest: Latest } = { allowance: null, latest: null };
const start = vi.fn(async (_: unknown) => "c1");
const uploadUrl = vi.fn(async () => "https://upload.example/u");

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) =>
    ({ "studio:models": MODELS, "studio:latest": state.latest, "remake:allowance": state.allowance })[getFunctionName(ref as never)],
  useMutation: (ref: unknown) => (getFunctionName(ref as never) === "studio:start" ? start : uploadUrl),
}));
vi.mock("@/components/billing/RemakeTopUpDialog.tsx", () => ({ default: () => null }));

beforeEach(() => {
  state.allowance = { limit: 60, used: 0, extra: 0, canBuy: true, pack: PACK };
  state.latest = null;
  start.mockClear();
});

const describeIt = (text: string) => fireEvent.change(screen.getByLabelText("Describe your video"), { target: { value: text } });

describe("Playground", () => {
  it("shows each model with the seconds a clip uses", () => {
    render(<Playground />);
    expect(screen.getByRole("radio", { name: /Kling 2.5 Turbo/ })).toHaveTextContent("Uses 3 s");
    expect(screen.getByRole("radio", { name: /Kling 3 Pro/ })).toHaveTextContent("Uses 5 s");
  });

  it("won't generate without a prompt", async () => {
    render(<Playground />);
    const generate = screen.getByRole("button", { name: "Generate" });
    expect(generate).toBeDisabled();
    describeIt("A dog on a cooling mat");
    expect(generate).toBeEnabled();
    fireEvent.click(generate);
    await waitFor(() => expect(start).toHaveBeenCalledWith({ model: "kling-2.5", prompt: "A dog on a cooling mat", aspect: "9:16", length: 5 }));
  });

  it("needs a photo for photo-only models", () => {
    render(<Playground />);
    describeIt("A dog");
    fireEvent.click(screen.getByRole("radio", { name: /Photo Only/ }));
    expect(screen.getByText("Add a product photo for this model.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
  });

  it("re-rolls and switches model from a finished take", async () => {
    state.latest = {
      _id: "c1", status: "done", error: null, videoUrl: "https://v.example/c.mp4", model: "kling-3", prompt: "A dog", aspect: "1:1", length: 10,
      seed: 4, imageId: null, seconds: 10,
    };
    render(<Playground />);
    fireEvent.click(screen.getByRole("button", { name: "Re-roll" }));
    await waitFor(() => expect(start).toHaveBeenCalledWith({ model: "kling-3", prompt: "A dog", aspect: "1:1", length: 10 }));
    fireEvent.click(screen.getByRole("button", { name: "Other model" }));
    expect(screen.getByRole("radiogroup", { name: "Model" })).toHaveFocus();
    expect(screen.getByLabelText("Describe your video")).toHaveValue("A dog");
    expect(screen.getByRole("link", { name: /Download MP4/ })).toHaveAttribute("href", "https://v.example/c.mp4");
  });

  it("shows progress while a clip is made", () => {
    state.latest = {
      _id: "c1", status: "rendering", error: null, videoUrl: null, model: "kling-3", prompt: "A dog", aspect: "1:1", length: 5, seed: null, imageId: null, seconds: 5,
    };
    render(<Playground />);
    expect(screen.getByText("Making your clip… (1–4 min)")).toBeInTheDocument();
  });

  it("points free accounts to Pro", () => {
    state.allowance = { limit: 0, used: 0, extra: 0, canBuy: false, pack: PACK };
    render(<Playground />);
    expect(screen.getByText("AI videos come with Pro.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /upgrade/i })).toHaveAttribute("href", "/pricing");
  });
});
