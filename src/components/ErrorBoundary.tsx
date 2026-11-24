import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Erreur inattendue.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-red-200 bg-white p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5 text-red-700">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <h2 className="font-display text-base font-semibold">
                Erreur de synchronisation ou de droits
              </h2>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Une erreur est survenue lors de l’accès sécurisé aux données. Rechargez l’application ou reconnectez-vous avec votre compte Google.
            </p>
            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-xs font-mono-num text-slate-600 break-all max-h-28 overflow-auto">
              {this.state.message}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Recharger l’application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
