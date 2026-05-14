import { FormEvent, useState } from 'react';
import { Link } from 'wouter';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { CargoVisual } from '@/components/CargoVisual';
import { useAuth } from '@/auth/AuthContext';

export function LoginPage() {
  const { login } = useAuth();
  const params = new URLSearchParams(window.location.search);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      await login(username.trim(), password);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-white text-[#101b46]">
      <div className="grid min-h-screen lg:grid-cols-[42%_58%]">
        <section className="relative z-10 flex items-center justify-center bg-white px-6 py-10 shadow-[18px_0_60px_rgba(16,27,70,0.08)] lg:px-14 xl:px-20">
          <div className="w-full max-w-[430px]">
            <div className="mb-12 flex items-center gap-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#2366ea] text-3xl font-extrabold uppercase text-white shadow-[0_14px_28px_rgba(35,102,234,0.22)]">
                Z
              </div>
              <div>
                <div className="text-4xl font-extrabold leading-none tracking-normal text-[#2366ea]">EWMS</div>
                <div className="mt-1 text-[11px] font-bold uppercase tracking-[0.22em] text-[#101b46]">
                  Export Workflow Management System
                </div>
              </div>
            </div>

            <div className="mb-9">
              <h1 className="text-[34px] font-extrabold leading-tight text-[#101b46]">Welcome Back!</h1>
              <p className="mt-2 text-xl font-medium text-[#70758f]">Track your shipments in real-time</p>
            </div>

            <form className="space-y-7" onSubmit={handleSubmit}>
              {params.get('created') === '1' && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-700">
                  Account created successfully. Sign in to access EWMS.
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="username" className="text-sm font-bold text-[#101b46]">
                  Email
                </Label>
                <div className="relative">
                  <Input
                    id="username"
                    name="email"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="Enter your email"
                    className="h-14 rounded-md border-[#dfe4ef] bg-white px-4 text-base font-semibold text-[#101b46] shadow-[0_14px_28px_rgba(16,27,70,0.08)] placeholder:text-[#9aa0b3]"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="password" className="text-sm font-bold text-[#101b46]">
                    Password
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 rounded-full text-[#7d849a] hover:bg-[#eef4ff] hover:text-[#2366ea]"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    placeholder="Enter password"
                    className="h-14 rounded-md border-[#dfe4ef] bg-white pl-4 pr-4 text-base font-semibold text-[#101b46] shadow-[0_14px_28px_rgba(16,27,70,0.08)] placeholder:text-[#9aa0b3]"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 text-sm font-semibold">
                <label className="flex items-center gap-2 text-[#2366ea]">
                  <input
                    type="checkbox"
                    defaultChecked
                    className="h-4 w-4 rounded border-[#2366ea] accent-[#2366ea]"
                  />
                  Remember me
                </label>
                <Link href="/forgot-password" className="text-[#2366ea] hover:underline">
                  Forgot Password ?
                </Link>
              </div>

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="h-16 w-full rounded-full bg-[#2366ea] text-lg font-extrabold uppercase tracking-normal text-white shadow-[0_18px_34px_rgba(35,102,234,0.28)] hover:bg-[#1959dc]"
                disabled={submitting}
              >
                {submitting && <Spinner className="h-4 w-4" />}
                User Login
              </Button>

              <div className="text-center text-sm font-semibold text-[#70758f]">
                Need to change credentials?{' '}
                <Link href="/reset-password" className="text-[#2366ea] hover:underline">
                  Reset Password
                </Link>
              </div>
            </form>
          </div>
        </section>

        <section className="relative hidden min-h-screen overflow-hidden bg-[#2366ea] text-white lg:block">
          <div className="absolute inset-y-0 -left-24 z-10 w-48 -skew-x-[12deg] bg-white" />
          <CargoVisual className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-x-0 bottom-6 z-20 flex flex-wrap items-center justify-center gap-3 px-6 xl:px-16">
            <div className="flex min-w-[220px] items-center gap-3 rounded-[28px] border border-white/20 bg-white/95 px-4 py-3 text-slate-950 shadow-[0_18px_45px_rgba(0,0,0,0.12)] backdrop-blur-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1959dc] text-white shadow-sm">
                <span className="text-xl">📦</span>
              </div>
              <div>
                <p className="font-semibold text-sm">Real-time Tracking</p>
                <p className="mt-1 text-xs text-slate-600">Live updates on your shipments</p>
              </div>
            </div>
            <div className="flex min-w-[220px] items-center gap-3 rounded-[28px] border border-white/20 bg-white/95 px-4 py-3 text-slate-950 shadow-[0_18px_45px_rgba(0,0,0,0.12)] backdrop-blur-sm">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0f4bb8] text-white shadow-sm">
                <span className="text-xl">🛡️</span>
              </div>
              <div>
                <p className="font-semibold text-sm">Secure & Reliable</p>
                <p className="mt-1 text-xs text-slate-600">Your data is safe with us</p>
              </div>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-0 h-[19%] bg-[#2366ea]" />
        </section>
      </div>
    </main>
  );
}
