'use client';
import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { api, useApp } from './provider';
export default function AuthForm({ register = false }: { register?: boolean }) {
  const [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [visible, setVisible] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    { refresh, toast } = useApp(),
    router = useRouter();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('auth/' + (register ? 'register' : 'login'), { name, email, password });
      await refresh();
      toast(
        register
          ? 'Welcome to ORBIT. Your account starts at zero; add virtual funds in your wallet.'
          : 'Welcome back to ORBIT.',
      );
      router.push('/portfolio');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="auth-page">
      <div className="auth-story">
        <span className="eyebrow">YOUR SPACE IN THE MARKET</span>
        <h1>{register ? 'Your next move\nstarts here.' : 'A fresh perspective.\nEvery time.'}</h1>
        <p>
          A focused terminal. A transparent portfolio.
          <br />
          The confidence that comes from practice.
        </p>
        <div className="auth-benefits">
          <span>
            <Check size={16} /> Live market account · starts at zero
          </span>
          <span>
            <Check size={16} /> Sixteen spot markets, including HYPE
          </span>
          <span>
            <Check size={16} /> Every trade, tracked and accounted for
          </span>
        </div>
        <div className="auth-footnote">PAPER TRADING, WITH PURPOSE.</div>
      </div>
      <section className="auth-card">
        <span className="eyebrow">{register ? 'MAKE YOURSELF AT HOME' : 'BACK IN YOUR ORBIT'}</span>
        <h2>{register ? 'Create your account' : 'Welcome back.'}</h2>
        <p>
          {register
            ? 'A little practice can change your perspective.'
            : 'Pick up where you left off.'}
        </p>
        <form onSubmit={submit}>
          {register && (
            <label className="form-label">
              Your name
              <input
                autoComplete="name"
                required
                minLength={2}
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Morgan"
              />
            </label>
          )}
          <label className="form-label">
            Email address
            <input
              autoComplete="email"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label className="form-label">
            Password
            <div className="password-field">
              <input
                autoComplete={register ? 'new-password' : 'current-password'}
                type={visible ? 'text' : 'password'}
                minLength={10}
                maxLength={72}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={register ? 'At least 10 characters' : 'Your password'}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={visible ? 'Hide password' : 'Show password'}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </label>
          {register && (
            <p className="form-help">Use 10–72 characters. Your password is securely hashed.</p>
          )}
          {error && (
            <p role="alert" className="inline-error">
              {error}
            </p>
          )}
          <button type="submit" className="button primary full" disabled={busy}>
            {busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}
            <ArrowRight size={17} />
          </button>
        </form>
        <p className="auth-switch">
          {register ? 'Already have an account?' : 'New to ORBIT?'}{' '}
          <Link href={register ? '/login' : '/register'}>
            {register ? 'Sign in' : 'Create an account'}
          </Link>
        </p>
        <div className="auth-disclaimer">
          <LockKeyhole size={16} />
          <span>Simulation only. No real funds, custody, or financial services.</span>
        </div>
      </section>
    </main>
  );
}
