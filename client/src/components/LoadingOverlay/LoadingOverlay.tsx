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
        className="absolute inset-0 z-1 flex items-center justify-center bg-homepage-canvas/90 ring-1 ring-inset ring-white/10"
        aria-hidden
      >
        <Spinner />
      </div>
    )}
  </div>
);

export default LoadingOverlay;
