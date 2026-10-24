import { describe, expect, it } from "vitest";
import { CSV_HEADER, csvField, ordersCsv, riyadhTime, statusLabel } from "./sallaCsv";

describe("ordersCsv", () => {
  const at = Date.parse("2026-10-24T04:35:00Z");
  it("writes one row per order in Riyadh time, with the dashboard's statuses", () => {
    const csv = ordersCsv([
      { orderId: "1082316407", referenceId: "295325140", total: 299, currency: "SAR", status: "confirmed", createdAt: at, answeredAt: at, decidedAt: at + 60_000, reminders: 0 },
      { orderId: "9", status: "cancelled", createdAt: at, reminders: 2 },
      { orderId: "8", status: "pending", createdAt: at, lastError: "WhatsApp send failed (400)", addressAt: at, priorRefusals: 2 },
    ]);
    const rows = csv.trimEnd().split("\r\n");
    expect(rows[0]).toBe(CSV_HEADER.join(","));
    expect(rows[1]).toBe("295325140,1082316407,2026-10-24 07:35,299,SAR,مؤكد,رد,0,,,,2026-10-24 07:36,");
    expect(rows[2]).toBe("9,9,2026-10-24 07:35,,,ملغي (لا رد),لم يرد,2,,,,,");
    expect(rows[3]).toBe("8,8,2026-10-24 07:35,,,بانتظار الرد,,0,نعم,2,,,WhatsApp send failed (400)");
    expect(csv.startsWith(String.fromCharCode(0xfeff))).toBe(false);
    expect(ordersCsv([], true).startsWith(String.fromCharCode(0xfeff))).toBe(true);
  });
  it("quotes commas and quotes and stops formulas", () => {
    expect(csvField('a,"b"')).toBe('"a,""b"""');
    expect(csvField("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvField("-1")).toBe("'-1");
    expect(csvField(-1)).toBe("-1");
    expect(csvField(undefined)).toBe("");
  });
  it("labels refusals first", () => {
    expect(statusLabel({ orderId: "1", status: "confirmed", createdAt: 0, refusedAt: 1 })).toBe("رُفض عند التسليم");
    expect(statusLabel({ orderId: "1", status: "cancelled", createdAt: 0, blocked: true })).toBe("ملغي (رفض سابق)");
    expect(riyadhTime(undefined)).toBe("");
  });
});
