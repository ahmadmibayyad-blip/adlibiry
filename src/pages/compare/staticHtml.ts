// The built page (index.html / app.html) with one comparison written in: its
// <title>, description, canonical link and the text inside #root, so crawlers
// see it without JavaScript. React replaces #root when the app starts.
// Used by vite.config.ts at build time; no "@/" imports here.
import { CHECKED, type ComparePage } from "./content.ts";

export const SITE_URL = "https://adspypro.net";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function compareMarkup(p: ComparePage): string {
  const rows = p.rows
    .map((r) => `<tr><th scope="row">${esc(r.feature)}</th><td>${esc(r.us)}</td><td>${esc(r.them)}</td></tr>`)
    .join("");
  const list = (items: string[]) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  return (
    `<main><article>` +
    `<h1>${esc(p.title)}</h1><p>${esc(p.intro)}</p>` +
    `<table><thead><tr><th></th><th>AdSpy Pro</th><th>${esc(p.name)}</th></tr></thead><tbody>${rows}</tbody></table>` +
    `<h2>Where ${esc(p.name)} is stronger</h2>${list(p.theyWin)}` +
    `<h2>Where AdSpy Pro is stronger</h2>${list(p.weWin)}` +
    `<h2>Which one should you pick?</h2><p>${esc(p.pickThem)}</p><p>${esc(p.pickUs)}</p>` +
    `<p><a href="/login">Try AdSpy Pro free for 7 days, no card</a></p>` +
    `<p>Checked on ${esc(CHECKED)} from ${esc(p.sources.join(", "))}. Prices and features change; check their site for the latest.</p>` +
    `</article></main>`
  );
}

/** The shell page with this comparison written in; the shell unchanged if it isn't the expected page. */
export function compareHtml(shell: string, p: ComparePage): string {
  if (!shell.includes('<div id="root"></div>')) return shell;
  const url = `${SITE_URL}/vs/${p.slug}`;
  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${esc(p.description)}" />`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${esc(p.title)}" />`)
    .replace("</head>", `<link rel="canonical" href="${url}" /></head>`)
    .replace('<div id="root"></div>', `<div id="root">${compareMarkup(p)}</div>`);
}
