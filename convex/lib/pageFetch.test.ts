import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPage, needsBrowser } from "./pageFetch";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const STORE = `<html><head><title>Glow Lamp</title><script>var x=1</script></head><body><main><h1>Glow Lamp</h1><p>${"A warm bedside lamp that glows. ".repeat(10)}</p></main></body></html>`;
const SHELL = `<html><head><title>Shop</title></head><body><div id="root"></div><script src="/app.js"></script></body></html>`;
const CHALLENGE = `<html><head><title>Just a moment...</title></head><body><div>Checking</div><script src="/cdn-cgi/x.js"></script></body></html>`;

describe("needsBrowser", () => {
  it("passes a page with real content", () => {
    expect(needsBrowser(STORE)).toBe(false);
  });

  it("flags bot checks and pages built by scripts", () => {
    expect(needsBrowser(CHALLENGE)).toBe(true);
    expect(needsBrowser(SHELL)).toBe(true);
    expect(needsBrowser(`<html><head><title>Store</title></head><body><script src="https://ct.captcha-delivery.com/c.js"></script>${"x ".repeat(200)}</body></html>`)).toBe(true);
  });

  it("leaves a short page without scripts alone", () => {
    expect(needsBrowser("<html><body><p>Coming soon</p></body></html>")).toBe(false);
  });
});

describe("fetchPage", () => {
  const stub = (plain: Response | Error, rendered?: { status: number; html: string }) => {
    const fn = vi.fn(async (url: string) => {
      if (url.endsWith("/api/render")) return new Response(JSON.stringify(rendered ?? { error: "x" }), { status: rendered ? 200 : 502 });
      if (plain instanceof Error) throw plain;
      return plain;
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  };

  it("keeps a page the plain fetch read, without the browser", async () => {
    vi.stubEnv("RENDER_SECRET", "s");
    const fn = stub(new Response(STORE));
    expect(await fetchPage("https://shop.com/")).toBe(STORE);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("asks the browser when the store turns the server away or sends a shell", async () => {
    vi.stubEnv("RENDER_SECRET", "s");
    const fn = stub(new Response("blocked", { status: 403 }), { status: 403, html: STORE });
    expect(await fetchPage("https://shop.com/")).toBe(STORE);
    const [url, init] = fn.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://adspypro.net/api/render");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer s");
    expect(JSON.parse(String(init.body))).toEqual({ url: "https://shop.com/" });

    stub(new Response(SHELL), { status: 200, html: STORE });
    expect(await fetchPage("https://shop.com/")).toBe(STORE);
  });

  it("keeps the plain answer when the browser is still blocked, and skips it for missing pages", async () => {
    vi.stubEnv("RENDER_SECRET", "s");
    stub(new Response(SHELL), { status: 200, html: CHALLENGE });
    expect(await fetchPage("https://shop.com/")).toBe(SHELL);

    const fn = stub(new Response("no", { status: 404 }), { status: 200, html: STORE });
    expect(await fetchPage("https://shop.com/gone")).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);

    stub(new Response("blocked", { status: 403 }), { status: 404, html: STORE });
    expect(await fetchPage("https://shop.com/")).toBeNull();
  });

  it("works as before when the browser isn't set up", async () => {
    vi.stubEnv("RENDER_SECRET", "");
    const fn = stub(new Error("timeout"));
    expect(await fetchPage("https://shop.com/")).toBeNull();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
