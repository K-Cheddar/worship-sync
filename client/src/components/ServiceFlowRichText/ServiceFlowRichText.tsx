import type { ServiceFlowRichText as ServiceFlowRichTextDocument } from "../../services/serviceFlowTypes";

const safeColor = (color: string | undefined) =>
  color && /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;

/** A fixed scale rather than an author-supplied font size, so notes stay
 * within the public page's type system. Base is the container's `text-sm`. */
const SIZE_CLASS = {
  small: "text-xs",
  normal: "",
  large: "text-base",
} as const;

/** Renders only structured text spans; it never receives or injects HTML. */
const ServiceFlowRichText = ({ document }: { document: ServiceFlowRichTextDocument }) => {
  if (!document.blocks.length) return null;

  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-slate-300">
      {document.blocks.map((block, blockIndex) => {
        const contents = block.spans.map((span, spanIndex) => (
          <span
            key={`${blockIndex}-${spanIndex}`}
            className={[
              span.bold ? "font-semibold" : "",
              span.italic ? "italic" : "",
              span.underline ? "underline underline-offset-2" : "",
            ].filter(Boolean).join(" ")}
            style={{ color: safeColor(span.color) }}
          >
            {span.text}
          </span>
        ));
        // Absent align/size mean the defaults, so nothing is emitted for them.
        const style = block.align ? { textAlign: block.align } : undefined;
        const sizeClass = SIZE_CLASS[block.size ?? "normal"];
        if (block.type === "list-item") {
          return (
            <p
              key={blockIndex}
              className={`pl-4 before:mr-2 before:content-['•'] ${sizeClass}`}
              style={style}
            >
              {contents}
            </p>
          );
        }
        return (
          <p
            key={blockIndex}
            className={`whitespace-pre-wrap ${sizeClass}`}
            style={style}
          >
            {contents}
          </p>
        );
      })}
    </div>
  );
};

export default ServiceFlowRichText;
