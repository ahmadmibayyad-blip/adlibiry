import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel.d.ts";
import type { Variant } from "@/convex/lib/videoAnalysis.ts";
import RemakeVideo from "./RemakeVideo.tsx";

type Allowance = { limit: number | null; used: number; extra: number; canBuy: boolean; pack: { seconds: number; cents: number } } | null;
type Latest = { _id: string; status: string; error: string | null; videoUrl: string | null; seconds: number; redoId?: string | null } | null;

const state: { allowance: Allowance; latest: Latest } = { allowance: null, latest: null };
const start = vi.fn(async (_: unknown) => "r1");
const uploadUrl = vi.fn(async () => "https://upload.example/u");
const redo = vi.fn(async (_: unknown) => "r2");
const claimUpload = vi.fn(async (_: unknown) => null);

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => (getFunctionName(ref as never) === "remake:allowance" ? state.allowance : state.latest),
  useMutation: (ref: unknown) => ({ "remake:start": start, "remake:redo": redo, "remake:claimUpload": claimUpload })[getFunctionName(ref as never)] ?? uploadUrl,
  useAction: () => async () => [{ id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", gender: "female" }],
}));
vi.mock("@/components/billing/RemakeTopUpDialog.tsx", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div>top-up dialog</div> : null),
}));

const variant: Variant = {
  title: "t", hook: "h", cta: "c", notes: "",
  lines: [{ start: 0, end: 2, scene: "Talks to camera", onScreenText: "", voiceover: "My dog was always too hot" }],
};
const adId = "a1" as Id<"ads">;
const PACK = { seconds: 30, cents: 900 };

beforeEach(() => {
  state.allowance = { limit: 60, used: 20, extra: 30, canBuy: true, pack: PACK };
  state.latest = null;
  start.mockClear();
  redo.mockClear();
});

const show = () =>
  render(
    <MemoryRouter>
      <RemakeVideo adId={adId} variant={variant} product="Cooling mat" />
    </MemoryRouter>,
  );

describe("RemakeVideo", () => {
  it("shows the seconds left and sells more", () => {
    show();
    expect(screen.getByText("40 s of AI video left this month + 30 s bought")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Buy 30 s for €9" }));
    expect(screen.getByText("top-up dialog")).toBeInTheDocument();
  });

  it("has no Buy button for accounts that can't buy", () => {
    state.allowance = { limit: 15, used: 0, extra: 0, canBuy: false, pack: PACK };
    show();
    expect(screen.queryByRole("button", { name: /^Buy/ })).toBeNull();
  });

  it("points free accounts to Pro", () => {
    state.allowance = { limit: 0, used: 0, extra: 0, canBuy: false, pack: PACK };
    show();
    expect(screen.getByText("AI videos come with Pro.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /upgrade/i })).toHaveAttribute("href", "/pricing");
    expect(screen.queryByRole("button", { name: /make the video/i })).toBeNull();
  });

  it("needs an actor and a photo before making the video", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ storageId: "s1" }))));
    show();
    const make = screen.getByRole("button", { name: /make the video/i });
    expect(make).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Maya" }));
    expect(make).toBeDisabled();
    const file = new File([new Uint8Array(10)], "mat.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText(/product photo/i), { target: { files: [file] } });
    await waitFor(() => expect(make).toBeEnabled());
    fireEvent.click(make);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0][0]).toMatchObject({ adId, actorId: "maya", product: "Cooling mat", productImageId: "s1", variant });
    expect(claimUpload).toHaveBeenCalledWith({ storageId: "s1" });
    expect((screen.getByLabelText(/product photo/i) as HTMLInputElement).value).toBe("");
    vi.unstubAllGlobals();
  });

  it("is step 3 in AI Studio", () => {
    show();
    expect(screen.getByRole("heading", { name: /make the video/i })).toHaveTextContent(/^3/);
  });

  it("shows progress while the video is made", () => {
    state.latest = { _id: "r1", status: "rendering", error: null, videoUrl: null, seconds: 5 };
    show();
    expect(screen.getByText("Making the actor and product shots… (2–5 min)")).toBeInTheDocument();
  });

  it("plays the finished video with the AI note", () => {
    state.latest = { _id: "r1", status: "done", error: null, videoUrl: "https://files.example/v.mp4", seconds: 5 };
    const { container } = show();
    expect(container.querySelector("video")).toHaveAttribute("src", "https://files.example/v.mp4");
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute("href", "https://files.example/v.mp4");
    expect(screen.getByText("Made with AI. Mark it as AI-generated when you run it as an ad.")).toBeInTheDocument();
  });

  it("shows a failure and lets the user try again", () => {
    state.latest = { _id: "r1", status: "failed", error: "The AI video failed. Try again.", videoUrl: null, seconds: 5 };
    show();
    expect(screen.getByText("The AI video failed. Try again.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: /make the video/i })).toBeInTheDocument();
  });

  it("makes a finished video again for free, with the actor picked below", async () => {
    state.latest = { _id: "r1", status: "done", error: null, videoUrl: "https://v.example/x.mp4", seconds: 5, redoId: "r1" };
    show();
    fireEvent.click(screen.getByRole("button", { name: "Liam" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /make it again free/i })).toBeEnabled());
    await waitFor(() => screen.getByText(/Sarah/));
    fireEvent.click(screen.getByRole("button", { name: /make it again free/i }));
    await waitFor(() => expect(redo).toHaveBeenCalledWith({ remakeId: "r1", actorId: "liam", voiceId: "EXAVITQu4vr4xnSDxMaL" }));
  });

  it("has no free redo once it's used", () => {
    state.latest = { _id: "r2", status: "done", error: null, videoUrl: "https://v.example/x.mp4", seconds: 5, redoId: null };
    show();
    expect(screen.queryByRole("button", { name: /make it again free/i })).toBeNull();
  });
});
