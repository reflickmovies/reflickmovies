import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Rendered instead of the children when a render throws. */
  fallback: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render errors so a single broken card cannot blank the whole page.
 *
 * There is deliberately no error-reporting side effect here: the app has no
 * telemetry backend, and quietly posting errors somewhere would be worse than
 * showing them honestly in the fallback.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Left to the host: replace with a real reporter when one exists.
    console.error('Render error', error, info.componentStack);
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error) return this.props.fallback(error, this.reset);

    return this.props.children;
  }
}