import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-slate-50 p-6 text-center animate-in fade-in duration-300">
            <div className="max-w-md w-full rounded-2xl bg-white p-8 shadow-xl border border-slate-200 ring-4 ring-red-50">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 shadow-inner">
                    <svg className="h-8 w-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                </div>
                <h1 className="mb-2 text-2xl font-bold text-slate-800">System Error</h1>
                <p className="mb-6 text-slate-600 text-sm leading-relaxed">
                    The application encountered an unexpected critical error. To protect your session, the interface has been paused.
                </p>
                
                <div className="rounded-lg bg-slate-100 p-4 text-left font-mono text-[10px] text-slate-500 mb-6 overflow-auto max-h-32 border border-slate-200 shadow-inner">
                    {this.state.error?.message || "Unknown Error"}
                </div>
                
                <button
                    onClick={() => window.location.reload()}
                    className="w-full rounded-xl bg-blue-600 px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-500/30 hover:bg-blue-700 transition-all active:scale-[0.98]"
                >
                    Reload Application
                </button>
            </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;