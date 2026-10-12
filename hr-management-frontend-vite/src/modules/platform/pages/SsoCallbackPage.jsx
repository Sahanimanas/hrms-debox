import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import api from '@/lib/api';
import { setAuth } from '@/lib/auth';
import BrandLogo from '@/components/BrandLogo';
import { errorMessage, MS_SSO_STATE_KEY } from '../lib';
import { workspaceHome } from '@/lib/workspace';

/** Read the implicit-flow response from the URL fragment once. */
const readFragment = () => {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return {
    idToken: params.get('id_token'),
    state: params.get('state'),
    error: params.get('error_description') || params.get('error'),
  };
};

/**
 * Microsoft sign-in redirect target (/sso/microsoft/callback). Validates the
 * `state` we stored before redirecting, posts the ID token (+ nonce) to the
 * backend and continues like a normal login (including the 2FA step).
 */
const SsoCallbackPage = () => {
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const { idToken, state, error: providerError } = readFragment();
    // Remove the token from the address bar / history right away
    window.history.replaceState(null, '', window.location.pathname);

    let saved = null;
    try {
      saved = JSON.parse(sessionStorage.getItem(MS_SSO_STATE_KEY) || 'null');
    } catch {
      saved = null;
    }
    sessionStorage.removeItem(MS_SSO_STATE_KEY);

    const fail = (msg) => Promise.resolve().then(() => setError(msg));
    if (providerError) {
      fail(providerError);
      return;
    }
    if (!idToken || !saved || saved.state !== state || Date.now() - saved.at > 10 * 60 * 1000) {
      fail('This sign-in link is invalid or has expired. Please try again.');
      return;
    }
    api.post('/auth/sso/microsoft', { id_token: idToken, nonce: saved.nonce })
      .then(({ data }) => {
        if (data.two_factor_required) {
          navigate('/login', { replace: true, state: { twoFactor: { challenge_token: data.challenge_token } } });
          return;
        }
        setAuth(data.access_token, data.user);
        navigate(data.two_factor_setup_required ? '/security' : workspaceHome(), { replace: true });
      })
      .catch((err) => setError(errorMessage(err, 'Microsoft sign-in failed')));
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center">
        <BrandLogo size="md" tone="dark" className="justify-center mb-5" />
        {error ? (
          <>
            <div className="flex items-center justify-center gap-2 text-red-600 mb-2">
              <AlertCircle className="w-5 h-5" />
              <span className="font-medium">Sign-in failed</span>
            </div>
            <p className="text-sm text-slate-600">{error}</p>
            <Link to="/login" className="inline-block mt-5 px-5 py-2 rounded-full bg-slate-800 text-white text-sm hover:bg-slate-900">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <div className="animate-spin w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full mx-auto mb-3" />
            <p className="text-sm text-slate-600">Signing you in with Microsoft…</p>
          </>
        )}
      </div>
    </div>
  );
};

export default SsoCallbackPage;
