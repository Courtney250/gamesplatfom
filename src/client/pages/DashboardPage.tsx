import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../auth.js";
import { Notice, Page, PageIntro, StatCard } from "../components.js";
import { formatKes } from "../money-format.js";

type DashboardData = {
  user: { username: string; email: string };
  wallet: { availableKes: string; reservedKes: string };
  stats: { matches: number; wins: number; losses: number; draws: number; winRate: number };
  pendingWithdrawals: string;
  paymentTotals: { deposits_kes: string; withdrawals_kes: string };
  activeMatches: Array<{ id: string; game: string; status: string; stake_kes: string; created_at: string }>;
  notifications: Array<{ id: string; title: string; body: string; read_at: string | null; created_at: string }>;
  recentMatches: Array<{ id: string; game: string; status: string; stake_kes: string; fee_kes: string; result: string | null; created_at: string }>;
  supportTickets: Array<{ id: string; subject: string; status: string; priority: string; updated_at: string }>;
  disputes: Array<{ id: string; match_id: string; reason: string; status: string; created_at: string }>;
  verification: { ageVerified: boolean; identityVerified: boolean };
  realMoneyEnabled: boolean;
};
type Transactions = { payments: Array<{ id: string; gateway: string; kind: string; currency: string; amount_kes: string; status: string; created_at: string }>; ledger: Array<{ id: string; transaction_type: string; description: string; created_at: string }> };

export function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [transactions, setTransactions] = useState<Transactions | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [amount, setAmount] = useState("500");
  const load = useCallback(async () => {
    setError("");
    try {
      const [summary, tx] = await Promise.all([api<DashboardData>("/api/dashboard"), api<Transactions>("/api/wallet/transactions")]);
      setData(summary); setTransactions(tx);
    } catch (error) { setError(error instanceof Error ? error.message : "Dashboard data is not available."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const addPractice = async () => {
    setBusy(true); setNotice(""); setError("");
    try {
      const result = await api<{ notice: string }>("/api/wallet/virtual-credits", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ amountKes: amount }) });
      setNotice(result.notice); await load();
    } catch (error) { setError(error instanceof Error ? error.message : "Practice-credit simulation failed."); }
    finally { setBusy(false); }
  };
  const markRead = async (id: string) => { try { await api(`/api/notifications/${id}/read`, { method: "POST", body: "{}" }); await load(); } catch (error) { setError(error instanceof Error ? error.message : "Could not update notification."); } };

  return <Page className="dashboard-page">
    <PageIntro eyebrow="PLAYER DASHBOARD" title={`Good to see you, ${user?.username ?? "player"}.`} action={<Link to="/play" className="button button-gold">Find a match <span aria-hidden="true">↗</span></Link>}>Your account, virtual wallet and recent matches—together in one place.</PageIntro>
    {error && <Notice kind="error">{error} {!data && "Dashboard data requires PostgreSQL to be configured."}</Notice>}
    {notice && <Notice kind="success">{notice}</Notice>}
    {data && <>
      <div className="stat-grid"><StatCard label="AVAILABLE · VIRTUAL" value={formatKes(data.wallet.availableKes)} note="Not cash · Not withdrawable"/><StatCard label="RESERVED · VIRTUAL" value={formatKes(data.wallet.reservedKes)} note="Held only for active matches"/><StatCard label="MATCHES PLAYED" value={data.stats.matches} note={`${data.stats.wins} wins · ${data.stats.draws} draws`}/><StatCard label="WIN RATE" value={`${data.stats.winRate}%`} note={`${data.stats.losses} losses`}/></div>
      <div className="dashboard-grid">
        <section className="content-card"><div className="card-heading"><div><p className="eyebrow">CASH PAYMENT HISTORY</p><h2>Confirmed totals.</h2></div><span className="status-pill">KES · confirmed only</span></div><div className="mini-rule"><span>Successful deposits</span><b>{formatKes(data.paymentTotals.deposits_kes)}</b></div><div className="mini-rule"><span>Successful withdrawals</span><b>{formatKes(data.paymentTotals.withdrawals_kes)}</b></div><div className="mini-rule"><span>Pending withdrawals</span><b>{data.pendingWithdrawals}</b></div><small className="security-note">Current release: live deposits and withdrawals are disabled. Virtual credits are shown separately above.</small></section>
        <section className="content-card"><div className="card-heading"><div><p className="eyebrow">ACTIVE MATCHES</p><h2>Continue a game.</h2></div></div>{data.activeMatches.length ? data.activeMatches.map(match=><div className="mini-rule" key={match.id}><span>{match.game} · {match.status}</span><Link className="inline-link" to={`/matches/${match.id}`}>Rejoin match →</Link></div>) : <div className="empty-state"><p>No active matches.</p><Link className="inline-link" to="/play">Find a match →</Link></div>}</section>
      </div>
      <div className="dashboard-grid">
        <section className="content-card"><div className="card-heading"><div><p className="eyebrow">YOUR NEXT MOVE</p><h2>Find a fair match.</h2></div><span className="status-pill status-ready"><i/> 2 GAMES LIVE</span></div><p className="muted">Choose Chess or Checkers. Free matches are always available; optional stakes use virtual credits only.</p><div className="quick-games"><Link to="/play?game=chess"><span>♞</span><b>Chess</b><small>Classical strategy</small><i>→</i></Link><Link to="/play?game=checkers"><span>◉</span><b>Checkers</b><small>Forced-capture tactics</small><i>→</i></Link></div><Link to="/play" className="button button-gold">Open match finder</Link></section>
        <section className="content-card practice-card"><p className="eyebrow">PRACTICE CREDITS</p><h2>Try the wallet simulation.</h2><p className="muted">No M-Pesa prompt. No real deposit. The virtual allowance is capped at KSh 50,000 per rolling day.</p><label className="form-field"><span>Practice amount · virtual KSh</span><input type="number" min="1" max="10000" step="1" value={amount} onChange={event => setAmount(event.target.value)}/></label><button className="button button-quiet" onClick={() => void addPractice()} disabled={busy}>{busy ? "Applying…" : "Simulate practice credits"}</button><small className="security-note">A practice action creates virtual credits only; it is not a payment or redeemable balance.</small><div className="mini-rule"><span>AGE / IDENTITY STATUS</span><b>{data.verification.ageVerified && data.verification.identityVerified ? "Verified" : "Not verified"}</b></div><Link to="/account/verification" className="inline-link">See verification information →</Link></section>
      </div>
      <div className="dashboard-grid">
        <section className="content-card"><div className="card-heading"><div><p className="eyebrow">RECENT MATCHES</p><h2>Your record.</h2></div><Link to="/play" className="inline-link">Play now →</Link></div>{data.recentMatches.length ? <div className="table-wrap"><table><thead><tr><th>Game</th><th>Outcome</th><th>Virtual stake</th><th>Date</th></tr></thead><tbody>{data.recentMatches.map(match => <tr key={match.id}><td><Link to={`/matches/${match.id}`}>{match.game}</Link></td><td><span className="status-pill">{match.result ?? match.status}</span></td><td>{formatKes(match.stake_kes)}</td><td>{new Date(match.created_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span>♟</span><p>Your first match is waiting.</p><Link className="inline-link" to="/play">Choose a game →</Link></div>}</section>
        <section className="content-card"><div className="card-heading"><div><p className="eyebrow">ACCOUNT & SECURITY</p><h2>Keep it protected.</h2></div></div><div className="mini-rule"><span>EMAIL</span><b className="truncate">{data.user.email}</b></div><div className="mini-rule"><span>VERIFICATION</span><b>{data.verification.ageVerified && data.verification.identityVerified ? "Verified" : "Free play ready"}</b></div><Link className="inline-link" to="/account/security">Review security settings →</Link><br/><Link className="inline-link" to="/account/verification">View verification status →</Link></section>
      </div>
      <div className="dashboard-grid">
        <section className="content-card"><div className="card-heading"><div><p className="eyebrow">RECENT ACTIVITY</p><h2>Wallet history.</h2></div></div>{transactions && (transactions.payments.length || transactions.ledger.length) ? <div className="activity-list">{transactions.payments.slice(0,6).map(payment => <div className="activity-row" key={`payment-${payment.id}`}><span className="activity-icon" aria-hidden="true">{payment.gateway === "simulation" ? "↻" : "↗"}</span><div><b>{payment.gateway === "simulation" ? "Virtual-credit simulation" : payment.kind}</b><small>{new Date(payment.created_at).toLocaleString()} · {payment.status}</small></div><strong>{formatKes(payment.amount_kes)} <small>{payment.currency}</small></strong></div>)}{transactions.ledger.slice(0,8).map(entry => <div className="activity-row" key={`ledger-${entry.id}`}><span className="activity-icon" aria-hidden="true">↔</span><div><b>{entry.description || entry.transaction_type.replaceAll("_", " ")}</b><small>{new Date(entry.created_at).toLocaleString()} · {entry.transaction_type.replaceAll("_", " ")}</small></div><strong>Posted</strong></div>)}</div> : <div className="empty-state"><p>No wallet activity yet.</p><small>Match results and simulated credits will appear here.</small></div>}</section>
        <section className="content-card"><div className="card-heading"><div><p className="eyebrow">NOTIFICATIONS</p><h2>Stay in the game.</h2></div></div>{data.notifications.length ? data.notifications.map(notification => <button className={`notification-row ${notification.read_at ? "notification-read" : ""}`} key={notification.id} onClick={() => void markRead(notification.id)} aria-label={`Mark notification as read: ${notification.title}`}><span className="notification-dot"/><span><b>{notification.title}</b><small>{notification.body}</small></span><time>{new Date(notification.created_at).toLocaleDateString()}</time></button>) : <div className="empty-state"><p>You’re all caught up.</p></div>}<Link className="inline-link" to="/support">Need help? Open a ticket →</Link></section>
      </div>
      <div className="dashboard-grid">
        <section className="content-card"><div className="card-heading"><div><p className="eyebrow">SUPPORT HISTORY</p><h2>Your support requests.</h2></div><Link className="inline-link" to="/support">Contact support →</Link></div>{data.supportTickets.length ? data.supportTickets.slice(0,8).map(ticket=><div className="mini-rule" key={ticket.id}><Link to={`/support/tickets/${ticket.id}`}>{ticket.subject}</Link><span className="status-pill">{ticket.status}</span></div>) : <div className="empty-state"><p>No support requests.</p></div>}</section>
        <section className="content-card"><div className="card-heading"><div><p className="eyebrow">MATCH DISPUTES</p><h2>Your reports.</h2></div></div>{data.disputes.length ? data.disputes.slice(0,8).map(dispute=><div className="mini-rule" key={dispute.id}><Link to={`/matches/${dispute.match_id}`}>{dispute.reason}</Link><span className="status-pill">{dispute.status}</span></div>) : <div className="empty-state"><p>No match disputes.</p></div>}</section>
      </div>
      <div className="notice notice-warning"><strong>Live money is disabled.</strong> There are no cash deposits, cash prizes or withdrawals. {data.pendingWithdrawals !== "0" && "Contact support about any historic pending request."}</div>
    </>}
  </Page>;
}
