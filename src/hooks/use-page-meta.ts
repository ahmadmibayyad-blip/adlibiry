import { useEffect } from "react";

const SITE = "AdSpy Pro";

// Every route is served the same index.html, so without this each page has the
// homepage's <title> and description in the tab and in search results.
export function usePageMeta(title: string, description?: string) {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const before = { title: document.title, description: meta?.content };
    document.title = title.includes(SITE) ? title : `${title} — ${SITE}`;
    if (meta && description) meta.content = description;
    return () => {
      document.title = before.title;
      if (meta && before.description !== undefined) meta.content = before.description;
    };
  }, [title, description]);
}
