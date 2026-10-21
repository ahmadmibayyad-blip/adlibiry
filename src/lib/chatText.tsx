import { Fragment, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { linkify } from "./linkify.tsx";

// AI answers in the chat panel: the model writes markdown even when asked not to, and the
// panel shows plain text. This reads the bits it uses: [name](link) becomes a link named
// after the product, **bold** turns bold, "### heading" a bold line, and table rows become
// "a · b · c" lines (the |---| line goes). Everything else goes through linkify.
export function chatText(text: string): ReactNode[] {
  const lines = text
    .split("\n")
    .filter((l) => !/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l))
    .map((l) => {
      const row = l.match(/^\s*\|(.*)\|\s*$/);
      if (row) return row[1].split("|").map((c) => c.trim()).filter((c) => c && c !== "—" && c !== "-").join(" · ");
      const heading = l.match(/^\s*#{1,6}\s+(.*)$/);
      return heading ? `**${heading[1].replace(/\*\*/g, "")}**` : l;
    });
  return inline(lines.join("\n"));
}

function inline(text: string): ReactNode[] {
  return text.split(/(\[[^\]\n]+\]\([^)\s]+\)|\*\*[^*\n]+\*\*)/g).map((part, i) => {
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) {
      const [, label, href] = link;
      const name = label.replace(/\*\*/g, "");
      if (href.startsWith("/dashboard/")) {
        return (
          <Link key={i} to={href} className="underline text-primary">
            {name}
          </Link>
        );
      }
      if (/^https?:\/\//.test(href)) {
        return (
          <a key={i} href={href} target="_blank" rel="noreferrer" className="underline text-primary">
            {name}
          </a>
        );
      }
      return name;
    }
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={i}>{inline(bold[1])}</strong>;
    return <Fragment key={i}>{linkify(part)}</Fragment>;
  });
}
