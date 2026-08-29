import { useEffect, useState } from 'react';
import {
  AlertOctagon,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  History,
  Lock,
  Search,
  Sparkles,
  Terminal,
  UploadCloud,
  Users,
  XCircle,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function StatusBadge({ status }) {
  const map = {
    pending: { label: 'PENDING', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
    pending_review: { label: 'PENDING', cls: 'text-amber-400 bg-amber-500/10 border-amber-500/30' },
    deferred_for_team_review: { label: 'TEAM REVIEW', cls: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30' },
    cleared_for_disbursement: { label: 'APPROVED', cls: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
    rejected: { label: 'BLOCKED', cls: 'text-rose-400 bg-rose-500/10 border-rose-500/30' },
  };
  const s = map[status] || { label: status, cls: 'text-slate-400 bg-slate-500/10 border-slate-500/30' };
  return <span className={`inline-block whitespace-nowrap px-2.5 py-1 rounded-full border text-xs font-bold ${s.cls}`}>{s.label}</span>;
}

// ---------------------------------------------------------------------------
// Page 1: Submit an invoice. Uploads, shows the triage summary, then hands
// off to the AI Invoice Forensic page (via onSubmitted) for the full report
// and — if this claim needs one — the human review step.
// ---------------------------------------------------------------------------
function SubmitPage({ onSubmitted }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [ngoId, setNgoId] = useState('ngo_demo');
  const [budgetLimit, setBudgetLimit] = useState('200000');

  async function upload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true); setResult(null);
    const form = new FormData();
    form.append('file', file);
    form.append('budget_limit', budgetLimit || '200000');
    form.append('ngo_id', ngoId || 'ngo_demo');
    try {
      const res = await fetch(`${API}/invoice`, { method: 'POST', body: form });
      const data = await res.json();
      setResult(data);
      if (!data.error) onSubmitted(data.invoice_hash);
    } catch {
      setResult({ error: 'Risk service unavailable. Start FastAPI.' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl w-full mx-auto glass-panel p-8 rounded-2xl border border-slate-700/60 shadow-2xl">
      <h2 className="text-2xl font-bold mb-2">NGO Claim Submission</h2>
      <p className="text-sm text-slate-400 mb-6">Upload a vendor invoice to begin triage.</p>

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <label className="block text-sm text-slate-400">
          NGO / project ID
          <input
            className="mt-1 w-full rounded-lg bg-slate-900/80 border border-slate-800 px-3 py-2 text-slate-100 focus:border-cyan-500/60 outline-none transition"
            value={ngoId}
            onChange={e => setNgoId(e.target.value)}
            placeholder="ngo_demo"
          />
        </label>
        <label className="block text-sm text-slate-400">
          Milestone budget limit
          <input
            type="number"
            className="mt-1 w-full rounded-lg bg-slate-900/80 border border-slate-800 px-3 py-2 text-slate-100 focus:border-cyan-500/60 outline-none transition"
            value={budgetLimit}
            onChange={e => setBudgetLimit(e.target.value)}
          />
        </label>
      </div>

      {!result && (
        <label className="group cursor-pointer border-2 border-dashed border-cyan-500/40 hover:border-cyan-400 rounded-2xl p-12 text-center transition bg-slate-900/40 hover:bg-slate-900/80 relative block w-full">
          <input hidden type="file" onChange={upload} />
          <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 mx-auto flex items-center justify-center mb-4 group-hover:scale-110 transition shadow-[0_0_25px_rgba(6,182,212,0.3)]">
            <UploadCloud className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white mb-1">{loading ? 'Scoring…' : 'Click to Upload Invoice'}</h3>
          <div className="mt-6 inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-300 text-xs font-bold border border-cyan-500/40">
            <Sparkles className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>Auto-Compute SHA-256</span>
          </div>
        </label>
      )}

      {result && !result.error && (
        <div className="p-8 rounded-2xl bg-slate-900/80 border border-slate-700 text-center space-y-4">
          <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto" />
          <h3 className="text-xl font-bold text-white">Invoice Hashed &amp; Triaged</h3>
          <p className="font-mono text-xs text-slate-400 break-all bg-black/50 p-3 rounded-lg border border-slate-800">
            SHA-256: {result.invoice_hash}
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <StatusBadge status={result.disbursement_status} />
            <span className="text-xs text-slate-500">status flag only — not a fund transfer</span>
          </div>
          <button
            onClick={() => onSubmitted(result.invoice_hash)}
            className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 font-bold text-sm shadow-[0_0_15px_rgba(6,182,212,0.4)]"
          >
            View AI Forensic Scan Output
          </button>
        </div>
      )}
      {result?.error && <p className="text-sm text-rose-400">{result.error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page 2: AI Invoice Forensic. Left panel is the old "Oracle Execution
// Stream" terminal look; right panel shows the AI's report and, since a
// medium/high-risk claim always needs a human, the review action itself —
// the reviewer reads the AI's case before deciding.
// ---------------------------------------------------------------------------
function ForensicPage({ invoiceHash, onChangeHash }) {
  const [hashInput, setHashInput] = useState(invoiceHash || '');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reviewerId, setReviewerId] = useState('');
  const [reviewMsg, setReviewMsg] = useState(null);
  const [decisionMade, setDecisionMade] = useState(null);

  async function load(hash) {
    if (!hash) return;
    setLoading(true); setNotFound(false); setReviewMsg(null); setDecisionMade(null);
    try {
      const res = await fetch(`${API}/forensic/${hash}`);
      if (res.status === 404) { setNotFound(true); setReport(null); return; }
      setReport(await res.json());
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (invoiceHash) { setHashInput(invoiceHash); load(invoiceHash); } }, [invoiceHash]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submitReview(decision) {
    if (!reviewerId.trim()) { setReviewMsg('A reviewer ID is required — this is enforced by the server, not just this form.'); return; }
    try {
      const res = await fetch(`${API}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Reviewer-Id': reviewerId.trim() },
        body: JSON.stringify({
          invoice_hash: report.invoice_hash,
          ngo_id: report.ngo_id,
          risk_score: report.risk_score,
          decision,
          reviewer_id: reviewerId.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setReviewMsg(`Rejected by server: ${data.detail}`); return; }
      setReviewMsg(`Recorded: ${decision} by ${reviewerId.trim()}.`);
      // A deferral isn't final — leave the decision buttons available so the
      // claim can still be approved/blocked later, by this or another
      // reviewer. Only approve/block lock the panel.
      if (decision !== 'deferred_for_team_review') setDecisionMade(decision);
    } catch {
      setReviewMsg('Review service unavailable.');
    }
  }

  // Every claim requires human review, regardless of risk score — this is
  // enforced server-side in write_chain_record (SYSTEM_ACTOR can never
  // finalize a decision), so this isn't just a UI convention.
  const requiresReview = !!report;
  const riskLevel = report ? (report.risk_score >= 50 ? 'HIGH' : report.risk_score >= 25 ? 'MEDIUM' : 'LOW') : null;

  return (
    <div className="w-full space-y-4">
      <div className="flex gap-2 max-w-2xl">
        <input
          className="flex-1 rounded-lg bg-slate-900/80 border border-slate-800 px-3 py-2 text-sm font-mono focus:border-cyan-500/60 outline-none transition"
          placeholder="Paste an invoice hash…"
          value={hashInput}
          onChange={e => setHashInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && (onChangeHash(hashInput), load(hashInput))}
        />
        <button
          onClick={() => { onChangeHash(hashInput); load(hashInput); }}
          className="px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm font-semibold"
        >
          Load
        </button>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading report…</p>}
      {notFound && <p className="text-sm text-rose-400">No forensic report found for that invoice hash.</p>}

      {report && (
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Analysis trace panel */}
          <div className="lg:col-span-5 glass-panel p-6 rounded-2xl border border-slate-700/60 font-mono text-xs flex flex-col justify-between min-h-[420px]">
            <div>
              <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                <div className="flex items-center space-x-2 text-cyan-400">
                  <Terminal className="w-4 h-4" />
                  <span className="font-bold">ANALYSIS TRACE</span>
                </div>
              </div>

              <div className="space-y-3 overflow-y-auto max-h-[320px] pr-2">
                <p className="text-slate-400">&gt; Invoice hash: {report.invoice_hash.slice(0, 18)}…</p>
                <p className="text-cyan-400">&gt; Reading invoice document...</p>
                {report.ai_available ? (
                  <p className="text-indigo-300">&gt; Forensic pass complete: vendor, amount, line items extracted.</p>
                ) : (
                  <p className="text-amber-300">&gt; AI analysis unavailable — fallback extractor used.</p>
                )}
                <p className="text-purple-300">&gt; Duplicate checks: exact-hash + structural near-duplicate (independent).</p>
                <div className={`p-3 rounded-lg space-y-1 ${riskLevel === 'HIGH' ? 'bg-red-950/40 border border-red-500/40 text-red-400' : riskLevel === 'MEDIUM' ? 'bg-amber-950/30 border border-amber-500/40 text-amber-300' : 'bg-emerald-950/30 border border-emerald-500/40 text-emerald-300'}`}>
                  <p className="font-bold">&gt; [{riskLevel}] RISK ASSESSMENT: {report.risk_score}/100</p>
                  {report.issues.map((issue, idx) => (
                    <p key={idx}>&gt; {issue}</p>
                  ))}
                  {report.issues.length === 0 && <p>&gt; No issues flagged.</p>}
                </div>
                <p className="text-slate-400">&gt; Every claim requires human review — no auto-approve path exists.</p>
              </div>
            </div>
          </div>

          {/* Result panel */}
          <div className="lg:col-span-7 glass-panel p-8 rounded-2xl border border-slate-700/60 shadow-2xl flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
                <div className="flex items-center space-x-2">
                  <span className={`w-3 h-3 rounded-full animate-ping ${riskLevel === 'HIGH' ? 'bg-rose-500' : riskLevel === 'MEDIUM' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                  <h3 className="text-xl font-bold text-white">Forensic Risk Score: {report.risk_score}/100</h3>
                </div>
                <span className={`px-3 py-1 rounded-full font-mono text-xs font-bold border ${riskLevel === 'HIGH' ? 'bg-rose-500/10 text-rose-400 border-rose-500/30' : riskLevel === 'MEDIUM' ? 'bg-amber-500/10 text-amber-400 border-amber-500/30' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'}`}>
                  {riskLevel} RISK
                </span>
              </div>

              {!report.ai_available && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-300 flex items-center gap-2 mb-6">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" /> AI analysis unavailable — fallback extractor used.
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                  <p className="text-xs font-mono text-slate-400">Vendor (extracted)</p>
                  <p className="text-lg font-bold text-white mt-1">{report.vendor || '—'}</p>
                </div>
                <div className="bg-slate-900/80 p-4 rounded-xl border border-rose-500/30">
                  <p className="text-xs font-mono text-slate-400">Claimed Amount</p>
                  <p className="text-2xl font-bold text-rose-400 mt-1">₹{report.claimed_amount?.toLocaleString?.() ?? report.claimed_amount}</p>
                </div>
              </div>

              {report.line_items?.length > 0 && (
                <div className="mb-6">
                  <p className="text-xs font-mono text-slate-400 mb-2">Line items</p>
                  <ul className="text-sm text-slate-300 list-disc list-inside space-y-0.5">
                    {report.line_items.map((li, i) => <li key={i}>{li}</li>)}
                  </ul>
                </div>
              )}

              {report.reasoning && (
                <div className="mb-6">
                  <p className="text-xs font-mono text-slate-400 mb-2">AI reasoning</p>
                  <p className="text-sm text-slate-300 bg-slate-900/60 rounded-lg p-3 border border-slate-800">{report.reasoning}</p>
                </div>
              )}

              {report.issues?.length > 0 && (
                <div className="bg-rose-950/30 border border-rose-500/40 rounded-xl p-4 mb-6 space-y-2 text-sm text-rose-200">
                  <div className="flex items-center space-x-2 font-bold text-rose-400">
                    <AlertOctagon className="w-5 h-5 flex-shrink-0" />
                    <span>Flagged Issues:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-xs text-slate-300 font-mono pl-2">
                    {report.issues.map((issue, idx) => <li key={idx}>{issue}</li>)}
                  </ul>
                </div>
              )}

              {requiresReview && !decisionMade && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
                  <p className="text-sm text-amber-300 font-semibold flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" /> A human decision is required.
                  </p>
                  <input
                    className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-100"
                    placeholder="Your reviewer ID"
                    value={reviewerId}
                    onChange={e => setReviewerId(e.target.value)}
                  />
                  <div className="grid grid-cols-3 gap-3">
                    <button onClick={() => submitReview('cleared_for_disbursement')} className="py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm shadow-[0_0_20px_rgba(16,185,129,0.4)] transition flex items-center justify-center gap-2">
                      <ClipboardCheck className="w-4 h-4" /> Approved
                    </button>
                    <button onClick={() => submitReview('deferred_for_team_review')} className="py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm border border-slate-700 transition flex items-center justify-center gap-2">
                      <Users className="w-4 h-4 text-indigo-400" /> Team Review
                    </button>
                    <button onClick={() => submitReview('rejected')} className="py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-[0_0_20px_rgba(244,63,94,0.4)] transition">
                      Blocked
                    </button>
                  </div>
                </div>
              )}
              {decisionMade && (
                <div className={`p-4 rounded-xl border text-center font-mono text-sm font-bold ${
                  decisionMade === 'rejected' ? 'bg-slate-900 border-rose-500 text-rose-400'
                  : decisionMade === 'deferred_for_team_review' ? 'bg-slate-900 border-indigo-500 text-indigo-400'
                  : 'bg-slate-900 border-emerald-500 text-emerald-400'
                }`}>
                  {decisionMade === 'rejected' && '[BLOCKED] — no funds move from this action.'}
                  {decisionMade === 'deferred_for_team_review' && '[TEAM REVIEW] — deferred for further discussion.'}
                  {decisionMade === 'cleared_for_disbursement' && '[APPROVED] — status flag set, not a fund transfer.'}
                </div>
              )}
              {reviewMsg && <p className="text-xs text-slate-300 mt-3">{reviewMsg}</p>}
            </div>
          </div>
        </div>
      )}

      {!report && !loading && !notFound && (
        <div className="text-center py-20 glass-panel rounded-2xl border border-slate-700/60">
          <Cpu className="w-16 h-16 text-slate-600 mx-auto mb-4 animate-bounce" />
          <h3 className="text-xl font-bold text-slate-300 mb-2">No report loaded</h3>
          <p className="text-sm text-slate-500 max-w-md mx-auto">Submit an invoice, or paste a hash above.</p>
        </div>
      )}
    </div>
  );
}

function TransparencyPanel() {
  const [claims, setClaims] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API}/public/claims${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      setClaims(await res.json());
    } catch {
      setClaims([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="w-full glass-panel p-8 rounded-2xl border border-slate-700/60 shadow-2xl">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-white mb-2">Immutable Audit Ledger</h2>
        <p className="text-sm text-slate-400">No login required.</p>
      </div>

      <div className="flex gap-2 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="w-full rounded-lg bg-slate-900 border border-slate-700 pl-9 pr-3 py-2 text-sm"
            placeholder="Search by NGO ID or claim ID…"
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && load()}
          />
        </div>
        <button onClick={load} className="px-4 py-2 rounded-lg bg-slate-900 border border-slate-700 font-mono text-xs text-cyan-400">Search</button>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading…</p> : (
        <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full min-w-[900px] text-left text-sm text-slate-300">
            <thead className="text-xs text-slate-400 font-mono uppercase bg-slate-900/50 border-b border-slate-700">
              <tr>
                <th className="px-4 py-4 whitespace-nowrap">Claim Hash</th>
                <th className="px-4 py-4 whitespace-nowrap">NGO Partner</th>
                <th className="px-4 py-4 whitespace-nowrap">Risk</th>
                <th className="px-4 py-4 whitespace-nowrap">Reviewed By</th>
                <th className="px-4 py-4">Reason</th>
                <th className="px-4 py-4 whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {claims.map(c => (
                <tr key={c.claim_id} className="hover:bg-slate-800/30 transition">
                  <td className="px-4 py-4 font-mono text-cyan-400 whitespace-nowrap">{c.claim_id}</td>
                  <td className="px-4 py-4 font-bold text-white whitespace-nowrap">{c.ngo_id}</td>
                  <td className="px-4 py-4 font-bold text-slate-200 whitespace-nowrap">{c.risk_score} ({c.risk_level})</td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <span className="text-emerald-400 font-mono text-xs">{c.reviewed_by}</span>
                  </td>
                  <td className="px-4 py-4 text-slate-400 min-w-[220px]">{c.reason_summary}</td>
                  <td className="px-4 py-4 whitespace-nowrap">
                    <StatusBadge status={c.decision} />
                  </td>
                </tr>
              ))}
              {claims.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-slate-500">No claims yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[10px] text-slate-600 mt-2 sm:hidden">Scroll right to see all columns →</p>
    </div>
  );
}

function ImpactPanel() {
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => fetch(`${API}/impact`).then(r => r.json()).then(m => { if (!cancelled) setMetrics(m); }).catch(() => {});
    load();
    const id = setInterval(load, 4000); // live refresh while this tab is open
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!metrics) return null;
  const approved = metrics.approved_claims ?? 0;
  const rejected = metrics.rejected_claims ?? 0;
  const pending = metrics.awaiting_human_review ?? 0;
  const deferred = metrics.deferred_claims ?? 0;
  const total = approved + rejected + pending + deferred || 1;
  const segments = [
    { key: 'approved', count: approved, cls: 'bg-emerald-500' },
    { key: 'rejected', count: rejected, cls: 'bg-rose-500' },
    { key: 'deferred', count: deferred, cls: 'bg-indigo-500' },
    { key: 'pending', count: pending, cls: 'bg-amber-500' },
  ];

  return (
    <div className="w-full glass-panel p-8 rounded-2xl border border-slate-700/60 shadow-2xl space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-bold text-white">Impact</h2>
        <span className="flex items-center gap-1.5 text-[10px] font-mono text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> LIVE
        </span>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="text-center">
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
          <p className="text-5xl font-bold text-emerald-400 tabular-nums">{approved}</p>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider">Approved</p>
        </div>
        <div className="text-center">
          <XCircle className="w-8 h-8 text-rose-400 mx-auto mb-2" />
          <p className="text-5xl font-bold text-rose-400 tabular-nums">{rejected}</p>
          <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider">Blocked</p>
        </div>
      </div>

      <div>
        <div className="flex h-3 rounded-full overflow-hidden bg-slate-900 border border-slate-800">
          {segments.map(s => s.count > 0 && (
            <div key={s.key} className={`${s.cls} transition-all duration-500`} style={{ width: `${(s.count / total) * 100}%` }} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-xs text-slate-400">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Approved {approved}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" /> Blocked {rejected}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-500" /> Team review {deferred}</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> Pending {pending}</span>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('submit');
  const [activeHash, setActiveHash] = useState('');
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e) => setMousePos({ x: e.clientX, y: e.clientY });

  const TABS = [
    { id: 'submit', label: '1. NGO Invoice Ingestion', icon: UploadCloud },
    { id: 'forensic', label: '2. AI Forensic Core', icon: Bot },
    { id: 'transparency', label: '3. Global Ledger', icon: History },
    { id: 'impact', label: '4. Impact', icon: CheckCircle2 },
  ];

  return (
    <div
      onMouseMove={handleMouseMove}
      className="min-h-screen relative overflow-hidden bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-cyan-500 selection:text-black"
    >
      <div
        className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-300"
        style={{
          background: `radial-gradient(650px circle at ${mousePos.x}px ${mousePos.y}px, rgba(14, 165, 233, 0.12), transparent 80%)`,
        }}
      />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293715_1px,transparent_1px),linear-gradient(to_bottom,#1f293715_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      <header className="relative z-10 w-full border-b border-slate-800/80 glass-panel px-8 py-4 flex justify-between items-center flex-wrap gap-4">
        <div className="flex items-center space-x-3">
          <div className="relative flex items-center justify-center p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)]">
            <Lock className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-teal-300 to-indigo-400">
              CHAINSHIELD
            </h1>
          </div>
        </div>

        <div className="flex items-center bg-slate-900/90 p-1.5 rounded-xl border border-slate-800 flex-wrap">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-all duration-300 ${
                  isActive
                    ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-[0_0_15px_rgba(6,182,212,0.5)] border border-cyan-300/40'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white animate-pulse' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      <main className="relative z-10 max-w-6xl w-full mx-auto px-6 py-8 flex-grow flex items-center justify-center">
        {activeTab === 'submit' && <SubmitPage onSubmitted={hash => { setActiveHash(hash); setActiveTab('forensic'); }} />}
        {activeTab === 'forensic' && <ForensicPage invoiceHash={activeHash} onChangeHash={setActiveHash} />}
        {activeTab === 'transparency' && <TransparencyPanel />}
        {activeTab === 'impact' && <ImpactPanel />}
      </main>

      <footer className="relative z-10 w-full border-t border-slate-800/80 glass-panel px-8 py-3 flex justify-between items-center text-xs font-mono text-slate-400 flex-wrap gap-2">
        <div className="flex items-center space-x-4">
          <span className="flex items-center text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping mr-2" />
            Attested, not autonomous — every claim requires human review, no exceptions
          </span>
        </div>
        <div className="text-slate-500">
          ChainShield &copy; 2026 — tamper-evident audit trail, not a fund-release oracle. See README.
        </div>
      </footer>
    </div>
  );
}
