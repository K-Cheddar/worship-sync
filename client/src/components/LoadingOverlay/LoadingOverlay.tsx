import { ReactNode } from "react";
import Spinner from "../Spinner/Spinner";
import cn from "classnames";

type LoadingOverlayProps = {
  isLoading: boolean;
  children: ReactNode;
  className?: string;
};

const LoadingOverlay = ({
  isLoading,
  children,
  className,
}: LoadingOverlayProps) => (
  <div className={cn("relative", className, className?.includes("min-h-0") && "overflow-hidden")}>
    {children}
    {!!isLoading && (
      <div
        className="absolute inset-0 z-1 bg-gray-900/80 flex items-center justify-center"
        aria-hidden
      >
        <Spinner />
      </div>
    )}
  </div>
);

export default LoadingOverlay;
