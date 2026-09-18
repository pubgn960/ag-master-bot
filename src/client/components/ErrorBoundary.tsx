import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }


  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in UI component:', error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };


  public render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 rounded-xl border border-rose-900/60 bg-rose-950/20 text-slate-200">
          <div className="flex items-center gap-3 text-rose-400 mb-3">
            <AlertTriangle className="w-6 h-6 shrink-0" />
            <h2 className="text-base font-semibold">
              {this.props.fallbackTitle || 'Component Error Occurred'}
            </h2>
          </div>
          <p className="text-xs text-rose-300/90 mb-4 font-mono bg-rose-950/40 p-3 rounded border border-rose-900/40 overflow-x-auto">
            {this.state.error?.message || 'An unexpected runtime error occurred.'}
          </p>
          <button
            onClick={this.handleRetry}
            className="flex items-center gap-2 px-3.5 py-1.5 bg-rose-900/40 hover:bg-rose-900/60 border border-rose-700/60 text-rose-200 text-xs font-semibold rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry View
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
