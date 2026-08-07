import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { getAccessToken } from "@/lib/api";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import "./PdfDocumentViewer.css";

// CDN worker avoids nginx serving hashed .mjs as application/octet-stream
// (browsers refuse to import workers with a non-JS MIME type).
pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type Props = {
  url: string;
  title?: string;
  allowCopy: boolean;
};

/**
 * Renders PDFs with pdf.js so text-layer selection can be enabled/disabled.
 * Native browser PDF iframes ignore parent select/copy handlers.
 */
export function PdfDocumentViewer({ url, title, allowCopy }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [width, setWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const token = getAccessToken();
  const file = token
    ? { url, httpHeaders: { Authorization: `Bearer ${token}` } }
    : url;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setNumPages(0);
    setError(null);
  }, [url]);

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
      ) : (
        <Document
          file={file}
          loading={
            <div className="h-full min-h-[200px] flex items-center justify-center text-sm text-muted-foreground">
              Loading PDF…
            </div>
          }
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          onLoadError={(err) => setError(err.message || "Failed to load PDF")}
          className="flex flex-col items-center gap-3 p-3"
        >
          {width > 0 &&
            Array.from({ length: numPages }, (_, i) => (
              <Page
                key={`page-${i + 1}`}
                pageNumber={i + 1}
                width={Math.min(width - 24, 900)}
                renderAnnotationLayer
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
