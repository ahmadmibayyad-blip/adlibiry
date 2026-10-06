import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import FAQ from "./FAQ";

beforeAll(() => {
  // motion's whileInView needs an IntersectionObserver; jsdom has none.
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
  );
});

describe("FAQ copy", () => {
  it("never mentions backend data sources or competitor names", () => {
    const { container } = render(<FAQ />);
    // Open every answer so its text is in the page too.
    for (const q of screen.getAllByText(/\?$/)) fireEvent.click(q);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Spend estimates blend/); // answers are rendered
    for (const name of [/winninghunter/i, /nexscope/i, /apify/i, /pipispy/i, /adlibrary/i]) expect(text).not.toMatch(name);
    expect(text).not.toMatch(/Yes\. Yes\./);
  });
});
