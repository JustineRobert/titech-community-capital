import React, { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import BrandLogo from '../components/BrandLogo';
import api from '../services/api';
import './VerifyEmail.css';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState(searchParams.get('token') || '');
  const [email, setEmail] = useState(String(location.state?.email || '').trim());
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [message, setMessage] = useState(
    location.state?.sessionIssuedByRegistration
      ? 'The registration response included an unexpected authentication result. No session was accepted. Contact your institution administrator before signing in.'
      : location.state?.verificationDeliveryStatus === 'UNCONFIRMED'
        ? 'Your account may have been created, but the verification email request could not be confirmed. Enter your email below to request another verification message.'
        : 'Enter the verification token from your email. A request accepted by the email service does not prove inbox delivery.'
  );

  const verify = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      await api.post('/api/email/verify', { token: token.trim() });
      setMessage('Your email is verified. You can now sign in.');
      toast.success('Email verified successfully');
      navigate('/login', { replace: true, state: { redirectAfterVerification: location.state?.redirectAfterVerification || '/dashboard' } });
    } catch (error) {
      setMessage(error?.response?.data?.message || 'Verification could not be completed. Request a new verification message and try again.');
    } finally {
      setLoading(false);
    }
  };

  const resend = async (event) => {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setMessage('Enter the email address used during registration.');
      return;
    }
    setResending(true);
    try {
      // The public endpoint intentionally returns a generic acknowledgement to
      // avoid disclosing whether an account exists or is already verified.
      await api.post('/api/email/request-verification', { email: normalizedEmail });
      setMessage('If this address belongs to an account that still needs verification, a new verification request has been accepted. Check your inbox and spam folder. Delivery to your inbox is not confirmed by this response.');
      toast.success('Verification request submitted');
    } catch (error) {
      const status = error?.response?.status;
      setMessage(status === 429
        ? 'Too many verification requests. Wait before trying again.'
        : 'The verification request could not be confirmed because the service is unavailable or rejected the request. Please retry later or contact your institution administrator.');
    } finally {
      setResending(false);
    }
  };

  return (
    <main className="titech-auth-page">
      <section className="titech-auth-card" aria-labelledby="verify-email-heading">
        <BrandLogo />
        <h1 id="verify-email-heading">Verify your email</h1>
        <p role="status" aria-live="polite">{message}</p>
        <form onSubmit={verify}>
          <label htmlFor="verification-token">Verification token</label>
          <input
            id="verification-token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            required
            autoComplete="one-time-code"
          />
          <button type="submit" disabled={loading || !token.trim()}>
            {loading ? 'Verifying…' : 'Verify email'}
          </button>
        </form>
        <hr />
        <form onSubmit={resend}>
          <label htmlFor="verification-email">Email address for a new verification request</label>
          <input
            id="verification-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            maxLength={254}
            required
          />
          <button type="submit" disabled={resending || !email.trim()}>
            {resending ? 'Requesting…' : 'Resend verification email'}
          </button>
        </form>
        <p><Link to="/login">Back to sign in</Link></p>
      </section>
    </main>
  );
}
