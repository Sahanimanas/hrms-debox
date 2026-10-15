import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Lock, Mail, ShieldCheck, User } from 'lucide-react';
import api from '@/lib/api';
import { setAuth, isAuthenticated } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { AuthAlert, AuthField, AuthLayout, AuthTitle, PasswordToggle } from '@/components/AuthLayout';
import SsoButtons from '@/modules/platform/components/SsoButtons';
import LanguageSwitcher from '@/modules/platform/components/LanguageSwitcher';
import WorkspaceChooser from '@/components/WorkspaceChooser';
import { WORKSPACES, getWorkspace, setWorkspace, workspaceHome } from '@/lib/workspace';
import PhoneInput from '@/components/PhoneInput';
import { phoneError } from '@/lib/phone';
import PasswordRules from '@/components/PasswordRules';
import { passwordPolicyMessage } from '@/lib/password';
import { apiFieldErrors } from '@/lib/apiError';

// Message left by the API client when a session ended (e.g. account deactivated)
const readNotice = () => {
  try {
    const notice = sessionStorage.getItem('login-notice');
    sessionStorage.removeItem('login-notice');
    return notice;
  } catch {
    return null;
  }
};

// Default sign-in for both Xeno HR and Xeno PM (one shared account). Development
// builds only, so credentials never ship in a production bundle; values come
// from VITE_DEFAULT_LOGIN_* (.env.development.local), else the seedAdmin.js admin.
const DEFAULT_LOGIN = import.meta.env.DEV
  ? {
    email: import.meta.env.VITE_DEFAULT_LOGIN_EMAIL || 'admin@debox.com',
    password: import.meta.env.VITE_DEFAULT_LOGIN_PASSWORD || 'Admin@123',
  }
  : { email: '', password: '' };

// Workspace preselected by a deep link (/login?app=pm); otherwise the user picks one first
const readAppParam = () => {
  const app = new URLSearchParams(window.location.search).get('app');
  return WORKSPACES[app] ? app : null;
};

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const [workspace, setChosenWorkspace] = useState(readAppParam);
  const [lastUsed] = useState(getWorkspace);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [notice] = useState(readNotice);
  // Login / Register tab (/login?tab=register opens the register form)
  const [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).get('tab') === 'register' ? 'register' : 'login'));

  // Two-factor step (PL-3): { challenge_token } after a password or SSO sign-in
  const [twoFactor, setTwoFactor] = useState(() => location.state?.twoFactor || null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');

  // Login form state
  const [loginForm, setLoginForm] = useState(DEFAULT_LOGIN);

  // Login error state
  const [loginErrors, setLoginErrors] = useState({
    email: '',
    password: '',
    general: '',
  });

  // Register form state
  const [registerForm, setRegisterForm] = useState({
    email: '',
    password: '',
    full_name: '',
    role: 'employee',
    department: '',
    designation: '',
    phone: '',
    manager_email: '',
  });

  // Register error state
  const [registerErrors, setRegisterErrors] = useState({
    email: '',
    password: '',
    general: '',
  });

  useEffect(() => {
    if (isAuthenticated()) {
      navigate(workspaceHome());
    }
  }, [navigate]);

  // Clear login errors when form changes
  const handleLoginChange = (field, value) => {
    setLoginForm({ ...loginForm, [field]: value });
    // Clear related error when user starts typing
    if (loginErrors[field] || loginErrors.general) {
      setLoginErrors({ ...loginErrors, [field]: '', general: '' });
    }
  };

  // Clear register errors when form changes
  const handleRegisterChange = (field, value) => {
    setRegisterForm({ ...registerForm, [field]: value });
    if (registerErrors[field] || registerErrors.general) {
      setRegisterErrors({ ...registerErrors, [field]: '', general: '' });
    }
  };

  // Remembered right away so an SSO round-trip lands in the chosen app too
  const chooseWorkspace = (key) => {
    setWorkspace(key);
    setChosenWorkspace(key);
  };

  // Password, SSO and 2FA all end here with the backend's login response
  const handleLoginResult = (data) => {
    if (data?.two_factor_required) {
      setTwoFactor({ challenge_token: data.challenge_token });
      setCode('');
      setCodeError('');
      return;
    }
    setAuth(data.access_token, data.user);
    toast.success(t('Login successful!'));
    navigate(data.two_factor_setup_required ? '/security' : workspaceHome(workspace || getWorkspace()));
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    if (!code.trim()) {
      setCodeError(t('Verification code'));
      return;
    }
    setLoading(true);
    setCodeError('');
    try {
      const response = await api.post('/auth/2fa/verify', { challenge_token: twoFactor.challenge_token, code: code.trim() });
      handleLoginResult(response.data);
    } catch (error) {
      const data = error.response?.data;
      if (data?.error_code === 'INVALID_2FA_CODE') {
        setCodeError(`${data.detail}${typeof data.attempts_left === 'number' ? ` (${data.attempts_left} attempts left)` : ''}`);
      } else {
        // Expired / locked challenge: start again
        toast.error(data?.detail || 'Verification failed');
        setTwoFactor(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setLoginErrors({ email: '', password: '', general: '' });

    try {
      const response = await api.post('/auth/login', loginForm);
      handleLoginResult(response.data);
    } catch (error) {
      const errorData = error.response?.data;
      const errorCode = errorData?.error_code;
      const errorMessage = errorData?.detail || 'Login failed';

      // Handle specific error codes
      if (errorCode === 'USER_NOT_FOUND') {
        setLoginErrors({
          email: 'No account found with this email',
          password: '',
          general: '',
        });
      } else if (errorCode === 'INVALID_PASSWORD') {
        setLoginErrors({
          email: '',
          password: 'Incorrect password. Please try again.',
          general: '',
        });
      } else {
        // Generic error
        setLoginErrors({
          email: '',
          password: '',
          general: errorMessage,
        });
        toast.error(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    const phoneProblem = phoneError(registerForm.phone);
    const passwordProblem = passwordPolicyMessage(registerForm.password);
    if (phoneProblem || passwordProblem) {
      setRegisterErrors({ email: '', password: passwordProblem ? 'Choose a password that meets every rule below' : '', general: '', phone: phoneProblem || '' });
      return;
    }
    setLoading(true);
    setRegisterErrors({ email: '', password: '', general: '' });

    try {
      const response = await api.post('/auth/register', registerForm);
      const { access_token, user } = response.data;
      setAuth(access_token, user);
      toast.success('Registration successful!');
      navigate(workspaceHome(workspace));
    } catch (error) {
      const errorData = error.response?.data;
      let errorMessage = 'Registration failed';

      if (errorData?.detail) {
        const detail = errorData.detail;

        // Check for email already registered
        if (typeof detail === 'string' && detail.toLowerCase().includes('email already')) {
          setRegisterErrors({
            email: 'This email is already registered',
            password: '',
            general: '',
          });
          return;
        }

        // Per-field validation errors from the API (422)
        const fieldErrors = apiFieldErrors(error);
        if (Object.keys(fieldErrors).length) {
          const { email = '', password = '', phone = '', ...rest } = fieldErrors;
          setRegisterErrors({ email, password, phone, general: Object.values(rest).join(' · ') });
          return;
        }

        // Handle array of validation errors
        if (Array.isArray(detail)) {
          const errors = detail.map(err => {
            if (typeof err === 'object' && err.msg) {
              return `${err.loc ? err.loc[err.loc.length - 1] : 'Field'}: ${err.msg}`;
            }
            return String(err);
          });
          errorMessage = errors.join('; ');
        } else if (typeof detail === 'string') {
          errorMessage = detail;
        } else if (typeof detail === 'object') {
          errorMessage = JSON.stringify(detail);
        }
      }

      setRegisterErrors({
        email: '',
        password: '',
        general: errorMessage,
      });
      toast.error(errorMessage);
      console.error('Registration error:', error.response?.data);
    } finally {
      setLoading(false);
    }
  };

  const workspaceInfo = workspace ? WORKSPACES[workspace] : null;
  const productName = workspaceInfo ? `Xeno-${workspaceInfo.suffix}` : 'Xeno';

  // Back link (password step only) + language picker, above the form
  const topBar = (
    <div className="flex items-center justify-between gap-3">
      {workspace && !twoFactor ? (
        <button
          type="button"
          data-testid="change-workspace-btn"
          onClick={() => setChosenWorkspace(null)}
          className="flex min-w-0 items-center gap-1 rounded-sm text-[13px] font-medium leading-[18px] text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span className="truncate">{t('All workspaces')}</span>
        </button>
      ) : <span />}
      <LanguageSwitcher tone="light" className="w-28 shrink-0" />
    </div>
  );

  return (
    <AuthLayout product={workspace || 'hr'} topBar={topBar}>
      {notice && !twoFactor && <AuthAlert tone="warning">{notice}</AuthAlert>}

      {twoFactor ? (
        <form onSubmit={handleVerify} className="flex flex-col gap-5" data-testid="two-factor-form">
          <span className="flex h-11 w-11 items-center justify-center rounded-md bg-navy text-brand">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <AuthTitle
            title={t('Two-factor verification')}
            subtitle={t('Enter the 6-digit code from your authenticator app, or one of your backup codes.')}
          />
          <AuthField
            id="two-factor-code"
            data-testid="two-factor-code-input"
            label={t('Verification code')}
            value={code}
            onChange={(e) => { setCode(e.target.value); setCodeError(''); }}
            autoComplete="one-time-code"
            inputMode="text"
            autoFocus
            maxLength={32}
            placeholder="123456"
            error={codeError}
            className="h-12 text-center text-lg tracking-[0.3em] md:text-lg"
          />
          <Button type="submit" variant="dark" data-testid="two-factor-submit-btn" className="w-full" disabled={loading}>
            {loading ? t('Verifying...') : <>{t('Verify')} <ArrowRight /></>}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setTwoFactor(null)} className="w-full font-medium">
            <ArrowLeft /> {t('Back to sign in')}
          </Button>
        </form>
      ) : !workspace ? (
        <WorkspaceChooser onChoose={chooseWorkspace} lastUsed={lastUsed} />
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="flex w-full flex-col gap-5">
          {tab === 'register' ? (
            <AuthTitle
              title={t('Create your account')}
              subtitle={t('Join your team on {name}.', { name: workspaceInfo.name })}
            />
          ) : (
            <AuthTitle
              title={t('Welcome back')}
              subtitle={t('Sign in to your {name} workspace to continue.', { name: workspaceInfo.name })}
            />
          )}

          <WorkspaceChooser compact value={workspace} onChoose={chooseWorkspace} />

          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login" data-testid="login-tab">{t('Login')}</TabsTrigger>
            <TabsTrigger value="register" data-testid="register-tab">{t('Register')}</TabsTrigger>
          </TabsList>

          <TabsContent value="login" className="mt-0">
            <div className="flex flex-col gap-5">
              <form onSubmit={handleLogin} className="flex flex-col gap-5">
                {loginErrors.general && <AuthAlert>{loginErrors.general}</AuthAlert>}

                <AuthField
                  id="login-email"
                  data-testid="login-email-input"
                  label={t('Work email')}
                  icon={Mail}
                  type="email"
                  autoComplete="email"
                  placeholder="john@example.com"
                  value={loginForm.email}
                  onChange={(e) => handleLoginChange('email', e.target.value)}
                  required
                  error={loginErrors.email}
                />

                <AuthField
                  id="login-password"
                  data-testid="login-password-input"
                  label={t('Password')}
                  icon={Lock}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={loginForm.password}
                  onChange={(e) => handleLoginChange('password', e.target.value)}
                  required
                  error={loginErrors.password}
                  trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />}
                />

                <div className="-mt-1 flex justify-end">
                  <Link
                    to="/forgot-password"
                    className="rounded-sm text-[13px] font-medium leading-[18px] text-brand-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                  >
                    {t('Forgot password?')}
                  </Link>
                </div>

                <Button
                  type="submit"
                  variant="dark"
                  data-testid="login-submit-btn"
                  className="w-full"
                  disabled={loading}
                >
                  {loading ? t('Logging in...') : <><ArrowRight /> {t('Sign in')}</>}
                </Button>
              </form>

              <SsoButtons onResult={handleLoginResult} disabled={loading} />

              <p className="flex flex-wrap justify-center gap-1 text-[13px] leading-[18px]">
                <span className="text-ink-secondary">{t('New to {name}?', { name: productName })}</span>
                <button type="button" onClick={() => setTab('register')} className="font-medium text-ink hover:underline">
                  {t('Create an account')}
                </button>
              </p>
            </div>
          </TabsContent>

          <TabsContent value="register" className="mt-0">
            <form onSubmit={handleRegister} className="flex flex-col gap-4" noValidate>
              {registerErrors.general && <AuthAlert>{registerErrors.general}</AuthAlert>}

              <AuthField
                id="reg-name"
                data-testid="register-name-input"
                label={t('Full Name')}
                icon={User}
                type="text"
                autoComplete="name"
                placeholder="John Doe"
                value={registerForm.full_name}
                onChange={(e) => handleRegisterChange('full_name', e.target.value)}
                required
              />

              <AuthField
                id="reg-email"
                data-testid="register-email-input"
                label={t('Email')}
                icon={Mail}
                type="email"
                autoComplete="email"
                placeholder="john@example.com"
                value={registerForm.email}
                onChange={(e) => handleRegisterChange('email', e.target.value)}
                required
                error={registerErrors.email}
              />

              <AuthField
                id="reg-password"
                data-testid="register-password-input"
                label={t('Password')}
                icon={Lock}
                type={showRegPassword ? 'text' : 'password'}
                autoComplete="new-password"
                placeholder="••••••••"
                value={registerForm.password}
                onChange={(e) => handleRegisterChange('password', e.target.value)}
                required
                error={registerErrors.password}
                aria-describedby="reg-password-rules"
                trailing={<PasswordToggle shown={showRegPassword} onToggle={() => setShowRegPassword(!showRegPassword)} />}
              />
              <PasswordRules id="reg-password-rules" password={registerForm.password} showErrors={!!registerErrors.password} className="-mt-2" />

              <div className="grid grid-cols-2 gap-3">
                <AuthField
                  id="reg-department"
                  data-testid="register-department-input"
                  label={t('Department')}
                  type="text"
                  placeholder="Engineering"
                  value={registerForm.department}
                  onChange={(e) => handleRegisterChange('department', e.target.value)}
                  required
                />
                <AuthField
                  id="reg-designation"
                  data-testid="register-designation-input"
                  label={t('Designation')}
                  type="text"
                  placeholder="Developer"
                  value={registerForm.designation}
                  onChange={(e) => handleRegisterChange('designation', e.target.value)}
                  required
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reg-role" className="text-[13px] leading-[18px] text-ink-secondary">{t('Role')}</Label>
                <Select
                  value={registerForm.role}
                  onValueChange={(value) => handleRegisterChange('role', value)}
                >
                  <SelectTrigger id="reg-role" data-testid="register-role-select" className="h-11 px-3.5">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employee">Employee</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="reg-phone" className="text-[13px] leading-[18px] text-ink-secondary">Phone (Optional)</Label>
                <PhoneInput
                  id="reg-phone"
                  data-testid="register-phone-input"
                  value={registerForm.phone}
                  onChange={(phone) => handleRegisterChange('phone', phone)}
                  showError={!!registerErrors.phone}
                  boxClassName="h-11"
                />
              </div>

              <AuthField
                id="reg-manager"
                data-testid="register-manager-input"
                label="Manager Email (Optional)"
                icon={Mail}
                type="email"
                placeholder="manager@example.com"
                value={registerForm.manager_email}
                onChange={(e) => handleRegisterChange('manager_email', e.target.value)}
              />

              <Button
                type="submit"
                variant="dark"
                data-testid="register-submit-btn"
                className="mt-1 w-full"
                disabled={loading}
              >
                {loading ? 'Registering...' : 'Register'}
              </Button>

              <p className="flex flex-wrap justify-center gap-1 text-[13px] leading-[18px]">
                <span className="text-ink-secondary">{t('Already have an account?')}</span>
                <button type="button" onClick={() => setTab('login')} className="font-medium text-ink hover:underline">
                  {t('Sign in')}
                </button>
              </p>
            </form>
          </TabsContent>
        </Tabs>
      )}
    </AuthLayout>
  );
};

export default LoginPage;
