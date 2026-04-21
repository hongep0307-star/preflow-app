import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

interface Props {
  /** Label shown in the error UI (e.g. "Brief tab"). */
  label?: string;
  /** Render override when an error has been caught. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Reset boundary state when this key changes (e.g. tab id, project id). */
  resetKey?: string | number;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", this.props.label ?? "(unlabeled)", error, info);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div
        role="alert"
        className="flex flex-col items-center justify-center h-full min-h-[240px] gap-3 px-6 text-center"
      >
        <AlertTriangle className="w-8 h-8 text-destructive" strokeWidth={1.5} />
        <div>
          <div className="text-[13px] font-semibold text-foreground">
            Something went wrong
            {this.props.label ? ` in ${this.props.label}` : ""}.
          </div>
          <div className="mt-1 text-[12px] text-muted-foreground max-w-md break-words">
            {error.message || "Unknown error"}
          </div>
        </div>
        <button
          onClick={this.reset}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-mono uppercase tracking-wide border border-border hover:border-primary/40 hover:text-primary transition-colors"
          style={{ borderRadius: 0 }}
        >
          <RotateCw className="w-3 h-3" />
          Retry
        </button>
      </div>
    );
  }
}
