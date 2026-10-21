import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { chatText } from "./chatText.tsx";

const show = (text: string) => render(<MemoryRouter>{chatText(text)}</MemoryRouter>).container;

describe("chatText", () => {
  it("names product links and drops the markdown", () => {
    const c = show("Try **[Pet Hair Glove](/dashboard/products/abc123)** (63% margin).");
    const a = c.querySelector("a")!;
    expect(a.textContent).toBe("Pet Hair Glove");
    expect(a.getAttribute("href")).toBe("/dashboard/products/abc123");
    expect(c.textContent).toBe("Try Pet Hair Glove (63% margin).");
  });

  it("turns a table into one line per row", () => {
    const c = show("| Product | Score | Margin |\n|---------|-------|--------|\n| **Glove** | 92 | 63% |\n| Bed | 91 | — |");
    expect(c.textContent).toBe("Product · Score · Margin\nGlove · 92 · 63%\nBed · 91");
    expect(c.querySelector("strong")?.textContent).toBe("Glove");
  });

  it("makes headings bold and still links bare paths", () => {
    const c = show("### Quick picks\nSee /dashboard/ad-spy");
    expect(c.querySelector("strong")?.textContent).toBe("Quick picks");
    expect(c.querySelector("a")?.getAttribute("href")).toBe("/dashboard/ad-spy");
  });
});
