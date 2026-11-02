import type { ReactNode } from "react";
import { cn } from "../utils/cnHelper";

type Props = {
  label: string;
  compact: boolean;
  desktopHeader: ReactNode;
  desktopRows: () => ReactNode;
  mobileRows: () => ReactNode;
  minWidthClassName?: string;
  className?: string;
};

/** The Resources table/list shell shared by dense desktop and compact mobile data views. */
const ResponsiveDataTable = ({ label, compact, desktopHeader, desktopRows, mobileRows, minWidthClassName = "min-w-[48rem]", className }: Props) => compact ? (
  <div className={cn("flex min-h-0 flex-col overflow-hidden", className)}>
    <ul aria-label={label} className="min-h-0 flex-1 divide-y divide-gray-700 overflow-y-auto overflow-x-hidden">
      {mobileRows()}
    </ul>
  </div>
) : (
  <div className={cn("min-h-0 overflow-auto", className)}>
    <div className="rounded border border-gray-700">
      <table aria-label={label} className={cn("w-full table-fixed text-left text-sm", minWidthClassName)}>
        <thead className="sticky top-0 z-10 bg-gray-950 text-xs uppercase tracking-wide text-gray-400 shadow-sm shadow-black/20">{desktopHeader}</thead>
        <tbody className="divide-y divide-gray-700">{desktopRows()}</tbody>
      </table>
    </div>
  </div>
);

export default ResponsiveDataTable;

export type ResponsiveDataTableSkeletonColumn = {
  label: string;
  widthClassName?: string;
};

type SkeletonProps = {
  label: string;
  loadingLabel: string;
  compact: boolean;
  columns: readonly ResponsiveDataTableSkeletonColumn[];
  rowCount?: number;
  selectionColumn?: boolean;
  minWidthClassName?: string;
  className?: string;
};

/** Matching desktop and mobile placeholders for tables whose rows have not loaded. */
export const ResponsiveDataTableSkeleton = ({ label, loadingLabel, compact, columns, rowCount = 5, selectionColumn = false, minWidthClassName, className }: SkeletonProps) => (
  <div role="region" aria-label={loadingLabel} aria-busy="true" className={cn("min-h-0", className)}>
    <span role="status" className="sr-only">{loadingLabel}...</span>
    <ResponsiveDataTable
      label={label}
      compact={compact}
      minWidthClassName={minWidthClassName}
      desktopHeader={<tr>{columns.map(({ label: heading, widthClassName }, index) => <th key={`${heading}-${index}`} scope="col" className={cn("px-4 py-1.5", widthClassName)}>{selectionColumn && index === 0 ? <span aria-hidden="true" className="inline-block size-5 animate-pulse rounded border border-gray-700 bg-gray-800" /> : heading}</th>)}</tr>}
      desktopRows={() => <>{Array.from({ length: rowCount }, (_, rowIndex) => <tr key={rowIndex} className="bg-gray-900/40">{columns.map((column, columnIndex) => <td key={`${column.label}-${columnIndex}`} className="px-4 py-2">{selectionColumn && columnIndex === 0 ? <div aria-hidden="true" className="size-5 animate-pulse rounded border border-gray-700 bg-gray-800" /> : <div aria-hidden="true" className={cn("h-4 animate-pulse rounded bg-gray-700", columnIndex === (selectionColumn ? 1 : 0) ? rowIndex % 2 ? "w-2/3" : "w-4/5" : "w-3/4")} />}</td>)}</tr>)}</>}
      mobileRows={() => <>{Array.from({ length: rowCount }, (_, index) => <li key={index} className="flex min-h-[44px] items-center gap-2 px-3"><div aria-hidden="true" className="size-5 shrink-0 animate-pulse rounded bg-gray-700" /><div className="min-w-0 flex-1 space-y-2"><div aria-hidden="true" className="h-4 w-4/5 animate-pulse rounded bg-gray-700" /><div aria-hidden="true" className="h-3 w-3/5 animate-pulse rounded bg-gray-800" /></div><div aria-hidden="true" className="h-3 w-16 animate-pulse rounded bg-gray-800" /></li>)}</>}
    />
  </div>
);
