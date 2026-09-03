import { useEffect } from "react";

const BASE = "Clean on the Go Hub";

/** Set `document.title` to "Page — Clean on the Go Hub". Resets on unmount. */
export function useDocumentTitle(page?: string) {
  useEffect(() => {
    document.title = page ? `${page} — ${BASE}` : BASE;
    return () => {
      document.title = BASE;
    };
  }, [page]);
}
