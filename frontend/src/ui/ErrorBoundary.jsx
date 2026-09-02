// src/components/ui/ErrorBoundary.jsx
import React from "react";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(
    error
  ) {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error, info) {
    console.error(
      "Application Error:",
      error,
      info
    );

    // Sentry.captureException(error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: "50px",
            textAlign: "center",
          }}
        >
          <h2>
            Something went wrong.
          </h2>

          <pre>
            {this.state.error?.message}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;