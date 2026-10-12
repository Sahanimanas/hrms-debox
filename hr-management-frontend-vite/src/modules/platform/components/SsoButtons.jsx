import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useT } from '@/lib/i18n';
import { errorMessage, MS_SSO_STATE_KEY as MS_STATE_KEY } from '../lib';

const GSI_SRC = 'https://accounts.google.com/gsi/client';


let gsiPromise = null;
const loadGoogleScript = () => {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!gsiPromise) {
    gsiPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GSI_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gsiPromise = null;
        reject(new Error('Could not load Google Sign-In'));
      };
      document.head.appendChild(s);
    });
  }
  return gsiPromise;
};

/**
 * Initialise Google Identity Services with a fresh server nonce and render the
 * button into containerRef. Nonces are single-use, so a failed attempt sets up again.
 */
async function setupGoogle(clientId, containerRef, onResultRef) {
  try {
    const [{ data }] = await Promise.all([api.get('/auth/sso/nonce'), loadGoogleScript()]);
    const nonce = data.nonce;
    window.google.accounts.id.initialize({
      client_id: clientId,
      nonce,
      ux_mode: 'popup',
      callback: async ({ credential }) => {
        try {
          const r = await api.post('/auth/sso/google', { id_token: credential, nonce });
          onResultRef.current?.(r.data);
        } catch (error) {
          toast.error(errorMessage(error, 'Google sign-in failed'));
          setupGoogle(clientId, containerRef, onResultRef);
        }
      },
    });
    const el = containerRef.current;
    if (el) {
      el.innerHTML = '';
      window.google.accounts.id.renderButton(el, {
        theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: Math.min(el.offsetWidth || 320, 400),
      });
    }
  } catch (error) {
    console.error(error);
  }
}

const MicrosoftLogo = () => (
  <svg viewBox="0 0 21 21" className="w-4 h-4" aria-hidden="true">
    <rect x="1" y="1" width="9" height="9" fill="#f25022" />
    <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
    <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
    <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
  </svg>
);

/**
 * "Sign in with Google / Microsoft" (PL-4). Only configured providers are shown
 * (GET /auth/sso/config). `onResult(data)` receives the login response, which
 * may be { two_factor_required, challenge_token } or { access_token, user }.
 */
const SsoButtons = ({ onResult, disabled = false }) => {
  const t = useT();
  const [config, setConfig] = useState(null);
  const googleRef = useRef(null);
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  useEffect(() => {
    let alive = true;
    api.get('/auth/sso/config')
      .then(r => { if (alive) setConfig(r.data); })
      .catch(() => { if (alive) setConfig({ google: { enabled: false }, microsoft: { enabled: false } }); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (config?.google?.enabled) setupGoogle(config.google.client_id, googleRef, onResultRef);
  }, [config]);

  const startMicrosoft = async () => {
    try {
      const { data } = await api.get('/auth/sso/nonce');
      const state = crypto.getRandomValues(new Uint32Array(4)).join('-');
      sessionStorage.setItem(MS_STATE_KEY, JSON.stringify({ state, nonce: data.nonce, at: Date.now() }));
      const params = new URLSearchParams({
        client_id: config.microsoft.client_id,
        response_type: 'id_token',
        redirect_uri: `${window.location.origin}/sso/microsoft/callback`,
        response_mode: 'fragment',
        scope: 'openid profile email',
        nonce: data.nonce,
        state,
        prompt: 'select_account',
      });
      window.location.assign(`${config.microsoft.authorize_url}?${params}`);
    } catch (error) {
      toast.error(errorMessage(error, 'Could not start Microsoft sign-in'));
    }
  };

  if (!config || (!config.google?.enabled && !config.microsoft?.enabled)) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <div className="h-px flex-1 bg-slate-200" />
        <span>{t('or continue with')}</span>
        <div className="h-px flex-1 bg-slate-200" />
      </div>
      {config.google?.enabled && <div ref={googleRef} className="flex justify-center min-h-[44px]" aria-label="Sign in with Google" />}
      {config.microsoft?.enabled && (
        <button
          type="button"
          onClick={startMicrosoft}
          disabled={disabled}
          className="w-full flex items-center justify-center gap-2 h-10 rounded-full border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          <MicrosoftLogo /> {t('Sign in with Microsoft')}
        </button>
      )}
    </div>
  );
};

export default SsoButtons;
