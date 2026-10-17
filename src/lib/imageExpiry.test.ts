import { describe, expect, it } from "vitest";
import { imageLinkExpired, imageLinkExpiry } from "./imageExpiry.ts";

const NOW = Date.UTC(2026, 9, 17);

describe("imageLinkExpiry", () => {
  it("reads TikTok's sign=<seconds>-<hash>", () => {
    const url = "https://oss-t-sg-it.chuhaijiang.com/v11/os/x.jpeg?sign=1791345785-3a0e62f994-0-202f4c28";
    expect(imageLinkExpiry(url)).toBe(1791345785000);
    expect(imageLinkExpired(url, NOW)).toBe(true);
  });

  it("reads TikTok's x-expires", () => {
    expect(imageLinkExpiry("https://p16-sign.tiktokcdn.com/a.jpeg?x-expires=1900000000&x-signature=abc")).toBe(1900000000000);
    expect(imageLinkExpired("https://p16-sign.tiktokcdn.com/a.jpeg?x-expires=1900000000", NOW)).toBe(false);
  });

  it("reads Facebook's hex oe", () => {
    expect(imageLinkExpiry("https://scontent.fbcdn.net/v/t45/a.jpg?_nc_ht=x&oe=6A000000")).toBe(0x6a000000 * 1000);
  });

  it("leaves links without an expiry alone", () => {
    expect(imageLinkExpiry("https://m.media-amazon.com/images/I/41W7eppbaRL.jpg")).toBeNull();
    expect(imageLinkExpired("not a url", NOW)).toBe(false);
  });
});
