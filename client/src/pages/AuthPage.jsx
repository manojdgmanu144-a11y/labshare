import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';

const DEPARTMENTS = [
  'Electronics Engineering',
  'Computer Science',
  'Mechanical Engineering',
  'Biomedical Engineering',
  'Physics',
  'Other',
];

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const navigate  = useNavigate();
  const location  = useLocation();
  const from      = location.state?.from?.pathname ?? '/dashboard';

  const [mode, setMode]       = useState('login'); // 'login' | 'signup'
  const [error, setError]     = useState('');
  const [busy, setBusy]       = useState(false);

  const [form, setForm] = useState({
    email: '', password: '', name: '', role: 'student', department: 'Computer Science',
  });

  function update(field) {
    return (e) => setForm(f => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn({ email: form.email, password: form.password });
      } else {
        if (form.password.length < 8) {
          throw new Error('Password must be at least 8 characters');
        }
        await signUp({
          email:      form.email,
          password:   form.password,
          name:       form.name,
          role:       form.role,
          department: form.department,
        });
      }
      navigate(from, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page" id="main-content">
      <div className="auth-card">
        <div className="auth-logo" aria-hidden="true">⚗</div>
        <h1 className="auth-title">LabShare</h1>
        <p className="auth-subtitle">Campus laboratory resource sharing</p>

        {/* Tab switcher */}
        <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
          <button
            role="tab"
            type="button"
            aria-selected={mode === 'login'}
            className={`auth-tab${mode === 'login' ? ' active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            Sign in
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={mode === 'signup'}
            className={`auth-tab${mode === 'signup' ? ' active' : ''}`}
            onClick={() => { setMode('signup'); setError(''); }}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate aria-label={mode === 'login' ? 'Sign in form' : 'Create account form'}>
          {error && (
            <p role="alert" className="form-error" aria-live="assertive">
              {error}
            </p>
          )}

          {mode === 'signup' && (
            <>
              <div className="field">
                <label htmlFor="auth-name">Full name</label>
                <input
                  id="auth-name"
                  type="text"
                  autoComplete="name"
                  required
                  value={form.name}
                  onChange={update('name')}
                  placeholder="e.g. Alex Johnson"
                />
              </div>

              <div className="field">
                <label htmlFor="auth-role">Role</label>
                <select id="auth-role" value={form.role} onChange={update('role')} required>
                  <option value="student">Student</option>
                  <option value="faculty">Faculty</option>
                </select>
              </div>

              <div className="field">
                <label htmlFor="auth-dept">Department</label>
                <select id="auth-dept" value={form.department} onChange={update('department')} required>
                  {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="auth-email">Email address</label>
            <input
              id="auth-email"
              type="email"
              autoComplete={mode === 'login' ? 'username' : 'email'}
              required
              value={form.email}
              onChange={update('email')}
              placeholder="you@university.edu"
            />
          </div>

          <div className="field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={8}
              value={form.password}
              onChange={update('password')}
              placeholder={mode === 'signup' ? 'At least 8 characters' : ''}
            />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={busy} aria-busy={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p className="auth-hint">
          Demo — student@demo.edu / faculty@demo.edu, password: Demo1234!
        </p>
      </div>
    </main>
  );
}
