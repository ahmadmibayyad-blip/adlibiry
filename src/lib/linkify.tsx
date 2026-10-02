import type { ReactNode } from "react";
import { Link } from "react-router-dom";

// Turns /dashboard/... paths into in-app links and http(s) URLs into external
// links; everything else stays plain text.
export function linkify(text: string): ReactNode[] {
  const parts = text.split(/(https?:\/\/[^\s)]+|\/dashboard\/[\w\-/]*)/g);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer" className="underline text-primary break-all">
          {part}
        </a>
      );
    }
    if (part.startsWith("/dashboard/")) {
      return (
        <Link key={i} to={part.replace(/[.,]+$/, "")} className="underline text-primary">
          {part}
        </Link>
      );
    }
    return part;
  });
}
