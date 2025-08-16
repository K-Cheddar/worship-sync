import React, { Component, ErrorInfo, ReactNode } from "react";
import { ReactComponent as ErrorSVG } from "../../assets/icons/error.svg";
import Button from "../Button/Button";
import Icon from "../Icon/Icon";
import { logErrorToServer } from "../../api/logError";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  key: number;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, key: 0 };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, key: 0 };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    // Log error to server
    logErrorToServer({
      error,
      errorInfo,
      componentStack: errorInfo.componentStack || undefined,
      timestamp: Date.now(),
    }).catch((logError) => {
      // Silently fail if logging fails - we don't want to cause additional errors
      console.error("Failed to log error to server:", logError);
    });
  }

  handleComponentRefresh = () => {
    this.setState((prevState) => ({
      hasError: false,
      error: undefined,
      key: prevState.key + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className=" bg-white border border-red-200 rounded-lg p-2 flex flex-col justify-center items-center gap-2 h-fit w-fit text-center absolute top-0 left-0 right-0 bottom-0 m-auto">
          <Icon svg={ErrorSVG} size="lg" className="text-red-600" />
          <h3 className="text-sm font-medium text-red-800">
            Something went wrong!
          </h3>
          <Button className="text-sm" onClick={this.handleComponentRefresh}>
            Try again
          </Button>
        </div>
      );
    }

    return <div key={this.state.key}>{this.props.children}</div>;
  }
}

export default ErrorBoundary;
