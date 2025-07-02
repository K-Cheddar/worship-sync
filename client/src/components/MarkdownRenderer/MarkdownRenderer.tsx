import { useMemo } from "react";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

const MarkdownRenderer = ({
  content,
  className = "",
}: MarkdownRendererProps) => {
  const renderedContent = useMemo(() => {
    if (!content) return "";

    return (
      content
        // Headers
        .replace(
          /^### (.*$)/gim,
          '<h3 class="text-lg font-semibold text-gray-200 mb-2">$1</h3>'
        )
        .replace(
          /^## (.*$)/gim,
          '<h2 class="text-xl font-bold text-white mb-4">$1</h2>'
        )
        .replace(
          /^# (.*$)/gim,
          '<h1 class="text-2xl font-bold text-white mb-6">$1</h1>'
        )

        // Bold and italic
        .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
        .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')

        // Links
        .replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" class="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer">$1</a>'
        )

        // Lists
        .replace(/^- (.*$)/gim, '<li class="text-gray-300 mb-1">$1</li>')
        .replace(
          /(<li.*<\/li>)/g,
          '<ul class="list-disc list-inside space-y-1 mb-4">$1</ul>'
        )

        // Paragraphs
        .replace(/\n\n/g, '</p><p class="text-gray-300 mb-4">')
        .replace(
          /^(?!<[h|u|p])(.*$)/gim,
          '<p class="text-gray-300 mb-4">$1</p>'
        )

        // Clean up empty paragraphs
        .replace(/<p class="text-gray-300 mb-4"><\/p>/g, "")
        .replace(/<p class="text-gray-300 mb-4">\s*<\/p>/g, "")

        // Clean up multiple consecutive line breaks
        .replace(/\n{3,}/g, "\n\n")

        // Remove leading/trailing whitespace
        .trim()
    );
  }, [content]);

  return (
    <div
      className={`markdown-content ${className}`}
      dangerouslySetInnerHTML={{ __html: renderedContent }}
    />
  );
};

export default MarkdownRenderer;
