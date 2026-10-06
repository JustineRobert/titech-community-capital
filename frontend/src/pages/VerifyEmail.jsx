import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import BrandLogo from '../components/BrandLogo';
import api from '../services/api';
import './VerifyEmail.css';

export default function VerifyEmail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token, setToken] = useState(searchParams.get('token') || '');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('Enter the verification token from your email.');
  const verify = async (event) => {
    event.preventDefault(); setLoading(true);
    try {
      await api.post('/api/email/verify', { token: token.trim() });
      setMessage('Your email is verified. You can now sign in.');
      toast.success('Email verified successfully');
      setTimeout(() => navigate('/login', { replace: true }), 600);
    } catch (error) {
      setMessage(error?.response?.data?.message || 'Verification failed. Request a new verification message.');
    } finally { setLoading(false); }
  };
  return <main className="titech-auth-page"><section className="titech-auth-card"><BrandLogo /><h1>Verify your email</h1><p>{message}</p><form onSubmit={verify}><label htmlFor="verification-token">Verification token</label><input id="verification-token" value={token} onChange={(e) => setToken(e.target.value)} required autoComplete="one-time-code" /><button type="submit" disabled={loading}>{loading ? 'Verifying…' : 'Verify email'}</button></form><p><Link to="/login">Back to sign in</Link></p></section></main>;
}
