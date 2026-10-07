import { useEffect, useRef } from "react";
import { getSafeHttpUrl } from "./contentPreview";

type DocxPreviewProps = {
  url: string;
  onReady: () => void;
  onError: () => void;
};

/** Private documents stay in the client; Word styles stay inside this preview. */
const DocxPreview = ({ url, onReady, onError }: DocxPreviewProps) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onReady, onError });
  useEffect(() => { callbacks.current = { onReady, onError }; }, [onReady, onError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const root = host.shadowRoot || host.attachShadow({ mode: "open" });
    const container = host.ownerDocument.createElement("div");
    root.replaceChildren(container);
    const controller = new AbortController();
    let active = true;

    void (async () => {
      try {
        const [response, { renderAsync }] = await Promise.all([
          fetch(url, { signal: controller.signal, credentials: "omit", referrerPolicy: "no-referrer" }),
          import("docx-preview"),
        ]);
        if (!response.ok) throw new Error("Document fetch failed");
        const data = await response.arrayBuffer();
        if (!active) return;
        await renderAsync(data, container, container, {
          // Data URLs avoid renderer-owned object URLs surviving close/switch.
          useBase64URL: true,
          renderAltChunks: false,
          ignoreWidth: true,
          className: "ws-docx",
        });
        if (active) {
          container.querySelectorAll("a").forEach((link) => {
            const href = link.getAttribute("href") || "";
            if (href.startsWith("#")) return;
            if (!getSafeHttpUrl(href)) link.removeAttribute("href");
            else {
              link.target = "_blank";
              link.rel = "noopener noreferrer";
              link.referrerPolicy = "no-referrer";
            }
          });
          const style = host.ownerDocument.createElement("style");
          style.textContent = ".ws-docx-wrapper { padding: 16px; } section.ws-docx { max-width: 100%; box-sizing: border-box; } @media (max-width: 640px) { section.ws-docx { padding: 24px !important; } }";
          root.append(style);
          callbacks.current.onReady();
        }
      } catch {
        if (active) callbacks.current.onError();
      }
    })();

    return () => {
      active = false;
      controller.abort();
      // Late rendering can only touch its detached, previous container.
      root.replaceChildren();
    };
  }, [url]);

  return <div ref={hostRef} role="document" aria-label="Word document preview" className="h-full w-full overflow-auto bg-white text-black" />;
};

export default DocxPreview;
