import React from 'react';

interface State { hasError: boolean }

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ConferenceGate application render error', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <section role="alert" className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
          <h1 className="text-2xl font-bold text-slate-900">ConferenceGate could not load this page</h1>
          <p className="mt-3 text-slate-600">An unexpected problem interrupted the page. Your account and saved information have not been changed by this message.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => window.location.reload()} className="rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800">Try again</button>
            <a href="/" className="rounded-lg border border-slate-300 px-5 py-3 font-semibold text-slate-800 hover:bg-slate-50">Go to home</a>
          </div>
        </section>
      </main>
    );
  }
}
