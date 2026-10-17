import React from 'react';
import { AlertTriangle, RotateCw, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ds';

/**
 * Catches render errors so one broken page can't blank the whole app.
 * Give it a `resetKey` (e.g. the route path) to clear the error on navigation.
 * `fullScreen` is the last-resort variant used around the whole router.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  goBack = () => {
    this.setState({ error: null });
    if (window.history.length > 1) window.history.back();
    else window.location.assign('/');
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className={this.props.fullScreen ? 'flex min-h-screen items-center justify-center bg-canvas p-4' : 'flex justify-center p-4 md:p-8'}>
        <section role="alert" className="w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-xs text-center">
          <IconTile icon={AlertTriangle} tone="danger" size="lg" className="mx-auto mb-4" />
          <h2 className="font-display text-base font-semibold leading-6 text-ink">Something went wrong</h2>
          <p className="mt-1 text-sm text-ink-secondary">
            This page ran into a problem and couldn&apos;t be shown. The rest of the app still works — go back or reload to try again.
          </p>
          {import.meta.env.DEV && error?.message && (
            <p className="mt-3 break-words rounded-md bg-subtle px-3 py-2 text-left font-mono text-xs text-ink-secondary">{error.message}</p>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="outline" onClick={this.goBack} className="gap-2">
              <ArrowLeft className="h-4 w-4" /> Go back
            </Button>
            <Button onClick={() => window.location.reload()} className="gap-2">
              <RotateCw className="h-4 w-4" /> Reload page
            </Button>
          </div>
        </section>
      </div>
    );
  }
}
