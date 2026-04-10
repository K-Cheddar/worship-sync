const ROW_COUNT = 6;

/**
 * Placeholder rows while the service outline list is loading.
 */
const ServiceOutlineSkeleton = () => (
  <div
    className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden px-2 pb-2 pt-1"
    role="status"
    aria-live="polite"
    aria-busy="true"
    aria-label="Loading outline"
  >
    <ul className="flex flex-col">
      {Array.from({ length: ROW_COUNT }, (_, i) => (
        <li key={i} className="border-b border-white/10 py-2">
          <div className="h-9 w-full animate-pulse rounded-md bg-white/10" />
        </li>
      ))}
    </ul>
  </div>
);

export default ServiceOutlineSkeleton;
