import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { Lock, ShieldCheck, Smartphone, Monitor, Globe } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { PWAInstallButton } from './PWAStatus';

export function AuthGate({ errorMessage }: { errorMessage?: string | null }) {
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(errorMessage || null);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Impossible d’ouvrir la connexion Google.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-xs space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700">
              <ShieldCheck className="h-4 w-4" />
              Accès privé &amp; synchronisé
            </div>
            <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-slate-900">
              Suivi PAC
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Connectez votre compte Google pour synchroniser vos données entre votre PC, le Web et votre smartphone Android 16.
            </p>
          </div>
          <div className="h-11 w-11 rounded-xl bg-teal-700 text-white flex items-center justify-center shrink-0">
            <Lock className="h-5 w-5" />
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5 text-xs text-slate-600">
          <div className="flex items-center gap-2.5">
            <Monitor className="h-4 w-4 text-teal-700 shrink-0" />
            <span>
              <strong className="text-slate-900">PC :</strong> saisie quotidienne, import/export Excel et paramètres.
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <Globe className="h-4 w-4 text-teal-700 shrink-0" />
            <span>
              <strong className="text-slate-900">Web &amp; Android 16 :</strong> visualisation temps réel en lecture seule.
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <Smartphone className="h-4 w-4 text-teal-700 shrink-0" />
            <span>
              <strong className="text-slate-900">Isolation stricte :</strong> vos relevés et factures restent privés sur votre compte vérifié.
            </span>
          </div>
        </div>

        {authError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
            {authError}
          </div>
        )}

        <div className="space-y-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => void handleGoogleLogin()}
            className="w-full h-11 inline-flex items-center justify-center gap-2.5 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#EA4335"
                d="M12 10.2v3.9h5.4c-.2 1.3-1.5 3.9-5.4 3.9-3.2 0-5.9-2.7-5.9-6s2.7-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.4 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.9 9.1-9.3 0-.6-.1-1.1-.2-1.6H12z"
              />
            </svg>
            <span>{loading ? 'Connexion en cours…' : 'Se connecter avec Google'}</span>
          </button>

          <div className="flex justify-center">
            <PWAInstallButton />
          </div>
        </div>
      </div>
    </div>
  );
}
