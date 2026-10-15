import { Link, NavLink, Outlet, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./auth.js";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link className="brand" to="/" aria-label="DuelKe home">
    <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 40 40" fill="none"><path d="M8 31V9h8l8 11 8-11h1v22h-7V20l-2 3h-2l-2-3v11H8Z" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round"/><path d="M9 34h23" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg></span>
    {!compact && <span className="brand-word">DUEL<span>KE</span><small>PLAY THE BOARD</small></span>}
  </Link>;
}

function SiteHeader() {
  const { user, signOut } = useAuth();
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const isHome = pathname === "/";
  useEffect(() => {
    const updateScroll = () => setScrolled(window.scrollY > 12);
    updateScroll();
    window.addEventListener("scroll", updateScroll, { passive: true });
    return () => window.removeEventListener("scroll", updateScroll);
  }, []);
  useEffect(() => setMenuOpen(false), [pathname]);
  return <header className={`site-header${isHome ? " site-header-home" : ""}${isHome && scrolled ? " is-scrolled" : ""}`}><div className="nav-inner">
    <Brand />
    <nav className={`main-nav${menuOpen ? " is-open" : ""}`} id="main-nav-menu" aria-label="Main navigation">
      <NavLink to="/" end onClick={() => setMenuOpen(false)}>Home</NavLink><NavLink to="/games" onClick={() => setMenuOpen(false)}>Games</NavLink><NavLink to="/how-it-works" onClick={() => setMenuOpen(false)}>How it works</NavLink><NavLink to="/fair-play" onClick={() => setMenuOpen(false)}>Fair play</NavLink>
      <div className="mobile-nav-auth">{user ? <><Link to="/dashboard" onClick={() => setMenuOpen(false)}>Dashboard <span aria-hidden="true">↗</span></Link><button type="button" onClick={() => { setMenuOpen(false); void signOut(); }}>Sign out</button></> : <><Link to="/login" onClick={() => setMenuOpen(false)}>Log in</Link><Link to="/register" onClick={() => setMenuOpen(false)}>Create account <span aria-hidden="true">↗</span></Link></>}</div>
    </nav>
    <div className="nav-actions">
      {user ? <><Link className="nav-user" to="/dashboard">{user.username}<span className="avatar-mini">{user.username.slice(0,1).toUpperCase()}</span></Link><button className="text-button" onClick={() => void signOut()}>Sign out</button></> : <><Link className="text-button" to="/login">Log in</Link><Link className="button button-small" to="/register">Create account <span aria-hidden="true">↗</span></Link></>}
    </div>
    <button className={`mobile-menu-toggle${menuOpen ? " is-open" : ""}`} type="button" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} aria-controls="main-nav-menu" onClick={() => setMenuOpen((open) => !open)}><span className="menu-toggle-icon" aria-hidden="true"><i/><i/></span></button>
  </div></header>;
}

function SiteFooter() {
  return <footer className="site-footer"><div className="footer-inner"><div className="footer-brand"><Brand /><p>Skill first. Rules clear.<br/>Every match starts on equal ground.</p></div><div className="footer-links"><div><strong>Play</strong><Link to="/games">Games</Link><Link to="/how-it-works">How it works</Link><Link to="/faq">FAQ</Link></div><div><strong>Principles</strong><Link to="/fair-play">Fair play</Link><Link to="/responsible-play">Player protection</Link><Link to="/support">Support</Link></div><div><strong>Policies</strong><Link to="/terms">Terms</Link><Link to="/privacy">Privacy</Link><Link to="/wallet-policy">Wallet policy</Link></div></div></div><div className="footer-bottom"><span>© {new Date().getFullYear()} DuelKe</span><span>Virtual credits only · Live money is disabled</span></div></footer>;
}

export function SiteLayout() { return <><SiteHeader/><main className="site-main"><Outlet/></main><SiteFooter/></>; }
export function AdminLayout() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><span className="loader"/>Checking your session…</div>;
  if (!user) return <Navigate to="/login" replace/>;
  if (!(["super_admin","finance","support","verification"].includes(user.role))) return <Navigate to="/dashboard" replace/>;
  return <div className="admin-shell"><aside className="admin-sidebar"><Brand/><div className="admin-label">OPERATIONS</div><NavLink to="/admin">Overview</NavLink><NavLink to="/admin/users">Players</NavLink><NavLink to="/admin/matches">Matches</NavLink><NavLink to="/admin/support">Support</NavLink><NavLink to="/admin/verification">Verification</NavLink><NavLink to="/admin/finance">Finance</NavLink><NavLink to="/admin/reconciliation">Reconciliation</NavLink><NavLink to="/admin/disputes">Disputes</NavLink><NavLink to="/admin/audit">Audit log</NavLink><Link to="/dashboard" className="admin-return">← Player view</Link></aside><main className="admin-main"><Outlet/></main></div>;
}
export function RequireUser({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth(); const location = useLocation();
  if (loading) return <div className="loading-screen"><span className="loader"/>Checking your session…</div>;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace/>;
  return children;
}
export function AdminOnly({ children, roles = ["super_admin"] }: { children: ReactNode; roles?: string[] }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace/>;
  if (!roles.includes(user.role)) return <section className="page narrow"><p className="eyebrow">ACCESS RESTRICTED</p><h1>This area is not available to your role.</h1><p className="muted">Administrative permissions are assigned deliberately. Contact an administrator if you believe this is an error.</p><Link className="button" to="/dashboard">Return to dashboard</Link></section>;
  return children;
}

export function PageIntro({ eyebrow, title, children, action }: { eyebrow?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="page-intro"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{children && <p className="page-lede">{children}</p>}</div>{action && <div>{action}</div>}</div>;
}
export function Notice({ kind = "info", children }: { kind?: "info" | "success" | "error" | "warning"; children: ReactNode }) { return <div className={`notice notice-${kind}`} role={kind === "error" ? "alert" : "status"}>{children}</div>; }
export function Loading({ label = "Loading…" }: { label?: string }) { return <div className="loading-inline"><span className="loader"/>{label}</div>; }
export function StatCard({ label, value, note }: { label: string; value: ReactNode; note?: string }) { return <article className="stat-card"><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>; }
export function Page({ children, className = "" }: { children: ReactNode; className?: string }) { return <section className={`page ${className}`}>{children}</section>; }
export function FormField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className="form-field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
