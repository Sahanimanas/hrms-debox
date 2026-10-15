import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Mail, ArrowLeft, ArrowRight, MailCheck } from 'lucide-react';
import api from '@/lib/api';
import { AuthField, AuthLayout, AuthStatus, AuthTitle } from '@/components/AuthLayout';

const BackToLogin = () => (
  <Link
    to="/login"
    className="flex w-fit items-center gap-1 rounded-sm text-[13px] font-medium leading-[18px] text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
  >
    <ArrowLeft className="h-4 w-4" /> Back to Login
  </Link>
);

const ForgotPasswordPage = () => {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!email) {
      toast.error('Please enter your email address');
      return;
    }

    setSubmitting(true);

    try {
      await api.post('/password-reset/request', { email });
      setSubmitted(true);
    } catch {
      // Always show success to prevent email enumeration
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  };

  // Success state
  if (submitted) {
    return (
      <AuthLayout topBar={<BackToLogin />}>
        <AuthStatus icon={MailCheck} tone="success" title="Check Your Email">
          If an account exists for <strong className="font-semibold text-ink">{email}</strong>, we've sent a password reset link.
        </AuthStatus>
        <p className="text-[13px] leading-[18px] text-ink-muted">
          The link will expire in 24 hours. Please check your spam folder if you don't see the email.
        </p>
        <div className="flex flex-col gap-3">
          <Button asChild variant="dark" className="w-full">
            <Link to="/login">
              <ArrowLeft /> Back to Login
            </Link>
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setSubmitted(false);
              setEmail('');
            }}
          >
            Try Another Email
          </Button>
        </div>
      </AuthLayout>
    );
  }

  // Request form
  return (
    <AuthLayout topBar={<BackToLogin />}>
      <AuthTitle
        title="Forgot Password?"
        subtitle="No worries! Enter your email and we'll send you a reset link."
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <AuthField
          id="email"
          label="Email Address"
          icon={Mail}
          type="email"
          autoComplete="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          hint="Enter the email address associated with your account"
        />

        <Button type="submit" variant="dark" className="w-full" disabled={submitting}>
          {submitting ? 'Sending...' : <>Send Reset Link <ArrowRight /></>}
        </Button>
      </form>

      <p className="flex flex-wrap justify-center gap-1 text-[13px] leading-[18px]">
        <span className="text-ink-secondary">Remember your password?</span>
        <Link to="/login" className="font-medium text-ink hover:underline">
          Sign in
        </Link>
      </p>
    </AuthLayout>
  );
};

export default ForgotPasswordPage;
