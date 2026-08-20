import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode; fallback?: (error: Error, reset: () => void) => ReactNode };
type State = { error: Error | null };

/** There was no boundary anywhere: one thrown render replaced the entire app —
 * navigation included — with a blank page. Errors still reach the console. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("render error", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div className="mb-6 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
        <div className="text-sm font-semibold text-destructive">
          Something broke rendering this
        </div>
        <div className="mt-1 break-words text-xs text-muted-foreground">{error.message}</div>
        <button
          type="button"
          className="mt-3 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          onClick={this.reset}
        >
          Try again
        </button>
      </div>
    );
  }
}
