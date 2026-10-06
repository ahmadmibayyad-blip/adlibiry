// Morning digest: who is due (8:00 in their own timezone, once a day), which
// winners they get (top 5 new ones in their niches) and the email itself.
// Pure, unit tested; convex/emailSender.ts sends it.

import escapeHtml from "escape-html";

export const DIGEST_HOUR = 8;
export const DIGEST_SIZE = 5;

/** The user's local date and hour. Unknown or invalid timezones count as UTC. */
export function localTime(nowMs: number, timezone: string | undefined): { day: string; hour: number } {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(
      new Date(nowMs),
    );
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(timezone || "UTC");
  } catch {
    parts = fmt("UTC");
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

/** Due when it's the digest hour (or later in the morning, if a run was missed) where they live and they haven't had today's. */
export function isDigestDue(nowMs: number, timezone: string | undefined, lastDigestDay: string | undefined): { due: boolean; day: string } {
  const { day, hour } = localTime(nowMs, timezone);
  return { due: hour >= DIGEST_HOUR && hour < DIGEST_HOUR + 4 && lastDigestDay !== day, day };
}

export type DigestWinner = { niche: string; enteredDay: string; score: number; productId: string; title: string; imageUrl: string; category: string };

/** Top 5 winners that entered the list in the last two days, in their niches (all niches if none chosen), best score first. */
export function pickDigestWinners(rows: DigestWinner[], niches: string[] | undefined, today: string): DigestWinner[] {
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const mine = niches?.length ? new Set(niches) : null;
  return rows
    .filter((r) => r.enteredDay >= yesterday && (!mine || mine.has(r.niche)))
    .sort((a, b) => b.score - a.score)
    .slice(0, DIGEST_SIZE);
}

export type DigestAlert = { title: string; body: string; link: string };

export function renderDigestHtml(opts: { winners: DigestWinner[]; alerts: DigestAlert[]; appUrl: string; unsubscribeUrl: string; niches?: string[] }): string {
  const { winners, alerts, appUrl, unsubscribeUrl } = opts;
  const row = (w: DigestWinner) => `
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #222;">
            <a href="${escapeHtml(`${appUrl}/dashboard/products/${w.productId}`)}" style="text-decoration:none;color:#fff;">
              ${w.imageUrl ? `<img src="${escapeHtml(w.imageUrl)}" width="56" height="56" alt="" style="border-radius:8px;object-fit:cover;vertical-align:middle;margin-right:12px;" />` : ""}
              <span style="font-size:15px;font-weight:600;">${escapeHtml(w.title)}</span>
            </a>
            <div style="font-size:13px;color:#9aa;margin-top:2px;">Score ${w.score}/100 · ${escapeHtml(w.niche)}</div>
          </td>
        </tr>`;
  const alertRows = alerts
    .map(
      (a) => `
        <li style="margin:0 0 8px;">
          <a href="${escapeHtml(appUrl + a.link)}" style="color:#1fbf6b;font-weight:600;text-decoration:none;">${escapeHtml(a.title)}</a>
          <div style="color:#9aa;font-size:13px;">${escapeHtml(a.body)}</div>
        </li>`,
    )
    .join("");
  const nicheLine = opts.niches?.length ? `New winners in ${escapeHtml(opts.niches.join(", "))}` : "New winning products";
  return `
    <div style="background:#0a0a12;padding:32px 16px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
      <div style="max-width:480px;margin:0 auto;">
        <h1 style="color:#fff;font-size:20px;margin-bottom:4px;">Good morning</h1>
        <p style="color:#9aa;font-size:13px;margin-bottom:20px;">${nicheLine}</p>
        ${winners.length ? `<table width="100%" cellpadding="0" cellspacing="0">${winners.map(row).join("")}</table>` : ""}
        ${alerts.length ? `<h2 style="color:#fff;font-size:16px;margin:24px 0 8px;">Your alerts</h2><ul style="padding-left:18px;margin:0;">${alertRows}</ul>` : ""}
        <a href="${escapeHtml(appUrl)}/dashboard/winners" style="display:inline-block;margin-top:20px;background:#1fbf6b;color:#0a0a12;padding:10px 18px;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none;">
          Open Winning Products
        </a>
        <p style="color:#666;font-size:11px;margin-top:24px;">
          You get this because you turned on the morning digest in AdSpy Pro.
          <a href="${escapeHtml(unsubscribeUrl)}" style="color:#888;">Unsubscribe</a> ·
          <a href="${escapeHtml(appUrl)}/dashboard/settings" style="color:#888;">Change your niches</a>
        </p>
      </div>
    </div>`;
}
