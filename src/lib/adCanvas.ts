// Laying out an ad's text on its picture (AdImages.tsx): the hook as large as
// it fits in a few lines, the headline on one line. Measuring is passed in, so
// this works with a canvas and in tests.

export type Measure = (text: string, size: number) => number;

/** Words into lines no wider than maxWidth; a single too-long word gets a line of its own. */
export function wrapLines(text: string, size: number, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** The largest size (max → min, in steps of 2) at which the text fits in maxLines; at min, the extra lines are cut with "…". */
export function fitText(text: string, o: { max: number; min: number; maxWidth: number; maxLines: number }, measure: Measure): { size: number; lines: string[] } {
  for (let size = o.max; size >= o.min; size -= 2) {
    const lines = wrapLines(text, size, o.maxWidth, measure);
    if (lines.length <= o.maxLines && lines.every((l) => measure(l, size) <= o.maxWidth)) return { size, lines };
  }
  const lines = wrapLines(text, o.min, o.maxWidth, measure);
  if (lines.length <= o.maxLines) return { size: o.min, lines };
  const kept = lines.slice(0, o.maxLines);
  let last = kept[o.maxLines - 1];
  while (last.includes(" ") && measure(`${last}…`, o.min) > o.maxWidth) last = last.slice(0, last.lastIndexOf(" "));
  kept[o.maxLines - 1] = `${last}…`;
  return { size: o.min, lines: kept };
}

export const AD_WIDTH = 1080;
export const AD_HEIGHT = 1350;
const FONT = '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif';

/** Draws the ad: the picture filling the frame, a dark fade under the hook at the top, the headline as a button at the bottom. */
export function drawAd(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, text: { hook: string; headline: string }) {
  const W = AD_WIDTH;
  const H = AD_HEIGHT;
  const scale = Math.max(W / img.width, H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);

  const top = ctx.createLinearGradient(0, 0, 0, H * 0.6);
  top.addColorStop(0, "rgba(0,0,0,0.78)");
  top.addColorStop(0.45, "rgba(0,0,0,0.35)");
  top.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.6);
  const bottom = ctx.createLinearGradient(0, H * 0.78, 0, H);
  bottom.addColorStop(0, "rgba(0,0,0,0)");
  bottom.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, H * 0.78, W, H * 0.22);

  const measure: Measure = (t, size) => {
    ctx.font = `700 ${size}px ${FONT}`;
    return ctx.measureText(t).width;
  };
  const hook = fitText(text.hook, { max: 84, min: 46, maxWidth: W - 120, maxLines: 4 }, measure);
  ctx.font = `700 ${hook.size}px ${FONT}`;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 12;
  hook.lines.forEach((line, i) => ctx.fillText(line, 60, 76 + i * hook.size * 1.16));
  ctx.shadowBlur = 0;

  if (text.headline.trim()) {
    const cta = fitText(text.headline, { max: 40, min: 28, maxWidth: W - 240, maxLines: 1 }, measure);
    ctx.font = `700 ${cta.size}px ${FONT}`;
    const tw = ctx.measureText(cta.lines[0]).width;
    const bw = tw + 96;
    const bh = cta.size + 48;
    const bx = (W - bw) / 2;
    const by = H - 84 - bh;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, bh / 2);
    ctx.fill();
    ctx.fillStyle = "#111111";
    ctx.textBaseline = "middle";
    ctx.fillText(cta.lines[0], bx + 48, by + bh / 2 + 1);
  }
}
