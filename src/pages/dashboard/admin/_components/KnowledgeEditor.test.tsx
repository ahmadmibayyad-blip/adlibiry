import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BUILT_IN } from "@/lib/knowledge.ts";
import KnowledgeEditor from "./KnowledgeEditor.tsx";

const save = vi.fn(async (_: unknown) => "2026-10-09T12:00:00.000Z");
vi.mock("convex/react", () => ({
  useQuery: () => null, // no saved edits yet: the built-in guides
  useMutation: () => save,
}));

describe("KnowledgeEditor", () => {
  it("edits a guide and saves the whole cleaned copy", async () => {
    render(<KnowledgeEditor />);
    const first = BUILT_IN.topics[0].guides[0];
    expect(screen.getByText("Showing the built-in guides.", { exact: false })).toBeInTheDocument();
    const saveButton = screen.getByRole("button", { name: /save changes/i });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  Dropshipping, explained  " } });
    fireEvent.change(screen.getByLabelText(/key steps/i), { target: { value: `${first.points.join("\n")}\n\nOne more step\n` } });
    expect(screen.getByText(/unsaved changes/)).toBeInTheDocument();
    fireEvent.click(saveButton);

    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const sent = save.mock.calls[0][0] as typeof BUILT_IN & { baseUpdatedAt: string | null };
    expect(sent.baseUpdatedAt).toBeNull();
    expect(sent.topics[0].guides[0].title).toBe("Dropshipping, explained");
    expect(sent.topics[0].guides[0].points).toEqual([...first.points, "One more step"]);
    expect(sent.topics[0].guides[0].id).toBe(first.id); // saved guides keep their link
    expect(sent.topics[1]).toEqual(BUILT_IN.topics[1]);
  });

  it("won't save a guide with no title, and says why", () => {
    render(<KnowledgeEditor />);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: " " } });
    expect(screen.getByText(/title is empty/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  });

  it("names a new guide's link after its title", () => {
    render(<KnowledgeEditor />);
    fireEvent.click(screen.getAllByRole("button", { name: /add guide/i })[0]);
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Shipping times in 2027" } });
    expect(screen.getByLabelText(/link name/i)).toHaveValue("shipping-times-in-2027");
  });
});
