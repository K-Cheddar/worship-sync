import React from "react";

interface SectionProps {
  title: string;
  children: React.ReactNode;
  shouldShow?: boolean;
}

const Section: React.FC<SectionProps> = ({
  title,
  children,
  shouldShow = true,
}) => {
  if (!shouldShow) return null;

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white border-b border-gray-700 pb-2">
        {title}
      </h3>
      <div className="flex flex-wrap gap-4">{children}</div>
    </div>
  );
};

export default Section;
