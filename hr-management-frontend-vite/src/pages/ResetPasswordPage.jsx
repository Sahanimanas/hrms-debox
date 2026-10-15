import React, { useState, useEffect } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Lock, CheckCircle, XCircle, AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react';
import api from '@/lib/api';
import PasswordRules from '@/components/PasswordRules';
import { passwordPolicyMessage } from '@/lib/password';
import { apiErrorMessage } from '@/lib/apiError';
import { Avatar } from '@/components/ds';
import { AuthField, AuthLayout, AuthStatus, AuthTitle, PasswordToggle } from '@/components/AuthLayout';

const BackToLogin = () => (
  <Link
    to="/login"
    className="flex w-fit items-center gap-1 rounded-sm text-[13px] font-medium leading-[18px] text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
  >
    <ArrowLeft className="h-4 w-4" /> Back to Login
  </Link>
);

const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('loading'); // loading, valid, invalid, expired, success
  const [userInfo, setUserInfo] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('invalid');
      setErrorMessage('No reset token provided. Please use the link from your email.');
      return;
    }

    validateToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const validateToken = async () => {
    try {
      const response = await api.get(`/password-reset/validate/${token}`);
      setUserInfo(response.data);
      setStatus('valid');
    } catch (error) {
      const code = error.response?.data?.code;
      const message = error.response?.data?.detail || 'Invalid reset link';

      if (code === 'TOKEN_EXPIRED') {
        setStatus('expired');
        setErrorMessage(message);
      } else {
        setStatus('invalid');
        setErrorMessage(message);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const passwordProblem = passwordPolicyMessage(password);
    if (passwordProblem) {
      setSubmitAttempted(true);
      toast.error(passwordProblem);
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setSubmitting(true);

    try {
      await api.post('/password-reset/reset', {
        token,
        new_password: password
      });

      setStatus('success');
      toast.success('Password reset successfully!');
    } catch (error) {
      const code = error.response?.data?.code;
      const message = apiErrorMessage(error, 'Failed to reset password');

      if (code === 'TOKEN_EXPIRED') {
        setStatus('expired');
        setErrorMessage(message);
      } else if (code === 'INVALID_TOKEN') {
        setStatus('invalid');
        setErrorMessage(message);
      } else {
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Loading state
  if (status === 'loading') {
    return (
      <AuthLayout>
        <div className="flex items-center gap-3 text-[15px] leading-6 text-ink-secondary" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-ink-muted" />
          Validating reset link...
        </div>
      </AuthLayout>
    );
  }

  // Invalid token state
  if (status === 'invalid') {
    return (
      <AuthLayout topBar={<BackToLogin />}>
        <AuthStatus icon={XCircle} tone="danger" title="Invalid Reset Link">{errorMessage}</AuthStatus>
        <div className="flex flex-col gap-3">
          <Button asChild variant="dark" className="w-full">
            <Link to="/login"><ArrowLeft /> Back to Login</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link to="/forgot-password">Request New Reset Link</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // Expired token state
  if (status === 'expired') {
    return (
      <AuthLayout topBar={<BackToLogin />}>
        <AuthStatus icon={AlertTriangle} tone="warning" title="Link Expired">{errorMessage}</AuthStatus>
        <div className="flex flex-col gap-3">
          <Button asChild variant="dark" className="w-full">
            <Link to="/forgot-password">Request New Reset Link</Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login"><ArrowLeft /> Back to Login</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // Success state
  if (status === 'success') {
    return (
      <AuthLayout>
        <AuthStatus icon={CheckCircle} tone="success" title="Password Reset Successful!">
          Your password has been changed successfully. You can now log in with your new password.
        </AuthStatus>
        <Button asChild variant="dark" className="w-full">
          <Link to="/login">Go to Login</Link>
        </Button>
      </AuthLayout>
    );
  }

  const mismatch = confirmPassword && password !== confirmPassword;

  // Valid token - show reset form
  return (
    <AuthLayout topBar={<BackToLogin />}>
      <AuthTitle title="Reset Your Password" subtitle="Create a new password for your account" />

      {/* User Info */}
      <div className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-4">
        <Avatar name={userInfo?.full_name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium leading-4 text-ink-muted">Resetting password for</p>
          <p className="truncate text-sm font-semibold leading-5 text-ink">{userInfo?.full_name}</p>
          <p className="truncate text-[13px] leading-[18px] text-ink-secondary">{userInfo?.email}</p>
        </div>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-3 rounded-md border border-warning-solid/30 bg-warning-bg p-3.5">
        <AlertTriangle className="mt-px h-4 w-4 shrink-0 text-warning-fg" />
        <div className="text-[13px] leading-[18px] text-warning-fg">
          <p className="font-semibold">One-time use link</p>
          <p className="mt-0.5">This link can only be used once. After resetting your password, it will no longer work.</p>
        </div>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <AuthField
          id="password"
          label="New Password"
          icon={Lock}
          type={showPassword ? 'text' : 'password'}
          autoComplete="new-password"
          placeholder="Enter new password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          aria-describedby="password-rules"
          error={submitAttempted && passwordPolicyMessage(password) ? 'Choose a password that meets every rule below' : ''}
          trailing={<PasswordToggle shown={showPassword} onToggle={() => setShowPassword(!showPassword)} />}
        />
        <PasswordRules id="password-rules" password={password} showErrors={submitAttempted} className="-mt-3" />

        <div className="flex flex-col gap-1.5">
          <AuthField
            id="confirm-password"
            label="Confirm Password"
            icon={Lock}
            type={showConfirmPassword ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            error={mismatch ? 'Passwords do not match' : ''}
            trailing={<PasswordToggle shown={showConfirmPassword} onToggle={() => setShowConfirmPassword(!showConfirmPassword)} />}
          />
          {confirmPassword && password === confirmPassword && (
            <p className="flex items-center gap-1.5 text-[13px] leading-[18px] text-success-fg">
              <CheckCircle className="h-4 w-4" /> Passwords match
            </p>
          )}
        </div>

        <Button
          type="submit"
          variant="dark"
          className="w-full"
          disabled={submitting || password !== confirmPassword || !password}
        >
          {submitting ? 'Resetting Password...' : 'Reset Password'}
        </Button>
      </form>
    </AuthLayout>
  );
};

export default ResetPasswordPage;
