import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Last-resort UI for unexpected render errors.
 *
 * Without this a single bad property (for example an API shape change) blanks
 * the whole app. Users get a clear explanation and a one-click way back.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the details in the console for debugging, not on screen.
    // eslint-disable-next-line no-console
    console.error("Unhandled UI error", error, info.componentStack);
  }

  private reload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-dvh items-center justify-center bg-ink-100 px-4 py-10">
        <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-surface p-6 text-center shadow-sm">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-warning-100 text-warning-700">
            <TriangleAlert className="size-7" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-xl font-bold tracking-tight text-ink-900">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            This page ran into an unexpected problem. Reloading usually fixes it — your data is
            safe.
          </p>
          <button
            type="button"
            onClick={this.reload}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            Reload the page
          </button>
          <p className="mt-4 break-words text-xs text-ink-400">{error.message}</p>
        </div>
      </div>
    );
  }
}
