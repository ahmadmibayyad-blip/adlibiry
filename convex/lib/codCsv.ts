// The store's COD orders as CSV, for Google Sheets (=IMPORTDATA on the private feed link)
// and Excel (download). Only what the COD order tables keep: no customer name, number or address.

export type CsvOrder = {
  orderId: string;
  referenceId?: string;
  total?: number;
  currency?: string;
  status: string;
  createdAt: number;
  sentAt?: number;
  answeredAt?: number;
  decidedAt?: number;
  reminders?: number;
  refusedAt?: number;
  priorRefusals?: number;
  blocked?: boolean;
  addressAt?: number;
  lastError?: string;
};

export const CSV_HEADER = [
  "رقم الطلب", "معرف الطلب في سلة", "تاريخ الطلب", "المبلغ", "العملة", "الحالة", "رد العميل",
  "التذكيرات", "عنوان جديد", "رفض سابق (مرات)", "رُفض عند التسليم", "تاريخ القرار", "خطأ",
];

/** The same columns for Istilam on Shopify: the second one is Shopify's order id. */
export const SHOPIFY_CSV_HEADER = CSV_HEADER.map((h, i) => (i === 1 ? "معرف الطلب في Shopify" : h));

/** Arabic status as the dashboard shows it. */
export function statusLabel(o: CsvOrder): string {
  if (o.refusedAt) return "رُفض عند التسليم";
  if (o.blocked) return "ملغي (رفض سابق)";
  if (o.status === "confirmed") return "مؤكد";
  if (o.status === "cancelled") return o.answeredAt ? "ملغي" : "ملغي (لا رد)";
  return "بانتظار الرد";
}

/** "2026-10-24 07:35" in Riyadh time (Sheets reads it as a date). */
export function riyadhTime(ms: number | undefined): string {
  if (!ms) return "";
  const d = new Date(ms + 3 * 60 * 60 * 1000); // Asia/Riyadh is UTC+3 all year
  return d.toISOString().slice(0, 16).replace("T", " ");
}

/** One CSV field: quoted when needed, and a leading = + - @ neutralised so a cell can't run as a formula. */
export function csvField(v: string | number | undefined | null): string {
  if (v == null) return "";
  let s = String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ordersCsv(orders: CsvOrder[], bom = false, header: string[] = CSV_HEADER): string {
  const yes = (b: unknown) => (b ? "نعم" : "");
  const lines = [header, ...orders.map((o) => [
    o.referenceId ?? o.orderId,
    o.orderId,
    riyadhTime(o.createdAt),
    o.total ?? "",
    o.currency ?? "",
    statusLabel(o),
    o.answeredAt ? "رد" : o.status === "pending" ? "" : "لم يرد",
    o.reminders ?? 0,
    yes(o.addressAt),
    o.priorRefusals || "",
    yes(o.refusedAt),
    riyadhTime(o.decidedAt),
    o.status === "pending" ? o.lastError ?? "" : "",
  ])].map((row) => row.map(csvField).join(","));
  // Excel needs the BOM to read Arabic as UTF-8; Sheets' IMPORTDATA would show it in the first cell.
  return (bom ? String.fromCharCode(0xfeff) : "") + lines.join("\r\n") + "\r\n";
}
