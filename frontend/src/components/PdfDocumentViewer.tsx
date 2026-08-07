import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { getAccessToken } from "@/lib/api";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "./PdfDocumentViewer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type Props = {
  /** Same-origin /api/uploads/content/?path=... URL (or any fetchable URL). */
  url: string;
  title?: string;
  allowCopy: boolean;
};

/**
 * Fetch PDF once into a blob URL, then render with pdf.js.
 * Avoids: S3 CORS, nginx .mjs MIME issues, and react-pdf re-fetch loops
 * caused by a new `{ url, httpHeaders }` object every render.
 */
export function PdfDocumentViewer({ url, title, allowCopy }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(true);

  // Measure once; ResizeObserver updates width without remounting Document.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = Math.floor(el.clientWidth);
      setWidth((prev) => (prev === w ? prev : w));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Single fetch per url — stable blob URL for <Document file={...} />.
  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();

    const revoke = () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };

    setLoadingFile(true);
    setError(null);
    setNumPages(0);
    setBlobUrl(null);
    revoke();

    (async () => {
      try {
        const token = getAccessToken();
        const res = await fetch(url, {
          signal: ac.signal,
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!res.ok) {
          throw new Error(`Failed to load PDF (${res.status})`);
        }
        const blob = await res.blob();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        blobUrlRef.current = objectUrl;
        setBlobUrl(objectUrl);
      } catch (e) {
        if (cancelled || (e instanceof DOMException && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : "Failed to load PDF");
      } finally {
        if (!cancelled) setLoadingFile(false);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
      revoke();
    };
  }, [url]);

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
  }, []);

  const onLoadError = useCallback((err: Error) => {
    setError(err.message || "Failed to load PDF");
  }, []);

  return (
    <div
      ref={containerRef}
      className={`h-full w-full overflow-auto ${
        allowCopy ? "select-text pdf-viewer-copyable" : "select-none pdf-viewer-protected"
      }`}
      onContextMenu={(e) => {
        if (!allowCopy) e.preventDefault();
      }}
      onCopy={(e) => {
        if (!allowCopy) e.preventDefault();
      }}
      onCut={(e) => {
        if (!allowCopy) e.preventDefault();
      }}
    >
      {error ? (
        <div className="h-full flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
          <p>Could not render PDF preview.</p>
          <p className="text-xs">{error}</p>
        </div>
      ) : loadingFile || !blobUrl ? (
        <div className="h-full min-h-[200px] flex items-center justify-center text-sm text-muted-foreground">
          Loading PDF…
        </div>
      ) : (
        <Document
          file={blobUrl}
          loading={
            <div className="h-full min-h-[200px] flex items-center justify-center text-sm text-muted-foreground">
              Rendering…
            </div>
          }
          onLoadSuccess={onLoadSuccess}
          onLoadError={onLoadError}
          className="flex flex-col items-center gap-3 p-3"
        >
          {width > 0 &&
            Array.from({ length: numPages }, (_, i) => (
              <Page
                key={`page-${i + 1}`}
                pageNumber={i + 1}
                width={Math.min(width - 24, 900)}
                renderAnnotationLayer={false}
                renderTextLayer
                className="shadow-sm bg-white"
                loading=""
                aria-label={title ? `${title} page ${i + 1}` : `Page ${i + 1}`}
              />
            ))}
        </Document>
      )}
    </div>
  );
}
