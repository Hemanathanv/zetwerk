import { useState, useEffect, type FormEvent } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/contexts/AuthContext';

const SHIPS = [
  { top: '6%',  dir: 'moveRight', duration: '30s', delay: '0s',  scale: 1.00, opacity: 0.15 },
  { top: '26%', dir: 'moveLeft',  duration: '38s', delay: '4s',  scale: 0.85, opacity: 0.10 },
  { top: '50%', dir: 'moveRight', duration: '34s', delay: '8s',  scale: 0.70, opacity: 0.08 },
  { top: '70%', dir: 'moveLeft',  duration: '40s', delay: '2s',  scale: 0.90, opacity: 0.12 },
  { top: '86%', dir: 'moveRight', duration: '36s', delay: '6s',  scale: 0.65, opacity: 0.07 },
];

const PARTICLES = Array.from({ length: 35 }, (_, i) => ({
  left: `${(i * 37 + 13) % 97}%`,
  top:  `${(i * 53 + 7)  % 91}%`,
  size: 2 + (i % 3),
  color: i % 7 === 0
    ? 'rgba(110,95,210,0.35)'
    : i % 5 === 0
    ? 'rgba(229,155,45,0.35)'
    : 'rgba(93,202,165,0.35)',
  duration: `${3 + (i % 4)}s`,
  delay: `-${((i * 0.37) % 3).toFixed(2)}s`,
}));

const CODES = ['SI', 'BOL', 'PL', 'GRN', 'CHA', 'POD', 'FF', 'CBP FORM-7501'];

function ShipSVG({ w, h }: { w: number; h: number }) {
  return (
    <svg width={w} height={h} viewBox="0 0 160 55" fill="none" style={{ display: 'block' }}>
      <path d="M4 30 Q8 46 30 48 L125 48 Q148 44 156 26 L142 19 L22 19 Z" fill="rgba(93,202,165,1)" />
      <rect x="24" y="4"  width="19" height="15" rx="2" fill="rgba(93,202,165,1)" />
      <rect x="29" y="-3" width="7"  height="8"  rx="1" fill="rgba(93,202,165,0.8)" />
      <rect x="50"  y="8"  width="12" height="11" rx="1" fill="rgba(229,155,45,0.9)" />
      <rect x="64"  y="6"  width="12" height="13" rx="1" fill="rgba(93,202,165,0.7)" />
      <rect x="78"  y="9"  width="12" height="10" rx="1" fill="rgba(110,95,210,0.8)" />
      <rect x="92"  y="7"  width="12" height="12" rx="1" fill="rgba(229,155,45,0.7)" />
      <rect x="106" y="10" width="12" height="9"  rx="1" fill="rgba(93,202,165,0.6)" />
      <rect x="54" y="0"  width="10" height="8" rx="1" fill="rgba(93,202,165,0.5)" />
      <rect x="68" y="-2" width="10" height="8" rx="1" fill="rgba(229,155,45,0.5)" />
      <rect x="82" y="1"  width="10" height="8" rx="1" fill="rgba(110,95,210,0.4)" />
    </svg>
  );
}

const CSS = `
  .el-root {
    position: fixed; inset: 0;
    background: #07080D;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }

  /* ── Aurora blobs ── */
  .el-blob {
    position: absolute;
    filter: blur(40px);
    will-change: transform;
    pointer-events: none;
  }
  .el-blob-teal   { width: 65%; height: 65%; left: -10%; top: 0%;
    background: radial-gradient(ellipse, rgba(93,202,165,0.22) 0%, rgba(93,202,165,0.07) 40%, transparent 70%);
    animation: auroraA 16s ease-in-out infinite; }
  .el-blob-purple { width: 55%; height: 60%; right: -8%; top: 25%;
    background: radial-gradient(ellipse, rgba(110,95,210,0.20) 0%, rgba(110,95,210,0.06) 40%, transparent 70%);
    animation: auroraB 20s ease-in-out infinite; }
  .el-blob-amber  { width: 50%; height: 50%; left: 20%; bottom: -8%;
    background: radial-gradient(ellipse, rgba(229,155,45,0.16) 0%, rgba(229,155,45,0.05) 40%, transparent 70%);
    animation: auroraC 14s ease-in-out infinite; }
  .el-blob-pink   { width: 40%; height: 40%; right: 8%; top: -8%;
    background: radial-gradient(ellipse, rgba(210,120,160,0.12) 0%, rgba(210,120,160,0.04) 40%, transparent 70%);
    animation: auroraD 18s ease-in-out infinite; }

  @keyframes auroraA {
    0%   { transform: translate(0, 0) scale(1); }
    33%  { transform: translate(50px, -35px) scale(1.08); }
    66%  { transform: translate(-25px, 25px) scale(0.95); }
    100% { transform: translate(0, 0) scale(1); }
  }
  @keyframes auroraB {
    0%   { transform: translate(0, 0) scale(1); }
    33%  { transform: translate(-50px, 30px) scale(1.05); }
    66%  { transform: translate(20px, -20px) scale(0.97); }
    100% { transform: translate(0, 0) scale(1); }
  }
  @keyframes auroraC {
    0%   { transform: translate(0, 0) scale(1); }
    50%  { transform: translate(30px, -20px) scale(1.06); }
    100% { transform: translate(0, 0) scale(1); }
  }
  @keyframes auroraD {
    0%   { transform: translate(0, 0) scale(1); }
    40%  { transform: translate(-20px, 20px) scale(1.04); }
    80%  { transform: translate(15px, -10px) scale(0.96); }
    100% { transform: translate(0, 0) scale(1); }
  }

  /* ── Ships ── */
  .el-ship { position: absolute; pointer-events: none; }
  @keyframes moveRight {
    0%   { left: -25%; }
    100% { left: 110%; }
  }
  @keyframes moveLeft {
    0%   { left: 110%; }
    100% { left: -25%; }
  }
  @keyframes bob {
    0%, 100% { transform: translateY(0); }
    50%       { transform: translateY(-6px); }
  }

  /* ── Particles ── */
  .el-particle { position: absolute; border-radius: 50%; pointer-events: none; }
  @keyframes twinkle {
    0%, 100% { opacity: 0.06; }
    50%       { opacity: 0.35; }
  }

  /* ── Ghost codes ── */
  .el-code {
    position: absolute;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    color: rgba(93,202,165,0.5);
    pointer-events: none;
    animation: ghostFloat var(--gf-dur, 6s) ease-in-out var(--gf-del, 0s) infinite;
  }
  @keyframes ghostFloat {
    0%, 100% { opacity: 0.04; transform: translateY(0); }
    50%       { opacity: 0.18; transform: translateY(-4px); }
  }

  /* ── Vignette ── */
  .el-vignette {
    position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(ellipse at center, transparent 25%, rgba(7,8,13,0.4) 80%);
  }

  /* ── Two-column layout ── */
  .el-content {
    position: relative; z-index: 10;
    display: grid;
    grid-template-columns: 1fr 420px;
    gap: 0;
    width: 100%;
    height: 100%;
    max-height: 100vh;
    overflow: hidden;
  }

  /* Left panel — marketing */
  .el-left {
    display: flex; flex-direction: column; justify-content: center;
    padding: 56px 52px 56px 7%;
    gap: 28px;
    overflow: hidden;
  }

  /* Right panel — card */
  .el-right {
    display: flex; flex-direction: column; justify-content: center;
    align-items: center;
    padding: 40px 5% 40px 0;
    overflow-y: auto;
  }

  /* Vertical separator */
  .el-sep {
    position: absolute;
    top: 10%; bottom: 10%;
    width: 1px;
    background: rgba(255,255,255,0.04);
    /* positioned by JS inline style */
  }

  .el-eyebrow {
    font-size: 11px; text-transform: uppercase; letter-spacing: 2.5px;
    color: rgba(93,202,165,0.45);
    animation: cardUp 0.7s cubic-bezier(.16,1,.3,1) 0.1s both;
  }
  .el-headline {
    font-size: clamp(28px, 3.2vw, 46px); font-weight: 700; color: rgba(255,255,255,0.95);
    line-height: 1.18; max-width: 100%;
    animation: cardUp 0.7s cubic-bezier(.16,1,.3,1) 0.2s both;
  }
  .el-headline-teal { color: rgb(93,202,165); display: block; }
  .el-subhead {
    font-size: 16px; color: rgba(255,255,255,0.32);
    max-width: 520px; line-height: 1.65;
    animation: cardUp 0.7s cubic-bezier(.16,1,.3,1) 0.3s both;
  }

  /* ── Pillars ── */
  .el-pillars {
    display: flex; width: 100%;
    background: rgba(255,255,255,0.02);
    border-radius: 12px; overflow: hidden;
    border: 1px solid rgba(255,255,255,0.04);
    animation: cardUp 0.7s cubic-bezier(.16,1,.3,1) 0.4s both;
  }
  .el-pillar {
    flex: 1; padding: 16px 18px;
    border-right: 1px solid rgba(255,255,255,0.03);
  }
  .el-pillar:last-child { border-right: none; }
  .el-pillar-icon { font-size: 18px; margin-bottom: 8px; color: rgb(93,202,165); }
  .el-pillar-label { font-size: 14px; font-weight: 600; color: rgba(255,255,255,0.7); margin-bottom: 5px; }
  .el-pillar-desc  { font-size: 12.5px; color: rgba(255,255,255,0.28); line-height: 1.5; }

  /* ── Flow line ── */
  .el-flow {
    display: flex; align-items: flex-start; gap: 10px;
    animation: cardUp 0.7s cubic-bezier(.16,1,.3,1) 0.5s both;
  }
  .el-flow-node { display: flex; flex-direction: column; gap: 5px; }
  .el-flow-label { font-size: 15px; font-weight: 600; color: rgba(255,255,255,0.75); }
  .el-flow-sub   { font-size: 12.5px; }
  .el-flow-arrow { font-size: 16px; color: rgba(93,202,165,0.2); padding-top: 3px; }

  /* Closing line — left panel bottom */
  .el-closing {
    font-size: 13px; color: rgba(255,255,255,0.14);
    letter-spacing: 1px;
    animation: fadeIn 0.8s ease 1.0s both;
  }

  /* ── Card ── */
  .el-card {
    background: rgba(10,12,18,0.6);
    backdrop-filter: blur(80px) saturate(150%);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 24px;
    padding: 34px;
    width: 100%;
    animation: cardUp 0.9s cubic-bezier(.16,1,.3,1) 0.55s both,
               breathe 6s ease 1.5s infinite;
  }
  @keyframes breathe {
    0%, 100% { box-shadow: 0 0 40px rgba(93,202,165,0.03); }
    50%       { box-shadow: 0 0 70px rgba(93,202,165,0.08); }
  }

  /* Logo row */
  .el-logo-row {
    display: flex; align-items: center; gap: 12px; margin-bottom: 28px;
  }
  .el-logo-mark {
    width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
    background: linear-gradient(135deg, rgb(93,202,165) 0%, rgb(29,158,117) 100%);
    display: flex; align-items: center; justify-content: center;
  }
  .el-logo-name {
    font-size: 20px; font-weight: 700; letter-spacing: 5px;
    color: rgba(255,255,255,0.95); flex: 1;
  }
  .el-preview-badge {
    font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;
    color: rgba(93,202,165,0.6); border: 1px solid rgba(93,202,165,0.2);
    border-radius: 20px; padding: 2px 7px;
  }

  /* Fields */
  .el-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
  .el-label {
    font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.8px;
    color: rgba(255,255,255,0.35); transition: color 0.2s;
  }
  .el-label.focused { color: rgb(93,202,165); }
  .el-input-wrap { position: relative; }
  .el-input {
    width: 100%; height: 48px; box-sizing: border-box;
    padding: 0 14px;
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    color: rgba(255,255,255,0.9); font-size: 14px;
    outline: none; transition: border-color 0.2s, box-shadow 0.2s;
  }
  .el-input::placeholder { color: rgba(255,255,255,0.18); }
  .el-input.has-toggle { padding-right: 44px; }
  .el-input:focus {
    border-color: rgba(93,202,165,0.4);
    box-shadow: 0 0 0 4px rgba(93,202,165,0.08);
  }
  .el-toggle {
    position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer;
    font-size: 16px; color: rgba(255,255,255,0.25);
    transition: color 0.2s; padding: 4px; line-height: 1;
  }
  .el-toggle.active { color: rgb(93,202,165); }

  /* Error */
  .el-error {
    font-size: 12px; color: rgba(220,80,80,0.9);
    background: rgba(220,80,80,0.08);
    border: 1px solid rgba(220,80,80,0.15);
    border-radius: 8px; padding: 8px 12px;
    margin-bottom: 12px;
  }

  /* Button */
  .el-btn {
    width: 100%; height: 50px; border-radius: 12px; border: none;
    background: rgb(29,158,117); color: white;
    font-size: 15px; font-weight: 600; cursor: pointer;
    position: relative; overflow: hidden;
    transition: background 0.2s, transform 0.2s, box-shadow 0.2s;
  }
  .el-btn:hover:not(:disabled) {
    background: rgb(40,175,131);
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(29,158,117,0.3);
  }
  .el-btn:disabled { opacity: 0.7; cursor: not-allowed; }
  .el-btn-shimmer {
    position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.1) 50%, transparent 60%);
    background-size: 200% 100%;
    animation: shimmer 3s ease-in-out infinite;
  }
  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  /* Links */
  .el-links {
    display: flex; justify-content: space-between;
    margin-top: 14px;
  }
  .el-link {
    font-size: 12px; color: rgba(255,255,255,0.2);
    text-decoration: none; background: none; border: none; cursor: pointer;
    transition: color 0.2s;
  }
  .el-link:hover { color: rgb(93,202,165); }

  /* Secondary mode styles */
  .el-mode-title {
    font-size: 16px; font-weight: 700; color: rgba(255,255,255,0.88);
    margin-top: 4px; margin-bottom: 6px;
  }
  .el-mode-desc {
    font-size: 12.5px; color: rgba(255,255,255,0.38); line-height: 1.55;
    margin-bottom: 4px;
  }
  .el-back-row {
    margin-top: 16px; text-align: center;
  }
  .el-success-box {
    display: flex; align-items: flex-start; gap: 12px;
    background: rgba(29,158,117,0.08);
    border: 1px solid rgba(29,158,117,0.2);
    border-radius: 10px; padding: 14px 16px;
    margin-top: 20px;
  }
  .el-success-icon {
    width: 28px; height: 28px; border-radius: 50%;
    background: rgba(29,158,117,0.2); color: rgb(93,202,165);
    display: flex; align-items: center; justify-content: center;
    font-size: 14px; flex-shrink: 0;
  }
  .el-success-title {
    font-size: 13px; font-weight: 600; color: rgba(255,255,255,0.85);
    margin-bottom: 4px;
  }
  .el-success-sub {
    font-size: 12px; color: rgba(255,255,255,0.4); line-height: 1.5;
  }
  .el-success-sub strong { color: rgba(255,255,255,0.6); font-weight: 500; }

  /* Footer */
  .el-card-footer {
    margin-top: 22px; padding-top: 18px;
    border-top: 1px solid rgba(255,255,255,0.04);
    display: flex; align-items: center; justify-content: center; gap: 7px;
    color: rgba(255,255,255,0.13); font-size: 10.5px;
  }

  @keyframes cardUp {
    from { opacity: 0; transform: translateY(16px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
`;

export function LoginPage() {
  const { login, isAuthenticated, user } = useAuth();
  const [, navigate] = useLocation();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [focused, setFocused]   = useState<'email' | 'password' | null>(null);
  const [error, setError]       = useState('');
  const [submitting, setSubmitting] = useState(false);

  type Mode = 'login' | 'forgot' | 'request';
  const [mode, setMode]         = useState<Mode>('login');
  const [resetEmail, setResetEmail]   = useState('');
  const [resetDone, setResetDone]     = useState(false);
  const [reqName, setReqName]         = useState('');
  const [reqEmail, setReqEmail]       = useState('');
  const [reqRole, setReqRole]         = useState('');
  const [reqDone, setReqDone]         = useState(false);
  const [secondaryLoading, setSecondaryLoading] = useState(false);

  function switchMode(m: Mode) {
    setMode(m);
    setError('');
    setResetDone(false);
    setReqDone(false);
    setSecondaryLoading(false);
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault();
    if (!resetEmail) return;
    setSecondaryLoading(true);
    await new Promise(r => setTimeout(r, 1400));
    setSecondaryLoading(false);
    setResetDone(true);
  }

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    if (!reqName || !reqEmail) return;
    setSecondaryLoading(true);
    await new Promise(r => setTimeout(r, 1400));
    setSecondaryLoading(false);
    setReqDone(true);
  }

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const mods = (user as any)?.modules as string[] | undefined ?? [];
    if (mods.includes('portal')) { navigate('/portal'); return; }
    if (mods.includes('partner') || user?.role?.category === 'org_external') { navigate('/partner'); return; }
    navigate('/dashboard');
  }, [isAuthenticated, user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) { setError('Please enter your email and password.'); return; }
    setError('');
    setSubmitting(true);
    const result = await login(email, password);
    setSubmitting(false);
    if (result.ok) {
      try {
        const freshUser = JSON.parse(localStorage.getItem('ewms_user') ?? '{}');
        const mods: string[] = freshUser.modules ?? [];
        if (mods.includes('portal')) {
          navigate('/portal');
        } else if (mods.includes('partner') || freshUser.role?.category === 'org_external') {
          navigate('/partner');
        } else {
          navigate('/dashboard');
        }
      } catch {
        navigate('/dashboard');
      }
    } else {
      setError(result.error ?? 'Invalid credentials');
    }
  }

  return (
    <>
      <style>{CSS}</style>
      <div className="el-root">

        {/* Layer 1 — Aurora blobs */}
        <div className="el-blob el-blob-teal" />
        <div className="el-blob el-blob-purple" />
        <div className="el-blob el-blob-amber" />
        <div className="el-blob el-blob-pink" />

        {/* Layer 2 — Ships */}
        {SHIPS.map((s, i) => (
          <div
            key={i}
            className="el-ship"
            style={{
              top: s.top,
              opacity: s.opacity,
              animation: `${s.dir} ${s.duration} ${s.delay} linear infinite`,
            }}
          >
            <div style={{ animation: 'bob 3.5s ease-in-out infinite' }}>
              <ShipSVG w={Math.round(160 * s.scale)} h={Math.round(55 * s.scale)} />
            </div>
          </div>
        ))}

        {/* Layer 3 — Particles */}
        {PARTICLES.map((p, i) => (
          <div
            key={i}
            className="el-particle"
            style={{
              left: p.left, top: p.top,
              width: p.size, height: p.size,
              background: p.color,
              animation: `twinkle ${p.duration} ${p.delay} ease-in-out infinite`,
            }}
          />
        ))}

        {/* Layer 4 — Ghost codes */}
        {CODES.map((code, i) => (
          <div
            key={code}
            className="el-code"
            style={{
              left: `${i < 4 ? 10 + i * 24 : 10 + (i - 4) * 24}%`,
              top:  i < 4 ? '20%' : '75%',
              ['--gf-dur' as any]: `${5 + (i % 3)}s`,
              ['--gf-del' as any]: `-${(i * 0.8).toFixed(1)}s`,
            }}
          >
            {code}
          </div>
        ))}

        {/* Layer 5 — Vignette */}
        <div className="el-vignette" />

        {/* Two-column content grid */}
        <div className="el-content">

          {/* ── LEFT: marketing ── */}
          <div className="el-left">
            <div className="el-eyebrow">MANUFACTURING SUPPLY · PORT TO LEDGER</div>

            <div className="el-headline">
              Ship, prove, and close the loop on
              <span className="el-headline-teal">industrial export programmes</span>
            </div>

            <div className="el-subhead">
              Manufacturers and exporters run dense ocean programmes with customs evidence,
              CHA or broker spend, and finance close behind every move.
            </div>

            <div className="el-pillars">
              <div className="el-pillar">
                <div className="el-pillar-icon">◈</div>
                <div className="el-pillar-label">Shipment 360°</div>
                <div className="el-pillar-desc">Loads, cut-offs, and port milestones in one lane</div>
              </div>
              <div className="el-pillar">
                <div className="el-pillar-icon">◇</div>
                <div className="el-pillar-label">Document control</div>
                <div className="el-pillar-desc">Commercial invoices, packing lists, and CBP FORM-7501-ready packs checked to policy</div>
              </div>
              <div className="el-pillar">
                <div className="el-pillar-icon">◎</div>
                <div className="el-pillar-label">Finance handoff</div>
                <div className="el-pillar-desc">Pre-built journal lines staged for ERP posting</div>
              </div>
            </div>

            <div className="el-flow">
              <div className="el-flow-node">
                <div className="el-flow-label">Yard &amp; load</div>
                <div className="el-flow-sub" style={{ color: 'rgb(93,202,165)' }}>FCL plan, gate, ocean milestones</div>
              </div>
              <div className="el-flow-arrow">→</div>
              <div className="el-flow-node">
                <div className="el-flow-label">Documents</div>
                <div className="el-flow-sub" style={{ color: 'rgb(229,155,45)' }}>CI, packing list, customs pack</div>
              </div>
              <div className="el-flow-arrow">→</div>
              <div className="el-flow-node">
                <div className="el-flow-label">Books</div>
                <div className="el-flow-sub" style={{ color: 'rgb(110,95,210)' }}>Dr / Cr lines ready for ERP</div>
              </div>
            </div>

            <div className="el-closing">Physical move → document evidence → balanced ledger</div>
          </div>

          {/* ── RIGHT: login card ── */}
          <div className="el-right">
          <div className="el-card">
            {/* Logo row — always visible */}
            <div className="el-logo-row">
              <div className="el-logo-mark">
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                  <rect x="3"  y="3"  width="7" height="7" rx="1.5" fill="white" opacity="0.9" />
                  <rect x="12" y="3"  width="7" height="7" rx="1.5" fill="white" opacity="0.6" />
                  <rect x="3"  y="12" width="7" height="7" rx="1.5" fill="white" opacity="0.6" />
                  <rect x="12" y="12" width="7" height="7" rx="1.5" fill="white" opacity="0.35" />
                </svg>
              </div>
              <div className="el-logo-name">EWMS</div>
              <div className="el-preview-badge">preview</div>
            </div>

            {/* ── MODE: login ── */}
            {mode === 'login' && (
              <form onSubmit={handleSubmit} noValidate>
                <div className="el-field">
                  <label className={`el-label${focused === 'email' ? ' focused' : ''}`} htmlFor="ewms-email">EMAIL</label>
                  <div className="el-input-wrap">
                    <input id="ewms-email" className="el-input" type="email" placeholder="you@company.com"
                      value={email} onChange={e => setEmail(e.target.value)}
                      onFocus={() => setFocused('email')} onBlur={() => setFocused(null)}
                      autoComplete="email" data-testid="input-email" />
                  </div>
                </div>
                <div className="el-field">
                  <label className={`el-label${focused === 'password' ? ' focused' : ''}`} htmlFor="ewms-password">PASSWORD</label>
                  <div className="el-input-wrap">
                    <input id="ewms-password" className={`el-input has-toggle`}
                      type={showPw ? 'text' : 'password'} placeholder="••••••••"
                      value={password} onChange={e => setPassword(e.target.value)}
                      onFocus={() => setFocused('password')} onBlur={() => setFocused(null)}
                      autoComplete="current-password" data-testid="input-password" />
                    <button type="button" className={`el-toggle${showPw ? ' active' : ''}`}
                      onClick={() => setShowPw(v => !v)} tabIndex={-1}
                      aria-label={showPw ? 'Hide password' : 'Show password'}>
                      {showPw ? '◉' : '◎'}
                    </button>
                  </div>
                </div>
                {error && <div className="el-error" data-testid="login-error">{error}</div>}
                <button type="submit" className="el-btn" disabled={submitting} data-testid="button-login">
                  <span className="el-btn-shimmer" />
                  <span style={{ position: 'relative' }}>{submitting ? 'Signing in…' : 'Sign in →'}</span>
                </button>
                <div className="el-links">
                  <button type="button" className="el-link" onClick={() => switchMode('forgot')}>Forgot password?</button>
                  <button type="button" className="el-link" onClick={() => switchMode('request')}>Request access</button>
                </div>
              </form>
            )}

            {/* ── MODE: forgot password ── */}
            {mode === 'forgot' && (
              <div>
                <div className="el-mode-title">Reset your password</div>
                <div className="el-mode-desc">Enter your work email and we'll send a reset link if the address is registered.</div>
                {resetDone ? (
                  <div className="el-success-box">
                    <div className="el-success-icon">✓</div>
                    <div>
                      <div className="el-success-title">Check your inbox</div>
                      <div className="el-success-sub">If <strong>{resetEmail}</strong> is registered, a reset link is on its way.</div>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleForgot} noValidate>
                    <div className="el-field" style={{ marginTop: 20 }}>
                      <label className="el-label">EMAIL</label>
                      <div className="el-input-wrap">
                        <input className="el-input" type="email" placeholder="you@company.com"
                          value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                          autoComplete="email" />
                      </div>
                    </div>
                    <button type="submit" className="el-btn" disabled={secondaryLoading || !resetEmail}>
                      <span className="el-btn-shimmer" />
                      <span style={{ position: 'relative' }}>{secondaryLoading ? 'Sending…' : 'Send reset link →'}</span>
                    </button>
                  </form>
                )}
                <div className="el-back-row">
                  <button type="button" className="el-link" onClick={() => switchMode('login')}>← Back to sign in</button>
                </div>
              </div>
            )}

            {/* ── MODE: request access ── */}
            {mode === 'request' && (
              <div>
                <div className="el-mode-title">Request access</div>
                <div className="el-mode-desc">Tell us about yourself and someone from our team will reach out within one business day.</div>
                {reqDone ? (
                  <div className="el-success-box">
                    <div className="el-success-icon">✓</div>
                    <div>
                      <div className="el-success-title">Request received</div>
                      <div className="el-success-sub">We'll be in touch at <strong>{reqEmail}</strong> shortly.</div>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleRequest} noValidate>
                    <div className="el-field" style={{ marginTop: 20 }}>
                      <label className="el-label">FULL NAME</label>
                      <div className="el-input-wrap">
                        <input className="el-input" type="text" placeholder="Jane Smith"
                          value={reqName} onChange={e => setReqName(e.target.value)} />
                      </div>
                    </div>
                    <div className="el-field">
                      <label className="el-label">WORK EMAIL</label>
                      <div className="el-input-wrap">
                        <input className="el-input" type="email" placeholder="you@company.com"
                          value={reqEmail} onChange={e => setReqEmail(e.target.value)}
                          autoComplete="email" />
                      </div>
                    </div>
                    <div className="el-field">
                      <label className="el-label">ROLE / COMPANY <span style={{ opacity: 0.4, fontWeight: 400 }}>(optional)</span></label>
                      <div className="el-input-wrap">
                        <input className="el-input" type="text" placeholder="e.g. Finance Manager, ABC Exports"
                          value={reqRole} onChange={e => setReqRole(e.target.value)} />
                      </div>
                    </div>
                    <button type="submit" className="el-btn" disabled={secondaryLoading || !reqName || !reqEmail}>
                      <span className="el-btn-shimmer" />
                      <span style={{ position: 'relative' }}>{secondaryLoading ? 'Submitting…' : 'Submit request →'}</span>
                    </button>
                  </form>
                )}
                <div className="el-back-row">
                  <button type="button" className="el-link" onClick={() => switchMode('login')}>← Back to sign in</button>
                </div>
              </div>
            )}

            <div className="el-card-footer">
              <svg width="11" height="13" viewBox="0 0 11 13" fill="none">
                <rect x="1" y="5" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M3 5V3.5a2.5 2.5 0 0 1 5 0V5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
              Secured by SPR Consultech
            </div>
          </div>
          </div>{/* el-right */}

        </div>{/* el-content */}
      </div>
    </>
  );
}
