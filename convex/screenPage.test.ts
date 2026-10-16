import { describe, expect, it } from "vitest";
import { createPrompt, editPrompt, extractHtml, pageTitle } from "./lib/screenPage";
import { MAX_SCREENSHOT_PARTS, partsNote, screenshotProblem } from "./lib/screenshots";
import { mergeDesign } from "./lib/designWishes";

const body = `<body class="bg-white"><h1 class="text-4xl">Sleep better &amp; wake up rested</h1>${"<p>Soft cotton.</p>".repeat(12)}</body>`;

describe("screenshot to page", () => {
  it("takes the HTML document out of the answer, with or without a code fence", () => {
    const doc = `<!DOCTYPE html>\n<html><head><title>Dream Pillow</title></head>${body}</html>`;
    expect(extractHtml(doc)).toBe(doc);
    expect(extractHtml("Here is your page:\n```html\n" + doc + "\n```\nEnjoy!")).toBe(doc);
    // Cut off at the token limit: closed so it still renders.
    expect(extractHtml(`<!DOCTYPE html><html><head></head>${body.replace("</body>", "")}`)).toMatch(/<\/body>\n<\/html>$/);
    // Only a body: wrapped in a document.
    expect(extractHtml(body)).toMatch(/^<!DOCTYPE html>\n<html>\n<body/);
    expect(extractHtml("Sorry, I can't read this screenshot.")).toBeNull();
    expect(extractHtml("<html><body>hi</body></html>")).toBeNull(); // too small to be the page
  });

  it("names the page from its title, else its first heading", () => {
    expect(pageTitle("<title> Dream Pillow | Shop </title>")).toBe("Dream Pillow | Shop");
    expect(pageTitle(body)).toBe("Sleep better & wake up rested");
    expect(pageTitle("<div></div>")).toBe("Untitled page");
  });

  it("tells the AI about the parts, the notes and the change asked for", () => {
    expect(partsNote(1)).toBe("");
    expect(partsNote(3)).toContain("3 parts, top to bottom");
    expect(createPrompt(partsNote(2), "  In Danish  ")).toContain("The user's notes (follow them): In Danish");
    expect(createPrompt("", "")).toBe("Build this page as one HTML file.");
    const e = editPrompt("<html>…</html>", "make the button green", "");
    expect(e).toContain("<html>…</html>");
    expect(e).toContain("keep everything else the same: make the button green");
  });

  it("checks the screenshot parts before they go to the AI", () => {
    expect(screenshotProblem([])).toBe("Add a screenshot first.");
    expect(screenshotProblem([{ data: "aGk=", mediaType: "image/gif" }])).toMatch(/JPG, PNG or WebP/);
    expect(screenshotProblem(Array.from({ length: MAX_SCREENSHOT_PARTS + 1 }, () => ({ data: "aGk=", mediaType: "image/jpeg" })))).toMatch(/at most/);
    expect(screenshotProblem([{ data: "aGk=", mediaType: "image/png" }])).toBeNull();
  });

  it("puts the special requests' look over a screenshot's", () => {
    const look = { accent: "#ff5500", background: "#ffffff", text: "#111111", roundness: "square" as const, changed: [] };
    const d = mergeDesign(look, { accent: "#2255ff", roundness: null, headingFont: "Anton", background: null });
    expect(d).toMatchObject({ accent: "#2255ff", background: "#ffffff", roundness: "square", headingFont: "Anton" });
    expect(mergeDesign(look, null)).toMatchObject({ accent: "#ff5500" });
    expect(mergeDesign(undefined, null)).toBeUndefined();
  });
});
