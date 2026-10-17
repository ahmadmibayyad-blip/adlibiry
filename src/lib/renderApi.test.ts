import { describe, expect, it } from "vitest";
import { isPublicIp, safeUrl } from "../../api/render";

describe("render link guard", () => {
  it("opens public web links", () => {
    expect(safeUrl("https://shop.com/products/lamp")?.hostname).toBe("shop.com");
    expect(safeUrl("http://93.184.216.34/")).not.toBeNull();
  });

  it("refuses private addresses, odd ports and other schemes", () => {
    for (const bad of [
      "http://localhost/",
      "http://127.0.0.1/",
      "http://10.0.0.5/",
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.1.1/",
      "http://172.20.0.1/",
      "http://[::1]/",
      "http://[::ffff:127.0.0.1]/",
      "http://[fd00::1]/",
      "http://intranet/",
      "http://db.internal/",
      "https://shop.com:8443/",
      "https://user:pw@shop.com/",
      "file:///etc/passwd",
      "javascript:alert(1)",
      42,
    ]) {
      expect(safeUrl(bad), String(bad)).toBeNull();
    }
  });

  it("tells public IPs from private ones", () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("100.64.0.1")).toBe(false);
    expect(isPublicIp("2606:4700::1111")).toBe(true);
    expect(isPublicIp("fe80::1")).toBe(false);
    expect(isPublicIp("not an ip")).toBe(false);
  });
});
