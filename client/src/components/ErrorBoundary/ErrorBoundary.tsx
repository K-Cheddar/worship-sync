import React, { Component, ErrorInfo, ReactNode } from "react";
import { ReactComponent as ErrorSVG } from "../../assets/icons/error.svg";
import Button from "../Button/Button";
import Icon from "../Icon/Icon";

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

    // Return children directly without wrapping in a div to avoid height issues
    // Use React.Fragment to add the key prop without extra DOM nodes
    return (
      <React.Fragment key={this.state.key}>
        {this.props.children}
      </React.Fragment>
    );
  }
}

export default ErrorBoundary;
