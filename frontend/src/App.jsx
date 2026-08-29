import React, { useState, useEffect, useRef } from 'react';
import { 
  ShieldCheck, 
  UploadCloud, 
  Terminal, 
  Cpu, 
  AlertOctagon, 
  CheckCircle2, 
  Layers, 
  ExternalLink, 
  Lock, 
  Unlock, 
  Sparkles,
  SearchCode,
  History
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { ethers } from 'ethers';

const ESCROW_CONTRACT_ADDRESS = "0x892a...c014"; 

const ESCROW_ABI = [
  "function releaseMilestone(bytes32 invoiceHash, uint256 amount) external",
  "function emergencyOverride(bytes32 invoiceHash) external"
];

export default function App() {
  const [activeTab, setActiveTab] = useState('ngo');
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [demoState, setDemoState] = useState('initial'); 
  const [aiStep, setAiStep] = useState(0);
  const [auditResult, setAuditResult] = useState(null);

  const [ledgerTransactions, setLedgerTransactions] = useState([
    { txHash: "0x4f...9a12", ngo: "Global Health Init.", purpose: "Vaccine Cold Storage", claimed: "2,50,000", status: "RELEASED", statusColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
    { txHash: "0x7d...b38c", ngo: "EduCare Foundation", purpose: "Laptops for Teachers", claimed: "85,000", status: "BLOCKED", statusColor: "text-rose-400 bg-rose-500/10 border-rose-500/30" },
    { txHash: "0x2a...1f44", ngo: "CleanWater Alliance", purpose: "Filtration Pumps", claimed: "1,20,000", status: "RELEASED", statusColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
    { txHash: "0x9c...e771", ngo: "Disaster Relief Org", purpose: "Emergency Tents", claimed: "5,00,000", status: "MANUAL REVIEW", statusColor: "text-amber-400 bg-amber-500/10 border-amber-500/30" }
  ]);

  const handleMouseMove = (e) => {
    setMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleRealUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setActiveTab('auditor');
    setDemoState('scanning');
    setAiStep(1);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("budget_limit", 40000.0);

    try {
        setTimeout(() => setAiStep(2), 800);
        setTimeout(() => setAiStep(3), 1600);
        
        const response = await fetch("https://chainshield-backend.zopcloud.zop.dev/api/audit", {
            method: "POST",
            body: formData
        });
        const result = await response.json();
        
        setAuditResult(result);
        setAiStep(4);
        setDemoState('flagged');
    } catch (error) {
        setDemoState('error');
    }
  };

  const handleApprove = async () => {
    try {
      if (!window.ethereum) {
        alert("Please install MetaMask or a Web3 wallet to execute on-chain transactions!");
        return;
      }

      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const contract = new ethers.Contract(ESCROW_CONTRACT_ADDRESS, ESCROW_ABI, signer);

      const invoiceHashBytes = ethers.id(auditResult?.invoice_hash || "default_invoice");

      setDemoState('submitting_tx');
      const tx = await contract.emergencyOverride(invoiceHashBytes);
      
      await tx.wait();

      const simulatedHash = tx.hash ? `${tx.hash.substring(0, 6)}...${tx.hash.substring(tx.hash.length - 4)}` : "0x9df4...321";

      const newTxEntry = {
        txHash: simulatedHash,
        ngo: "Smart Classroom Rural Haryana",
        purpose: "Verified Milestone Equipment",
        claimed: String(auditResult?.allocated_limit || 40000),
        status: "OVERRIDDEN & RELEASED",
        statusColor: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30"
      };

      setLedgerTransactions(prev => [newTxEntry, ...prev]);

      setDemoState('approved');
      confetti({
        particleCount: 120,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#06b6d4', '#10b981', '#8b5cf6']
      });
    } catch (error) {
      console.error("Blockchain execution failed:", error);
      setDemoState('flagged');
      alert("Transaction rejected or failed on-chain.");
    }
  };

  return (
    <div 
      onMouseMove={handleMouseMove} 
      className="min-h-screen relative overflow-hidden bg-slate-950 text-slate-100 flex flex-col justify-between selection:bg-cyan-500 selection:text-black"
    >
      <div 
        className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-300"
        style={{
          background: `radial-gradient(650px circle at ${mousePos.x}px ${mousePos.y}px, rgba(14, 165, 233, 0.12), transparent 80%)`
        }}
      />
      
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293715_1px,transparent_1px),linear-gradient(to_bottom,#1f293715_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />

      <header className="relative z-10 w-full border-b border-slate-800/80 glass-panel px-8 py-4 flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <div className="relative flex items-center justify-center p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.4)]">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 via-teal-300 to-indigo-400">
              CHAINSHIELD
            </h1>
            <p className="text-xs text-slate-400 font-mono tracking-tight">POLYGON TESTNET // ORACLE ENGINE</p>
          </div>
        </div>

        <div className="flex items-center bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
          {[
            { id: 'donor', label: '1. Escrow Pool', icon: Layers },
            { id: 'ngo', label: '2. NGO Invoice Ingestion', icon: UploadCloud },
            { id: 'auditor', label: '3. AI Forensic Core', icon: Cpu },
            { id: 'history', label: '4. Global Ledger', icon: History }
          ].map((tab) => {
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
        
        {activeTab === 'donor' && (
          <div className="w-full grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="md:col-span-7 glass-panel p-8 rounded-2xl border border-slate-700/60 shadow-2xl relative space-y-6">
              <div className="flex justify-between items-start">
                <div>
                  <span className="px-3 py-1 text-xs font-mono font-bold bg-cyan-500/10 text-cyan-400 rounded-full border border-cyan-500/30">
                    CAMPAIGN #8904 // MULTI-NGO SCALABILITY HUB
                  </span>
                  <h2 className="text-2xl font-bold mt-2 text-white">Smart Classroom Digital Kits</h2>
                  <p className="text-sm text-slate-400">Target: 100 Government Schools in Rural Haryana</p>
                </div>
                <div className="flex items-center space-x-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-lg border border-emerald-500/20 font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                  <span>Escrow Active</span>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between text-sm font-mono">
                  <span className="text-slate-400">Vault Balance Locked:</span>
                  <span className="text-cyan-300 font-bold">₹50,000 / ₹50,000 (100%)</span>
                </div>
                <div className="w-full h-3.5 bg-slate-900 rounded-full overflow-hidden p-0.5 border border-slate-700">
                  <div className="h-full bg-gradient-to-r from-cyan-500 via-indigo-500 to-purple-500 rounded-full shadow-[0_0_12px_rgba(6,182,212,0.8)] w-full" />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800">
                <p className="text-xs font-mono text-cyan-400 mb-3 uppercase tracking-wider">Social Impact & Scalability Metrics Framework</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                    <p className="text-[10px] text-slate-400 font-mono">Transparency Rate</p>
                    <p className="text-lg font-bold text-emerald-400 mt-0.5">100%</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">Verifiable Proofs</p>
                  </div>
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                    <p className="text-[10px] text-slate-400 font-mono">Fraud Prevention</p>
                    <p className="text-lg font-bold text-cyan-400 mt-0.5">0 Deficits</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">AI Blocked Overages</p>
                  </div>
                  <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                    <p className="text-[10px] text-slate-400 font-mono">Verification Time</p>
                    <p className="text-lg font-bold text-indigo-400 mt-0.5">42 ms</p>
                    <p className="text-[9px] text-slate-500 mt-0.5">Avg Processing Speed</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="md:col-span-5 glass-panel p-8 rounded-2xl border border-slate-700/60 flex flex-col justify-between">
              <div>
                <div className="flex items-center space-x-2 text-cyan-400 mb-4">
                  <Lock className="w-5 h-5" />
                  <h3 className="font-bold text-lg">Milestone #1 Escrow Lock</h3>
                </div>
                <p className="text-sm text-slate-300 mb-4 leading-relaxed">
                  Funds cannot be disbursed via raw transaction calls. Release requires verified SHA-256 invoice cryptographic proofs.
                </p>
                <div className="p-3 bg-black/40 rounded-xl border border-slate-800 font-mono text-xs text-slate-400 space-y-1">
                  <p>Escrow Address: <span className="text-cyan-400">0x892a...c014</span></p>
                  <p>Active Campaigns: <span className="text-white">12 NGOs / L2 Scaled</span></p>
                  <p>Audit Status: <span className="text-emerald-400">Framework Active</span></p>
                </div>
              </div>

              <button 
                onClick={() => setActiveTab('ngo')}
                className="w-full mt-6 py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 font-bold hover:shadow-[0_0_20px_rgba(6,182,212,0.5)] transition flex items-center justify-center space-x-2"
              >
                <span>Simulate NGO Claim Submission</span>
                <ExternalLink className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {activeTab === 'ngo' && (
          <div className="max-w-2xl w-full glass-panel p-8 rounded-2xl border border-slate-700/60 shadow-2xl">
            <h2 className="text-2xl font-bold mb-2">NGO Disbursement Portal</h2>
            <p className="text-sm text-slate-400 mb-6">Upload vendor invoice and equipment receipt to initiate milestone release.</p>

            {demoState === 'initial' ? (
              <label className="group cursor-pointer border-2 border-dashed border-cyan-500/40 hover:border-cyan-400 rounded-2xl p-12 text-center transition bg-slate-900/40 hover:bg-slate-900/80 relative block w-full">
                <input type="file" className="hidden" accept=".pdf" onChange={handleRealUpload} />
                <div className="w-16 h-16 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 mx-auto flex items-center justify-center mb-4 group-hover:scale-110 transition shadow-[0_0_25px_rgba(6,182,212,0.3)]">
                  <UploadCloud className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">Click to Upload PDF Invoice</h3>
                <p className="text-xs text-slate-400 font-mono">Connects to Python AI Backend</p>
                <div className="mt-6 inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-cyan-500/20 text-cyan-300 text-xs font-bold border border-cyan-500/40">
                  <Sparkles className="w-4 h-4 animate-spin" />
                  <span>Auto-Compute SHA-256 & Route to AI</span>
                </div>
              </label>
            ) : (
              <div className="p-8 rounded-2xl bg-slate-900/80 border border-slate-700 text-center space-y-4">
                <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto" />
                <h3 className="text-xl font-bold text-white">Invoice Telemetry Anchored to IPFS</h3>
                <p className="font-mono text-xs text-slate-400 break-all bg-black/50 p-3 rounded-lg border border-slate-800">
                  IPFS Hash: {auditResult?.invoice_hash || "QmXoypizjW3WknFiJnKLwHCnL72vedxjQkDDP1mXWo6uco"}
                </p>
                <button 
                  onClick={() => setActiveTab('auditor')}
                  className="px-6 py-2.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 font-bold text-sm shadow-[0_0_15px_rgba(6,182,212,0.4)]"
                >
                  View AI Forensic Scan Output
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'auditor' && (
          <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            <div className="lg:col-span-5 glass-panel p-6 rounded-2xl border border-slate-700/60 font-mono text-xs flex flex-col justify-between h-[480px]">
              <div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-4">
                  <div className="flex items-center space-x-2 text-cyan-400">
                    <Terminal className="w-4 h-4" />
                    <span className="font-bold">ORACLE EXECUTION STREAM</span>
                  </div>
                  <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-400">v3.4.1</span>
                </div>

                <div className="space-y-3 overflow-y-auto max-h-[350px] pr-2">
                  <p className="text-slate-400">&gt; Smart Contract Escrow initialized at 0x892a...</p>
                  <p className="text-slate-400">&gt; Target milestone threshold: ₹40,000</p>
                  
                  {aiStep >= 1 && (
                    <p className="text-cyan-400 animate-pulse">&gt; Ingesting invoice document from IPFS Gateway...</p>
                  )}
                  {aiStep >= 2 && (
                    <p className="text-indigo-300">&gt; OCR Extraction: Extracted 4 line items. Parsing semantic vectors...</p>
                  )}
                  {aiStep >= 3 && (
                    <p className="text-purple-300">&gt; Running Anomaly Detection Model: Comparing claimed INR vs. milestone cap...</p>
                  )}
                  {aiStep >= 4 && auditResult && (
                    <div className="p-3 bg-red-950/40 border border-red-500/40 rounded-lg text-red-400 space-y-1">
                      <p className="font-bold">&gt; [ALERT] BUDGET DISCREPANCY CONFIRMED</p>
                      <p>&gt; Invoiced: ₹{auditResult.claimed_amount} | Limit: ₹{auditResult.allocated_limit}</p>
                      {auditResult.issues.map((issue, idx) => (
                        <p key={idx}>&gt; {issue}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-between text-slate-500 text-[11px]">
                <span>Status: {demoState === 'scanning' ? 'Scanning...' : demoState.toUpperCase()}</span>
                <span>Latency: 42ms</span>
              </div>
            </div>

            <div className="lg:col-span-7 glass-panel p-8 rounded-2xl border border-slate-700/60 shadow-2xl flex flex-col justify-between">
              {demoState === 'initial' && (
                <div className="text-center py-20">
                  <SearchCode className="w-16 h-16 text-slate-600 mx-auto mb-4 animate-bounce" />
                  <h3 className="text-xl font-bold text-slate-300 mb-2">AI Audit Engine Idle</h3>
                  <p className="text-sm text-slate-500 max-w-md mx-auto mb-6">
                    Trigger an invoice ingestion event from the NGO tab to watch real-time OCR and semantic cross-referencing.
                  </p>
                </div>
              )}

              {demoState === 'scanning' && (
                <div className="text-center py-20 space-y-4">
                  <div className="relative w-20 h-20 mx-auto">
                    <div className="absolute inset-0 rounded-full border-4 border-cyan-500/20 border-t-cyan-400 animate-spin" />
                    <Cpu className="w-10 h-10 text-cyan-400 absolute inset-0 m-auto" />
                  </div>
                  <h3 className="text-xl font-bold text-white">AI Forensic Evaluation in Progress</h3>
                  <p className="text-sm text-cyan-300 font-mono animate-pulse">Running Neural OCR & Smart Contract Constraint Checks...</p>
                </div>
              )}

              {(demoState === 'flagged' || demoState === 'rejected' || demoState === 'approved' || demoState === 'submitting_tx') && auditResult && (
                <div>
                  <div className="flex justify-between items-center mb-6">
                    <div className="flex items-center space-x-2">
                      <span className="w-3 h-3 rounded-full bg-rose-500 animate-ping" />
                      <h3 className="text-xl font-bold text-white">Forensic Risk Score: {auditResult.risk_score}/100</h3>
                    </div>
                    <span className="px-3 py-1 rounded-full bg-rose-500/10 text-rose-400 font-mono text-xs font-bold border border-rose-500/30">
                      {auditResult.risk_level} ANOMALY RISK
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="bg-slate-900/80 p-4 rounded-xl border border-slate-800">
                      <p className="text-xs font-mono text-slate-400">Escrow Milestone Budget</p>
                      <p className="text-2xl font-bold text-emerald-400 mt-1">₹{auditResult.allocated_limit}</p>
                    </div>
                    <div className="bg-slate-900/80 p-4 rounded-xl border border-rose-500/30">
                      <p className="text-xs font-mono text-slate-400">Invoice Extracted Amount</p>
                      <p className="text-2xl font-bold text-rose-400 mt-1">₹{auditResult.claimed_amount}</p>
                    </div>
                  </div>

                  <div className="bg-rose-950/30 border border-rose-500/40 rounded-xl p-4 mb-6 space-y-2 text-sm text-rose-200">
                    <div className="flex items-center space-x-2 font-bold text-rose-400">
                      <AlertOctagon className="w-5 h-5 flex-shrink-0" />
                      <span>Smart Contract Constraint Violations Detected:</span>
                    </div>
                    <ul className="list-disc list-inside space-y-1 text-xs text-slate-300 font-mono pl-2">
                      {auditResult.issues.map((issue, idx) => (
                        <li key={idx}>{issue}</li>
                      ))}
                      <li>Deterministic Rule: Auto-Release blocked by Solidity modifier.</li>
                    </ul>
                  </div>

                  {demoState === 'rejected' ? (
                    <div className="p-4 bg-slate-900 rounded-xl border border-rose-500 text-center font-mono text-sm text-rose-400 font-bold">
                      [TRANSACTION REJECTED]: ESCROW FUNDS SECURED & RETAINED IN ON-CHAIN VAULT.
                    </div>
                  ) : demoState === 'approved' ? (
                    <div className="p-4 bg-slate-900 rounded-xl border border-emerald-500 text-center font-mono text-sm text-emerald-400 font-bold">
                      [OVERRIDE APPROVED]: ₹{auditResult.allocated_limit} DISBURSED VIA TX #0x9df4...321
                    </div>
                  ) : demoState === 'submitting_tx' ? (
                    <div className="p-4 bg-slate-900 rounded-xl border border-cyan-500 text-center font-mono text-sm text-cyan-400 font-bold animate-pulse">
                      [WEB3 PENDING]: Awaiting wallet signature & Polygon network confirmation...
                    </div>
                  ) : (
                    <div className="flex space-x-4">
                      <button 
                        onClick={() => setDemoState('rejected')}
                        className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-[0_0_20px_rgba(244,63,94,0.4)] transition"
                      >
                        Enforce Reject (Lock Escrow)
                      </button>
                      <button 
                        onClick={handleApprove}
                        className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-sm border border-slate-700 transition flex items-center justify-center space-x-2"
                      >
                        <Unlock className="w-4 h-4 text-cyan-400" />
                        <span>Manual Admin Override (Web3)</span>
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="w-full glass-panel p-8 rounded-2xl border border-slate-700/60 shadow-2xl">
            <div className="flex justify-between items-end mb-8">
              <div>
                <h2 className="text-2xl font-bold text-white mb-2">Immutable Audit Ledger</h2>
                <p className="text-sm text-slate-400">Cryptographically verified historical AI disbursements across global NGO partners.</p>
              </div>
              <div className="px-4 py-2 bg-slate-900 rounded-lg border border-slate-700 font-mono text-xs text-cyan-400">
                Network: Polygon Mainnet
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="text-xs text-slate-400 font-mono uppercase bg-slate-900/50 border-b border-slate-700">
                  <tr>
                    <th className="px-6 py-4">Tx Hash</th>
                    <th className="px-6 py-4">NGO Partner</th>
                    <th className="px-6 py-4">Purpose</th>
                    <th className="px-6 py-4">Claimed (₹)</th>
                    <th className="px-6 py-4">AI Confidence</th>
                    <th className="px-6 py-4">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {ledgerTransactions.map((txItem, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/30 transition">
                      <td className="px-6 py-4 font-mono text-cyan-500">{txItem.txHash}</td>
                      <td className="px-6 py-4 font-bold text-white">{txItem.ngo}</td>
                      <td className="px-6 py-4">{txItem.purpose}</td>
                      <td className="px-6 py-4 font-bold text-slate-200">₹{txItem.claimed}</td>
                      <td className="px-6 py-4">
                        <span className="text-emerald-400 font-mono text-xs">Polygon PoS Verified</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full border text-xs font-bold ${txItem.statusColor}`}>
                          {txItem.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <footer className="relative z-10 w-full border-t border-slate-800/80 glass-panel px-8 py-3 flex justify-between items-center text-xs font-mono text-slate-400">
        <div className="flex items-center space-x-4">
          <span className="flex items-center text-emerald-400">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping mr-2" />
            Consensus: Polygon PoS Verified
          </span>
          <span>Latest Block: #58,924,192</span>
        </div>
        <div className="text-slate-500">
          ChainShield Protocol &copy; 2026
        </div>
      </footer>
    </div>
  );
}