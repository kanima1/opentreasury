import { Buffer } from "buffer";
(window as any).Buffer = Buffer;

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import "./App.css";

type TxRow = {
  signature: string;
  slot: number;
  blockTime?: number | null;
  err: string | null;
};

type LabelType = "Donation" | "Grant" | "Ops" | "Milestone" | "Other";

type TxMeta = {
  label: LabelType;
  note?: string;
  proofUrl?: string;
};

type Tab = "Dashboard" | "Treasury Ledger";

const DEFAULT_TREASURY = "Vote111111111111111111111111111111111111111";
const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

function shortSig(sig: string) {
  return sig.slice(0, 6) + "…" + sig.slice(-6);
}

function formatTime(ts?: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

function isValidHttpUrl(value: string) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function storageKey(treasury: string) {
  return `opentreasury:labels:${treasury.trim()}`;
}

function labelColor(label: LabelType | "—") {
  switch (label) {
    case "Donation":
      return "#16a34a";
    case "Grant":
      return "#2563eb";
    case "Ops":
      return "#f59e0b";
    case "Milestone":
      return "#9333ea";
    case "Other":
      return "#64748b";
    default:
      return "#111";
  }
}

function parseOtherDetail(note?: string) {
  if (!note) return "";
  const m = note.match(/^other:\s*(.*)$/i);
  return m ? m[1] : "";
}

function toUtf8Bytes(s: string) {
  return new TextEncoder().encode(s);
}

async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest("SHA-256", toUtf8Bytes(input));
  const bytes = new Uint8Array(buf);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function stableStringify(obj: any) {
  // Deterministic JSON stringify (sort keys recursively)
  const seen = new WeakSet();
  const sorter = (x: any): any => {
    if (x && typeof x === "object") {
      if (seen.has(x)) return x;
      seen.add(x);

      if (Array.isArray(x)) return x.map(sorter);
      const keys = Object.keys(x).sort();
      const out: any = {};
      for (const k of keys) out[k] = sorter(x[k]);
      return out;
    }
    return x;
  };
  return JSON.stringify(sorter(obj), null, 2);
}

type WalletProvider = {
  publicKey?: PublicKey;
  connect: () => Promise<any>;
  disconnect?: () => Promise<void>;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  signAndSendTransaction?: (tx: Transaction) => Promise<{ signature: string }>;
};

export default function App() {
  const searchParams = new URLSearchParams(window.location.search);
  const isPublicView = searchParams.get("view") === "public";

  const [tab, setTab] = useState<Tab>("Dashboard");

  const [treasury, setTreasury] = useState<string>(DEFAULT_TREASURY);
  const [status, setStatus] = useState<string>("");
  const [balanceSol, setBalanceSol] = useState<number | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [error, setError] = useState<string>("");

  const [meta, setMeta] = useState<Record<string, TxMeta>>({});
  const [selectedSig, setSelectedSig] = useState<string | null>(null);

  const [editLabel, setEditLabel] = useState<LabelType>("Donation");
  const [editOtherDetail, setEditOtherDetail] = useState<string>("");
  const [editNote, setEditNote] = useState<string>("");
  const [editProof, setEditProof] = useState<string>("");
  const [saveMsg, setSaveMsg] = useState<string>("");

  const [searchLedger, setSearchLedger] = useState<string>("");

  // Proof state
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [proofHash, setProofHash] = useState<string>("");
  const [proofJson, setProofJson] = useState<string>("");
  const [proofTxSig, setProofTxSig] = useState<string>("");
  const [proofMsg, setProofMsg] = useState<string>("");

  // Verification UI state
  const [verifyTx, setVerifyTx] = useState<string>("");
  const [verifyJson, setVerifyJson] = useState<string>("");
  const [verifyMsg, setVerifyMsg] = useState<string>("");

  const editorRef = useRef<HTMLDivElement | null>(null);

  // Devnet
  const connection = useMemo(
    () => new Connection("https://api.devnet.solana.com", "confirmed"),
    []
  );

  // Load saved annotations
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(treasury));
      setMeta(raw ? JSON.parse(raw) : {});
    } catch {
      setMeta({});
    }
    setSelectedSig(null);
    setSaveMsg("");
    setSearchLedger("");

    // reset proof (treasury changed)
    setProofHash("");
    setProofJson("");
    setProofTxSig("");
    setProofMsg("");

    // reset verify
    setVerifyTx("");
    setVerifyJson("");
    setVerifyMsg("");
  }, [treasury]);

  // Fetch balance + txs
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError("");
      setStatus("Loading…");
      setBalanceSol(null);
      setTxs([]);

      try {
        const pubkey = new PublicKey(treasury.trim());

        const lamports = await connection.getBalance(pubkey, "confirmed");
        if (cancelled) return;
        setBalanceSol(lamports / LAMPORTS_PER_SOL);

        const sigs = await connection.getSignaturesForAddress(
          pubkey,
          { limit: 50 },
          "confirmed"
        );
        if (cancelled) return;

        setTxs(
          sigs.map((s) => ({
            signature: s.signature,
            slot: s.slot,
            blockTime: s.blockTime,
            err: s.err ? JSON.stringify(s.err) : null,
          }))
        );

        setStatus("Loaded ✅");
      } catch (e: any) {
        setStatus("");
        setError(e?.message ?? "Something went wrong");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [treasury, connection]);

  // Populate editor when tx is selected
  useEffect(() => {
    if (!selectedSig) return;

    const saved = meta[selectedSig];
    if (saved) {
      setEditLabel(saved.label);
      setEditProof(saved.proofUrl ?? "");

      if (saved.label === "Other") {
        setEditOtherDetail(parseOtherDetail(saved.note));
        const parts = (saved.note ?? "").split("|").map((p) => p.trim());
        if (parts.length >= 2) setEditNote(parts.slice(1).join(" | "));
        else setEditNote("");
      } else {
        setEditOtherDetail("");
        setEditNote(saved.note ?? "");
      }
    } else {
      setEditLabel("Donation");
      setEditOtherDetail("");
      setEditNote("");
      setEditProof("");
    }

    setSaveMsg("");
  }, [selectedSig, meta]);

  useEffect(() => {
    if (editLabel !== "Other") setEditOtherDetail("");
  }, [editLabel]);

  function scrollToEditor() {
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function selectTx(sig: string, opts?: { goEditor?: boolean }) {
    if (isPublicView) return;
    setSelectedSig(sig);
    if (opts?.goEditor) {
      setTimeout(() => {
        setTab("Dashboard");
        setTimeout(scrollToEditor, 50);
      }, 0);
    }
  }

  function saveMeta() {
    if (!selectedSig || isPublicView) return;

    const trimmedProof = editProof.trim();
    if (trimmedProof && !isValidHttpUrl(trimmedProof)) {
      setSaveMsg("❌ Supporting Link must be a valid http(s) URL.");
      return;
    }

    const desc = editNote.trim();
    const other = editOtherDetail.trim();

    let finalNote: string | undefined;

    if (editLabel === "Other") {
      const base = other ? `Other: ${other}` : "Other";
      finalNote = desc ? `${base} | ${desc}` : other ? base : undefined;
    } else {
      finalNote = desc || undefined;
    }

    const next: Record<string, TxMeta> = {
      ...meta,
      [selectedSig]: {
        label: editLabel,
        note: finalNote,
        proofUrl: trimmedProof || undefined,
      },
    };

    setMeta(next);
    localStorage.setItem(storageKey(treasury), JSON.stringify(next));
    setSaveMsg("Saved ✅");
  }

  function clearMeta() {
    if (!selectedSig || isPublicView) return;

    const next = { ...meta };
    delete next[selectedSig];
    setMeta(next);
    localStorage.setItem(storageKey(treasury), JSON.stringify(next));
    setSaveMsg("Removed ✅");
  }

  const ledgerEntries = Object.keys(meta).length;

  const ledgerRows = Object.entries(meta).filter(([sig, m]) => {
    const q = searchLedger.trim().toLowerCase();
    if (!q) return true;
    return (
      sig.toLowerCase().includes(q) ||
      m.label.toLowerCase().includes(q) ||
      (m.note ?? "").toLowerCase().includes(q) ||
      (m.proofUrl ?? "").toLowerCase().includes(q)
    );
  });

  function copyPublicLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "public");
    navigator.clipboard.writeText(url.toString());
    alert("Public view link copied ✅");
  }

  // ===== Protocol: OTMS + Proof =====
  function buildOTMS() {
    return {
      version: 1,
      standard: "OTMS",
      cluster: "devnet",
      treasury: treasury.trim(),
      exportedAt: new Date().toISOString(),
      entries: Object.entries(meta).map(([signature, m]) => ({
        signature,
        category: m.label,
        description: m.note ?? "",
        proofUrl: m.proofUrl ?? "",
      })),
    };
  }

  async function generateProof() {
    try {
      setProofMsg("");
      const otms = buildOTMS();
      const json = stableStringify(otms);
      const hash = await sha256Hex(json);

      setProofJson(json);
      setProofHash(hash);
      setProofTxSig("");
      setProofMsg("Proof generated ✅");

      // helpful default for verification box
      setVerifyJson(json);
    } catch (e: any) {
      setProofMsg(e?.message ?? "Could not generate proof.");
    }
  }

  function getWalletProvider(): WalletProvider | null {
    const w = window as any;
    const provider = w?.solana;
    if (!provider) return null;
    // MVP: any wallet that injects window.solana (Phantom does)
    return provider as WalletProvider;
  }

  async function connectWallet() {
    try {
      setProofMsg("");
      const provider = getWalletProvider();
      if (!provider) {
        setProofMsg(
          "No wallet provider found in browser. Install Phantom (or a wallet that injects window.solana)."
        );
        return;
      }

      const res = await provider.connect();
      const pubkey =
        res?.publicKey?.toString?.() ?? provider.publicKey?.toString?.();

      setWalletAddress(pubkey || "");
      setProofMsg(pubkey ? "Wallet connected ✅" : "Connected, but could not read address.");
    } catch (e: any) {
      setProofMsg(
        e?.message ?? "Could not connect wallet (check popup / permissions)."
      );
    }
  }

  async function anchorProofOnChain() {
    try {
      setProofMsg("");
      const provider = getWalletProvider();
      if (!provider) {
        setProofMsg("Wallet provider not found.");
        return;
      }
      if (!provider.publicKey) {
        setProofMsg("Connect your wallet first.");
        return;
      }
      if (!proofHash) {
        setProofMsg("Generate proof first (hash is empty).");
        return;
      }

      const memoText = [
        "OpenTreasury Proof (OTMS v1)",
        `Treasury: ${treasury.trim()}`,
        `Hash: ${proofHash}`,
        `Timestamp: ${new Date().toISOString()}`,
      ].join("\n");

      const ix = new TransactionInstruction({
        programId: MEMO_PROGRAM_ID,
        keys: [],
        // web3.js types vary; Buffer works at runtime. Cast keeps TS happy.
        data: Buffer.from(memoText, "utf8") as any,
      });

      const tx = new Transaction().add(ix);
      tx.feePayer = provider.publicKey;

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;

      let sig = "";
      if (provider.signAndSendTransaction) {
        const sent = await provider.signAndSendTransaction(tx);
        sig = sent?.signature ?? "";
      } else if (provider.signTransaction) {
        const signed = await provider.signTransaction(tx);
        const raw = signed.serialize();
        sig = await connection.sendRawTransaction(raw, { skipPreflight: false });
      } else {
        throw new Error("Wallet does not support sending transactions.");
      }

      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      setProofTxSig(sig);
      setVerifyTx(sig); // auto-fill for verification
      setProofMsg("Anchored on-chain ✅");
    } catch (e: any) {
      setProofMsg(e?.message ?? "Could not anchor proof on-chain.");
    }
  }

  async function verifyProof() {
    try {
      setVerifyMsg("");

      const sig = verifyTx.trim();
      if (!sig) {
        setVerifyMsg("❌ Paste a tx signature first.");
        return;
      }

      const jsonText = verifyJson.trim();
      if (!jsonText) {
        setVerifyMsg("❌ Paste OTMS JSON first.");
        return;
      }

      let parsedJson: any;
      try {
        parsedJson = JSON.parse(jsonText);
      } catch {
        setVerifyMsg("❌ OTMS JSON is not valid JSON.");
        return;
      }

      // Compute hash from normalized JSON
      const normalized = stableStringify(parsedJson);
      const computedHash = await sha256Hex(normalized);

      // ✅ Use parsed tx to reliably read Memo text (no manual base58 decoding)
      const parsedTx = await connection.getParsedTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (!parsedTx) {
        setVerifyMsg("❌ Could not fetch that transaction (wrong cluster or signature?).");
        return;
      }

      const ixs: any[] = (parsedTx.transaction?.message as any)?.instructions ?? [];
      const memoIx = ixs.find((ix) => {
        const pid =
          typeof ix.programId === "string"
            ? ix.programId
            : ix.programId?.toString?.() ?? "";
        return pid === MEMO_PROGRAM_ID.toBase58();
      });

      if (!memoIx) {
        setVerifyMsg("❌ No Memo instruction found in this transaction.");
        return;
      }

      // Memo program parsed output varies by RPC; cover common shapes
      const memoText =
        typeof memoIx.parsed === "string"
          ? memoIx.parsed
          : memoIx.parsed?.memo ?? memoIx.parsed ?? "";

      if (!memoText || typeof memoText !== "string") {
        setVerifyMsg("❌ Memo instruction found, but no readable memo text.");
        return;
      }

      const hashLine = memoText
        .split("\n")
        .find((l) => l.toLowerCase().startsWith("hash:"));
      const treasuryLine = memoText
        .split("\n")
        .find((l) => l.toLowerCase().startsWith("treasury:"));

      const memoHash = (hashLine ?? "").replace(/^hash:\s*/i, "").trim();
      const memoTreasury = (treasuryLine ?? "").replace(/^treasury:\s*/i, "").trim();

      if (!memoHash) {
        setVerifyMsg("❌ Memo found but could not read Hash line.");
        return;
      }

      if (memoHash !== computedHash) {
        setVerifyMsg(
          `❌ Not verified.\nComputed hash: ${computedHash}\nMemo hash: ${memoHash}\n\nMemo text:\n${memoText}`
        );
        return;
      }

      // Optional treasury check
      const jsonTreasury = String(parsedJson?.treasury ?? "").trim();
      if (jsonTreasury && memoTreasury && jsonTreasury !== memoTreasury) {
        setVerifyMsg(
          `⚠️ Hash verified ✅ but treasury mismatch:\nJSON treasury: ${jsonTreasury}\nMemo treasury: ${memoTreasury}\n\nMemo text:\n${memoText}`
        );
        return;
      }

      setVerifyMsg(`✅ Verified!\nHash matches Memo.\n\nMemo text:\n${memoText}`);
    } catch (e: any) {
      setVerifyMsg(e?.message ?? "❌ Verification failed unexpectedly.");
    }
  }

  function exportLedger() {
    const payload = buildOTMS();
    const json = stableStringify(payload);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `opentreasury-otms-${treasury.trim().slice(0, 6)}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  function importLedgerFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));

        // Backward compatible: accept {meta} or OTMS {entries}
        if (parsed?.meta && typeof parsed.meta === "object") {
          setMeta(parsed.meta);
          localStorage.setItem(storageKey(treasury), JSON.stringify(parsed.meta));
          alert("Ledger imported ✅");
          return;
        }

        if (parsed?.entries && Array.isArray(parsed.entries)) {
          const next: Record<string, TxMeta> = {};
          for (const e of parsed.entries) {
            if (!e?.signature) continue;
            next[e.signature] = {
              label: (e.category as LabelType) || "Other",
              note: e.description || "",
              proofUrl: e.proofUrl || "",
            };
          }
          setMeta(next);
          localStorage.setItem(storageKey(treasury), JSON.stringify(next));
          alert("OTMS imported ✅");
          return;
        }

        alert("Invalid ledger file.");
      } catch {
        alert("Could not read JSON.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "40px auto",
        padding: "0 16px",
        fontFamily: "system-ui",
      }}
    >
      <h1 style={{ marginBottom: 4 }}>
        OpenTreasury (MVP){isPublicView ? " — Public View" : ""}
      </h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Treasury transparency dashboard (devnet).{" "}
        {isPublicView
          ? "Read-only view for sharing."
          : "Annotations are stored locally in your browser."}
      </p>

      {/* Top Controls */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "end",
          marginTop: 16,
        }}
      >
        <div style={{ flex: 1, minWidth: 320 }}>
          <label
            style={{
              display: "block",
              fontSize: 12,
              opacity: 0.75,
              marginBottom: 6,
            }}
          >
            Treasury Wallet Address
          </label>
          <input
            value={treasury}
            onChange={(e) => setTreasury(e.target.value)}
            placeholder="Enter Solana address…"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.18)",
              outline: "none",
            }}
          />
        </div>

        <div style={{ minWidth: 180 }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Balance</div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {balanceSol === null ? "—" : `${balanceSol.toFixed(4)} SOL`}
          </div>
        </div>

        <div style={{ minWidth: 180 }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Status</div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{status || "—"}</div>
        </div>

        <div style={{ minWidth: 180 }}>
          <div style={{ fontSize: 12, opacity: 0.75 }}>Ledger Entries</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{ledgerEntries}</div>
        </div>

        {!isPublicView && (
          <div style={{ minWidth: 320, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              onClick={copyPublicLink}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.15)",
                background: "#111",
                color: "white",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Copy Public View Link
            </button>

            <button
              onClick={exportLedger}
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.15)",
                background: "rgba(0,0,0,0.06)",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Download OTMS JSON
            </button>

            <label
              style={{
                flex: 1,
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.15)",
                background: "rgba(0,0,0,0.06)",
                fontWeight: 900,
                cursor: "pointer",
                textAlign: "center",
              }}
            >
              Import JSON
              <input
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) importLedgerFile(file);
                  e.currentTarget.value = "";
                }}
              />
            </label>
          </div>
        )}
      </div>

      {/* Protocol Proof (private view only) */}
      {!isPublicView && (
        <div
          style={{
            marginTop: 14,
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 12,
            padding: 12,
            background: "rgba(0,0,0,0.02)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 900 }}>Protocol Proof</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>
                OTMS JSON → SHA-256 hash → anchor hash on-chain (Memo).
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={connectWallet}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.15)",
                  background: "#111",
                  color: "white",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                {walletAddress
                  ? `Wallet: ${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
                  : "Connect Wallet"}
              </button>

              <button
                onClick={generateProof}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.15)",
                  background: "rgba(0,0,0,0.06)",
                  fontWeight: 900,
                  cursor: "pointer",
                }}
              >
                Generate Proof Hash
              </button>

              <button
                onClick={anchorProofOnChain}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(0,0,0,0.15)",
                  background: proofHash ? "#111" : "rgba(0,0,0,0.12)",
                  color: proofHash ? "white" : "rgba(0,0,0,0.45)",
                  fontWeight: 900,
                  cursor: proofHash ? "pointer" : "not-allowed",
                }}
                disabled={!proofHash}
              >
                Anchor On-Chain (Devnet)
              </button>
            </div>
          </div>

          <div style={{ marginTop: 10, fontSize: 13 }}>
            <div style={{ opacity: 0.75 }}>Current Proof Hash</div>
            <div
              style={{
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                wordBreak: "break-all",
              }}
            >
              {proofHash || "—"}
            </div>

            {proofTxSig && (
              <div style={{ marginTop: 6 }}>
                Anchored Tx:{" "}
                <a
                  href={`https://explorer.solana.com/tx/${proofTxSig}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontWeight: 900, textDecoration: "none" }}
                >
                  {shortSig(proofTxSig)}
                </a>
              </div>
            )}

            {proofMsg && <div style={{ marginTop: 6 }}>{proofMsg}</div>}

            {proofJson && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", fontWeight: 900 }}>
                  View OTMS JSON (Proof Payload)
                </summary>
                <pre
                  style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.12)",
                    background: "rgba(0,0,0,0.03)",
                    overflowX: "auto",
                    fontSize: 12,
                  }}
                >
                  {proofJson}
                </pre>
              </details>
            )}
          </div>

          {/* Proof Verification */}
          <div
            style={{
              marginTop: 14,
              borderTop: "1px solid rgba(0,0,0,0.08)",
              paddingTop: 12,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 900 }}>Proof Verification</div>
            <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 10 }}>
              Paste the on-chain tx signature + the OTMS JSON, then verify the hash matches the Memo.
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
              <input
                value={verifyTx}
                onChange={(e) => setVerifyTx(e.target.value)}
                placeholder="Paste devnet tx signature here…"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.18)",
                  outline: "none",
                }}
              />

              <textarea
                value={verifyJson}
                onChange={(e) => setVerifyJson(e.target.value)}
                placeholder="Paste OTMS JSON here…"
                rows={8}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,0,0,0.18)",
                  outline: "none",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: 12,
                }}
              />

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={verifyProof}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.15)",
                    background: "#111",
                    color: "white",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  Verify Proof
                </button>

                {verifyTx.trim() && (
                  <a
                    href={`https://explorer.solana.com/tx/${verifyTx.trim()}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      alignSelf: "center",
                      fontWeight: 900,
                      textDecoration: "none",
                    }}
                  >
                    Open Tx in Explorer →
                  </a>
                )}
              </div>

              {verifyMsg && (
                <pre
                  style={{
                    marginTop: 6,
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid rgba(0,0,0,0.12)",
                    background: "rgba(0,0,0,0.03)",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {verifyMsg}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
        <button
          onClick={() => setTab("Dashboard")}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.15)",
            background: tab === "Dashboard" ? "#111" : "rgba(0,0,0,0.06)",
            color: tab === "Dashboard" ? "white" : "black",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Dashboard
        </button>
        <button
          onClick={() => setTab("Treasury Ledger")}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.15)",
            background: tab === "Treasury Ledger" ? "#111" : "rgba(0,0,0,0.06)",
            color: tab === "Treasury Ledger" ? "white" : "black",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Treasury Ledger ({ledgerEntries})
        </button>
      </div>

      {error && (
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 10,
            background: "rgba(255,0,0,0.08)",
            border: "1px solid rgba(255,0,0,0.2)",
          }}
        >
          <b>Error:</b> {error}
          <div style={{ marginTop: 6, fontSize: 12, opacity: 0.8 }}>
            Tip: We’re on <b>devnet</b> right now.
          </div>
        </div>
      )}

      {/* Dashboard Tab */}
      {tab === "Dashboard" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.5fr 1fr",
            gap: 14,
            marginTop: 20,
          }}
        >
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 16 }}>
              Recent Transactions {isPublicView ? "" : "(select to annotate)"}
            </h2>

            <div
              style={{
                overflowX: "auto",
                border: "1px solid rgba(0,0,0,0.12)",
                borderRadius: 12,
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13,
                }}
              >
                <thead style={{ background: "rgba(0,0,0,0.03)" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: 10 }}>Signature</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Time</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Category</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 12, opacity: 0.7 }}>
                        No transactions found (or still loading).
                      </td>
                    </tr>
                  ) : (
                    txs.map((t) => {
                      const isSelected = selectedSig === t.signature;
                      const label = meta[t.signature]?.label ?? "—";

                      return (
                        <tr
                          key={t.signature}
                          onClick={() => {
                            if (isPublicView) return;
                            setSelectedSig(t.signature);
                            setTimeout(scrollToEditor, 50);
                          }}
                          style={{
                            cursor: isPublicView ? "default" : "pointer",
                            borderTop: "1px solid rgba(0,0,0,0.08)",
                            background: isSelected
                              ? "rgba(0,0,0,0.04)"
                              : "transparent",
                          }}
                        >
                          <td style={{ padding: 10 }}>
                            <a
                              href={`https://explorer.solana.com/tx/${t.signature}?cluster=devnet`}
                              target="_blank"
                              rel="noreferrer"
                              style={{ textDecoration: "none" }}
                              title={t.signature}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {shortSig(t.signature)}
                            </a>
                          </td>
                          <td style={{ padding: 10 }}>{formatTime(t.blockTime)}</td>
                          <td style={{ padding: 10, fontWeight: 900, color: labelColor(label) }}>
                            {label}
                          </td>
                          <td style={{ padding: 10 }}>
                            {t.err ? (
                              <span style={{ color: "#dc2626", fontWeight: 800 }}>
                                Failed
                              </span>
                            ) : (
                              <span style={{ color: "#16a34a", fontWeight: 800 }}>
                                Confirmed
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
              Tip: The ledger tab is your searchable index of annotated transactions.
            </div>
          </div>

          {/* Editor */}
          {!isPublicView && (
            <div ref={editorRef}>
              <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 16 }}>
                Transaction Annotation
              </h2>

              <div
                style={{
                  border: "1px solid rgba(0,0,0,0.12)",
                  borderRadius: 12,
                  padding: 12,
                }}
              >
                {!selectedSig ? (
                  <div style={{ opacity: 0.75, fontSize: 13 }}>
                    Select a transaction to add context and supporting evidence.
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, opacity: 0.75 }}>Selected Transaction</div>
                    <div style={{ fontWeight: 900, marginBottom: 14 }}>
                      {shortSig(selectedSig)}
                    </div>

                    <label style={{ display: "block", fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
                      Category
                    </label>
                    <select
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value as LabelType)}
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(0,0,0,0.25)",
                        outline: "none",
                        background: "rgba(0,0,0,0.04)",
                        marginBottom: 12,
                        fontWeight: 800,
                      }}
                    >
                      {["Donation", "Grant", "Ops", "Milestone", "Other"].map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>

                    {editLabel === "Other" && (
                      <>
                        <label style={{ display: "block", fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
                          Custom Category Name
                        </label>
                        <input
                          value={editOtherDetail}
                          onChange={(e) => setEditOtherDetail(e.target.value)}
                          placeholder="e.g., Sponsorship, Refund, Equipment"
                          style={{
                            width: "100%",
                            padding: "10px 12px",
                            borderRadius: 10,
                            border: "1px solid rgba(0,0,0,0.18)",
                            outline: "none",
                            marginBottom: 12,
                          }}
                        />
                      </>
                    )}

                    <label style={{ display: "block", fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
                      Description
                    </label>
                    <input
                      value={editNote}
                      onChange={(e) => setEditNote(e.target.value)}
                      placeholder="Brief explanation of transaction purpose"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(0,0,0,0.18)",
                        outline: "none",
                        marginBottom: 12,
                      }}
                    />

                    <label style={{ display: "block", fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
                      Supporting Link
                    </label>
                    <input
                      value={editProof}
                      onChange={(e) => setEditProof(e.target.value)}
                      placeholder="https://documentation-or-proof-link"
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: "1px solid rgba(0,0,0,0.18)",
                        outline: "none",
                        marginBottom: 14,
                      }}
                    />

                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        onClick={saveMeta}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,0.15)",
                          background: "#111",
                          color: "white",
                          fontWeight: 900,
                          cursor: "pointer",
                          flex: 1,
                        }}
                      >
                        Save Annotation
                      </button>
                      <button
                        onClick={clearMeta}
                        style={{
                          padding: "10px 12px",
                          borderRadius: 10,
                          border: "1px solid rgba(0,0,0,0.15)",
                          background: "rgba(0,0,0,0.04)",
                          fontWeight: 900,
                          cursor: "pointer",
                        }}
                      >
                        Remove Annotation
                      </button>
                    </div>

                    {saveMsg && <div style={{ marginTop: 10, fontSize: 13 }}>{saveMsg}</div>}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ledger Tab */}
      {tab === "Treasury Ledger" && (
        <div
          style={{
            marginTop: 18,
            border: "1px solid rgba(0,0,0,0.12)",
            borderRadius: 12,
            padding: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 900 }}>Treasury Ledger</div>
            <input
              value={searchLedger}
              onChange={(e) => setSearchLedger(e.target.value)}
              placeholder="Search by signature, category, description…"
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.18)",
                outline: "none",
                minWidth: 280,
              }}
            />
          </div>

          <div style={{ marginTop: 12 }}>
            {ledgerRows.length === 0 ? (
              <div style={{ opacity: 0.75 }}>No ledger entries found.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {ledgerRows.slice(0, 250).map(([sig, m]) => (
                  <div
                    key={sig}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 10,
                      alignItems: "center",
                      paddingTop: 10,
                      borderTop: "1px solid rgba(0,0,0,0.06)",
                    }}
                  >
                    <a
                      href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: "none", fontWeight: 900 }}
                      title={sig}
                    >
                      {shortSig(sig)}
                    </a>

                    <div style={{ fontWeight: 900, color: labelColor(m.label) }}>{m.label}</div>

                    <div style={{ flex: 1, fontSize: 13, opacity: 0.9 }}>{m.note ?? ""}</div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {m.proofUrl && (
                        <a
                          href={m.proofUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ textDecoration: "none" }}
                        >
                          link
                        </a>
                      )}

                      {!isPublicView && (
                        <button
                          onClick={() => selectTx(sig, { goEditor: true })}
                          style={{
                            padding: "8px 10px",
                            borderRadius: 10,
                            border: "1px solid rgba(0,0,0,0.15)",
                            background: "#111",
                            color: "white",
                            fontWeight: 900,
                            cursor: "pointer",
                          }}
                        >
                          edit
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            {isPublicView ? "Public view is read-only." : "Tip: Click “edit” to jump back into the editor."}
          </div>
        </div>
      )}
    </div>
  );
}