import React, { useEffect, useMemo, useRef, useState } from "react";
import { Buffer } from "buffer";
(window as any).Buffer = Buffer;

import bs58 from "bs58";
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

type ViewKey = "dashboard" | "ledger" | "proof" | "verify" | "settings";
type ClusterKey = "devnet" | "testnet" | "mainnet-beta";

type Settings = {
  theme: "dark" | "light";
  language: Language;
  currency: Currency;
  network: ClusterKey;
  hideBalance: boolean;
};

type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: PublicKey;
  connect: () => Promise<any>;
  disconnect?: () => Promise<void>;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  signAndSendTransaction?: (tx: Transaction) => Promise<{ signature: string }>;
};

const MEMO_PROGRAM_ID = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
);

// Use your real treasury as default if you want:
// const DEFAULT_TREASURY = "3wQkzvarKeeeVSteQbgzL7BenYhfvyJ3u3WpzPDEhuWk";
const DEFAULT_TREASURY = "Vote111111111111111111111111111111111111111";

const LANGUAGE_OPTIONS = [
  "English",
  "Spanish",
  "French",
  "Arabic",
  "Portuguese",
  "Russian",
  "German",
  "Japanese",
  "Korean",
  "Italian",
  "Turkish",
  "Hindi",
  "Bengali",
  "Urdu",
  "Punjabi",
  "Vietnamese",
  "Thai",
  "Indonesian",
  "Swahili",
  "Mandarin Chinese",
] as const;

type Language = (typeof LANGUAGE_OPTIONS)[number];

const CURRENCY_OPTIONS = [
  "USD", // US Dollar
  "EUR", // Euro
  "GBP", // British Pound
  "JPY", // Japanese Yen
  "CNY", // Chinese Yuan
  "CHF", // Swiss Franc
  "CAD", // Canadian Dollar
  "AUD", // Australian Dollar
  "NZD", // New Zealand Dollar
  "SGD", // Singapore Dollar
  "HKD", // Hong Kong Dollar
  "INR", // Indian Rupee
  "BRL", // Brazilian Real
  "ZAR", // South African Rand
  "NGN", // Nigerian Naira
  "KES", // Kenyan Shilling
  "GHS", // Ghanaian Cedi
  "AED", // UAE Dirham
  "SAR", // Saudi Riyal
  "TRY", // Turkish Lira
] as const;

type Currency = (typeof CURRENCY_OPTIONS)[number];

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

function settingsKey() {
  return `opentreasury:settings:v2`;
}

function labelColor(label: LabelType | "—") {
  switch (label) {
    case "Donation":
      return "#34d399";
    case "Grant":
      return "#60a5fa";
    case "Ops":
      return "#fbbf24";
    case "Milestone":
      return "#c084fc";
    case "Other":
      return "#94a3b8";
    default:
      return "#e5e7eb";
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

function clusterRpc(cluster: ClusterKey) {
  if (cluster === "mainnet-beta") return "https://solana-mainnet.g.alchemy.com/v2/demo";
  if (cluster === "testnet") return "https://api.testnet.solana.com";
  return "https://api.devnet.solana.com";
}

function explorerTxUrl(sig: string, cluster: ClusterKey) {
  return `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
}

function explorerAddrUrl(addr: string, cluster: ClusterKey) {
  return `https://explorer.solana.com/address/${addr}?cluster=${cluster}`;
}

function clamp(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function findAccountIndexInTx(tx: any, pubkeyBase58: string): number {
  const msg = tx?.transaction?.message;
  if (!msg) return -1;

  const keys =
    msg.staticAccountKeys ??
    msg.accountKeys ??
    [];

  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const s =
      typeof k === "string"
        ? k
        : k?.toBase58?.()
        ? k.toBase58()
        : k?.pubkey?.toString?.()
        ? k.pubkey.toString()
        : k?.pubkey
        ? String(k.pubkey)
        : k?.toString?.()
        ? k.toString()
        : "";

    if (s === pubkeyBase58) return i;
  }
  return -1;
}

function formatSolDelta(v: number) {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(4)} SOL`;
}

/** ---------- Minimal Icon Set (inline SVG) ---------- */
function Icon({
  children,
  size = 22, // default icon size inside tiles
}: {
  children: React.ReactNode;
  size?: number;
}) {
  return (
    <span
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 0,
      }}
    >
      {/* Force SVG to fully fill icon box */}
      <span
        style={{
          width: "100%",
          height: "100%",
          display: "block",
        }}
      >
        {children}
      </span>
    </span>
  );
}

const Icons = {
  Dashboard: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24" 
      fill="none"
       style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path
          d="M4 13h7V4H4v9Zm9 7h7V11h-7v9ZM4 20h7v-5H4v5Zm9-9h7V4h-7v7Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Ledger: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24" 
      fill="none"
       style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path
          d="M7 7h10M7 11h10M7 15h7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M6 3h12a2 2 0 0 1 2 2v14l-3-2-3 2-3-2-3 2-3-2V5a2 2 0 0 1 2-2Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Proof: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24" 
      fill="none"
       style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path
          d="M12 3l7 4v6c0 5-3 8-7 8s-7-3-7-8V7l7-4Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M9 12l2 2 4-5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Verify: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24"
       fill="none"
        style={{ width: "100%", height: "100%", display: "block" }}
       >
        <path
          d="M10 13a4 4 0 1 1 2 2"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M12 14v6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M9 20h6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Settings: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24"
       fill="none"
        style={{ width: "100%", height: "100%", display: "block" }}
       >
        <path
          d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M19.4 15a7.9 7.9 0 0 0 .1-2l2-1.2-2-3.4-2.3.6a7.7 7.7 0 0 0-1.7-1l-.3-2.3H9.8L9.5 7a7.7 7.7 0 0 0-1.7 1l-2.3-.6-2 3.4 2 1.2a7.9 7.9 0 0 0 .1 2l-2 1.2 2 3.4 2.3-.6c.5.4 1.1.7 1.7 1l.3 2.3h4.4l.3-2.3c.6-.3 1.2-.6 1.7-1l2.3.6 2-3.4-2-1.2Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Search: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24"
       fill="none"
        style={{ width: "100%", height: "100%", display: "block" }}
       >
        <path
          d="M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M16.5 16.5 21 21"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Share: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24"
       fill="none"
       style={{ width: "100%", height: "100%", display: "block" }}
       >
        <path
          d="M15 8a3 3 0 1 0-2.8-4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M6 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M18 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M8.5 15.5 15.5 13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M8.5 18 15.5 20.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Download: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24"
       fill="none"
        style={{ width: "100%", height: "100%", display: "block" }}
       >
        <path
          d="M12 3v10"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M8 11l4 4 4-4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M4 20h16"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Upload: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24"
       fill="none"
        style={{ width: "100%", height: "100%", display: "block" }}
       >
        <path
          d="M12 21V11"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M8 14l4-4 4 4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M4 4h16"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Link: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24" 
      fill="none"
       style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path
          d="M10 13a5 5 0 0 1 0-7l1-1a5 5 0 0 1 7 7l-1 1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M14 11a5 5 0 0 1 0 7l-1 1a5 5 0 0 1-7-7l1-1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Moon: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24" 
      fill="none"
       style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path
          d="M21 13.5A8.5 8.5 0 0 1 10.5 3a7 7 0 1 0 10.5 10.5Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Sun: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24" 
      fill="none"
       style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path
          d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M5 19l1.5-1.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Wallet: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24" 
      fill="none"
       style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path
          d="M4 7h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M4 7V6a2 2 0 0 1 2-2h13"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M17 12h4v4h-4a2 2 0 0 1 0-4Z"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Hash: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24" 
      fill="none"
       style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path
          d="M9 3 7 21M17 3l-2 18M4 8h18M3 16h18"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
  Eye: (p: { size?: number }) => (
  <Icon size={p.size}>
    <svg
      viewBox="0 0 24 24"
      fill="none"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <path
        d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="3"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  </Icon>
),

EyeOff: (p: { size?: number }) => (
  <Icon size={p.size}>
    <svg
      viewBox="0 0 24 24"
      fill="none"
      style={{ width: "100%", height: "100%", display: "block" }}
    >
      <path
        d="M3 3l18 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M10.6 10.7A3 3 0 0 0 13.3 13.4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M9.9 5.1A12.5 12.5 0 0 1 12 5c6.5 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.2 6.3A17.3 17.3 0 0 0 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </Icon>
),
  Anchor: (p: { size?: number }) => (
    <Icon size={p.size}>
      <svg viewBox="0 0 24 24" 
      fill="none"
       style={{ width: "100%", height: "100%", display: "block" }}
      >
        <path
          d="M12 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M12 9v12"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M5 13c0 4 3 8 7 8s7-4 7-8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M4 13h6M14 13h6"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </Icon>
  ),
};

/** Icon tile button (uniform sizing) */
function ToolIconButton({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      title={label}
      disabled={disabled}
      style={{
        width: 44,
        height: 44,
        padding: 0,
        borderRadius: 14,
        border: `1px solid var(--ot-border)`,
        background: active ? "var(--ot-btn-active)" : "var(--ot-btn-bg)",
        color: "inherit",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "transform .12s ease, background .12s ease, border-color .12s ease",
        // subtle “Solflare-like” presence:
        boxShadow: active ? "0 6px 18px rgba(0,0,0,0.18)" : "none",
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = "scale(0.98)";
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      {/* THIS is what makes it optically bigger */}
      <span style={{ transform: "translateY(0.25px)" }}>{children}</span>
    </button>
  );
}export default function App() {
  const searchParams = new URLSearchParams(window.location.search);
  const isPublicView = searchParams.get("view") === "public";

  const [view, setView] = useState<ViewKey>("dashboard");

  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const raw = localStorage.getItem(settingsKey());
      if (raw) return JSON.parse(raw);
    } catch {}
    return {
      theme: "dark",
      language: "English",
      currency: "USD",
      network: "devnet",
      hideBalance: false,
    };
  });

  useEffect(() => {
    localStorage.setItem(settingsKey(), JSON.stringify(settings));
    document.documentElement.setAttribute("data-theme", settings.theme);
  }, [settings]);

  const [treasury, setTreasury] = useState<string>(DEFAULT_TREASURY);
  const [status, setStatus] = useState<string>("");
  const [balanceSol, setBalanceSol] = useState<number | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [error, setError] = useState<string>("");
  const [txDeltaSol, setTxDeltaSol] = useState<Record<string, number>>({});
  const [txDeltaLoading, setTxDeltaLoading] = useState<Record<string, boolean>>({});

  const [meta, setMeta] = useState<Record<string, TxMeta>>({});
  const [selectedSig, setSelectedSig] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState<LabelType>("Donation");
  const [editOtherDetail, setEditOtherDetail] = useState<string>("");
  const [editNote, setEditNote] = useState<string>("");
  const [editProof, setEditProof] = useState<string>("");
  const [saveMsg, setSaveMsg] = useState<string>("");
 
  // Global search
  const [globalSearch, setGlobalSearch] = useState<string>("");

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

  const connection = useMemo(
    () => new Connection(clusterRpc(settings.network), "confirmed"),
    [settings.network]
  );

  function getWalletProvider(): PhantomProvider | null {
    const w = window as any;
    const provider = w?.solana;
    if (!provider) return null;
    return provider as PhantomProvider;
  }

  // Load saved annotations per treasury + network (separate per cluster)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(
        storageKey(`${settings.network}:${treasury}`)
      );
      setMeta(raw ? JSON.parse(raw) : {});
    } catch {
      setMeta({});
    }
    setSelectedSig(null);
    setSaveMsg("");

    setProofHash("");
    setProofJson("");
    setProofTxSig("");
    setProofMsg("");

    setVerifyTx("");
    setVerifyJson("");
    setVerifyMsg("");
    setTxDeltaSol({});
    setTxDeltaLoading({}); 
  }, [treasury, settings.network]);

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
        setBalanceSol(null);
        setError(
          "could not connect to the selected Solana network RPC. Check your internet or switch network."
        );
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [treasury, connection]);
useEffect(() => {
  let cancelled = false;

  async function loadDeltas() {
    const addr = treasury.trim();
    if (!addr || txs.length === 0) return;

    const sigsToFetch = txs
      .map((t) => t.signature)
      .filter((sig) => txDeltaSol[sig] === undefined);

    if (sigsToFetch.length === 0) return;

    setTxDeltaLoading((m) => {
      const next = { ...m };
      for (const sig of sigsToFetch) next[sig] = true;
      return next;
    });

    for (const sig of sigsToFetch) {
      if (cancelled) return;

      try {
        const tx =
          (await connection.getTransaction(sig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          })) ??
          (await connection.getTransaction(sig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 1,
          }));

        if (!tx) continue;

        const idx = findAccountIndexInTx(tx, addr);
        if (idx < 0) continue;

        const pre = tx?.meta?.preBalances?.[idx];
        const post = tx?.meta?.postBalances?.[idx];

        if (typeof pre !== "number" || typeof post !== "number") continue;

        const delta = (post - pre) / LAMPORTS_PER_SOL;

        setTxDeltaSol((m) => ({ ...m, [sig]: delta }));
      } catch {
        // ignore
      } finally {
        setTxDeltaLoading((m) => ({ ...m, [sig]: false }));
      }
    }
  }

  loadDeltas();

  return () => {
    cancelled = true;
  };
}, [treasury, txs, connection]);
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
    localStorage.setItem(
      storageKey(`${settings.network}:${treasury}`),
      JSON.stringify(next)
    );
    setSaveMsg("Saved ✅");
  }

  function clearMeta() {
    if (!selectedSig || isPublicView) return;

    const next = { ...meta };
    delete next[selectedSig];
    setMeta(next);
    localStorage.setItem(
      storageKey(`${settings.network}:${treasury}`),
      JSON.stringify(next)
    );
    setSaveMsg("Removed ✅");
  }

  function buildOTMS() {
    return {
      version: 1,
      standard: "OTMS",
      cluster: settings.network,
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

      setVerifyJson(json);
      setView("proof");
    } catch (e: any) {
      setProofMsg(e?.message ?? "Could not generate proof.");
    }
  }

  async function connectWallet() {
    try {
      setProofMsg("");
      const provider = getWalletProvider();
      if (!provider) {
        setProofMsg(
          "No wallet provider found. Install Phantom (or a wallet that injects window.solana)."
        );
        return;
      }
      const res = await provider.connect();
      const pubkey =
        res?.publicKey?.toString?.() ?? provider.publicKey?.toString?.();
      setWalletAddress(pubkey || "");
      setProofMsg(
        pubkey ? "Wallet connected ✅" : "Connected, but could not read address."
      );
    } catch (e: any) {
      setProofMsg(
        e?.message ?? "Could not connect wallet (check popup/permissions)."
      );
    }
  }

  function useWalletAsTreasury() {
    if (!walletAddress) {
      setProofMsg("Connect wallet first, then you can use it as treasury.");
      return;
    }
    setTreasury(walletAddress);
    setProofMsg("Treasury set to connected wallet ✅");
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
      setVerifyTx(sig);
      setProofMsg("Anchored on-chain ✅");
      setView("verify");
    } catch (e: any) {
      setProofMsg(e?.message ?? "Could not anchor proof on-chain.");
    }
  }

  function exportLedger() {
    const payload = buildOTMS();
    const json = stableStringify(payload);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `opentreasury-otms-${settings.network}-${treasury
      .trim()
      .slice(0, 6)}.json`;
    a.click();

    URL.revokeObjectURL(url);
  }

  function importLedgerFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));

        if (parsed?.meta && typeof parsed.meta === "object") {
          setMeta(parsed.meta);
          localStorage.setItem(
            storageKey(`${settings.network}:${treasury}`),
            JSON.stringify(parsed.meta)
          );
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
          localStorage.setItem(
            storageKey(`${settings.network}:${treasury}`),
            JSON.stringify(next)
          );
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

  function decodeMemoTextFromTx(tx: any): string[] {
    const lines: string[] = [];
    if (!tx?.transaction?.message) return lines;

    const message = tx.transaction.message;

    const accountKeys = message.staticAccountKeys ?? message.accountKeys ?? [];
    const compiledInstructions =
      message.compiledInstructions ?? message.instructions ?? [];

    for (const ix of compiledInstructions) {
      let programId: string | undefined;

      if (typeof ix.programIdIndex === "number") {
        const key = accountKeys[ix.programIdIndex];
        programId = typeof key === "string" ? key : key?.toString?.();
      } else if (ix.programId) {
        programId = ix.programId.toString?.();
      }

      if (programId !== MEMO_PROGRAM_ID.toBase58()) continue;

      const dataBase58 = ix.data;
      if (!dataBase58) continue;

      try {
        const decoded = bs58.decode(dataBase58);
        const text = new TextDecoder().decode(decoded);
        lines.push(text);
      } catch {
        // ignore
      }
    }

    return lines;
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

      let parsed: any;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        setVerifyMsg("❌ OTMS JSON is not valid JSON.");
        return;
      }

      const normalized = stableStringify(parsed);
      const computedHash = await sha256Hex(normalized);

      let tx: any = null;
      tx =
        (await connection.getTransaction(sig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        })) ??
        (await connection.getTransaction(sig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 1,
        }));

      if (!tx) {
        setVerifyMsg(
          `❌ Could not fetch transaction on ${settings.network}.\nCheck signature + selected network.`
        );
        return;
      }

      const memos = decodeMemoTextFromTx(tx);
      if (memos.length === 0) {
        setVerifyMsg("❌ No Memo instruction found in this transaction.");
        return;
      }

      const memo = memos[0];
      const hashLine = memo
        .split("\n")
        .find((l: string) => l.toLowerCase().startsWith("hash:"));
      const treasuryLine = memo
        .split("\n")
        .find((l: string) => l.toLowerCase().startsWith("treasury:"));

      const memoHash = (hashLine ?? "").replace(/^hash:\s*/i, "").trim();
      const memoTreasury = (treasuryLine ?? "")
        .replace(/^treasury:\s*/i, "")
        .trim();

      if (!memoHash) {
        setVerifyMsg("❌ Memo found but could not read Hash line.");
        return;
      }

      if (memoHash !== computedHash) {
        setVerifyMsg(
          `❌ Not verified.\nComputed hash: ${computedHash}\nMemo hash: ${memoHash}`
        );
        return;
      }

      const jsonTreasury = String(parsed?.treasury ?? "").trim();
      if (jsonTreasury && memoTreasury && jsonTreasury !== memoTreasury) {
        setVerifyMsg(
          `⚠️ Hash verified ✅ but treasury mismatch:\nJSON treasury: ${jsonTreasury}\nMemo treasury: ${memoTreasury}\n\nMemo text:\n${memo}`
        );
        return;
      }

      setVerifyMsg(`✅ Verified!\nHash matches Memo.\n\nMemo text:\n${memo}`);
    } catch (e: any) {
      setVerifyMsg(e?.message ?? "❌ Verification failed unexpectedly.");
    }
  }

  function copyPublicLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "public");
    navigator.clipboard.writeText(url.toString());
    alert("Public view link copied ✅");
  }

  function copyShareBundle() {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "public");
    const publicLink = url.toString();

    const proofLink = proofTxSig
      ? explorerTxUrl(proofTxSig, settings.network)
      : "";

    const payload = [
      "OpenTreasury (Public View)",
      publicLink,
      proofLink ? `Proof Tx: ${proofLink}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    navigator.clipboard.writeText(payload);
    alert(
      proofTxSig ? "Public link + proof link copied ✅" : "Public link copied ✅"
    );
  }

  const ledgerEntries = Object.keys(meta).length;

  const filteredTxs = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return txs;

    return txs.filter((t) => {
      const m = meta[t.signature];
      const label = (m?.label ?? "").toLowerCase();
      const note = (m?.note ?? "").toLowerCase();
      const proofUrl = (m?.proofUrl ?? "").toLowerCase();
      return (
        t.signature.toLowerCase().includes(q) ||
        label.includes(q) ||
        note.includes(q) ||
        proofUrl.includes(q)
      );
    });
  }, [txs, meta, globalSearch]);

  const ledgerRows = useMemo(() => {
    const q = globalSearch.trim().toLowerCase();
    const rows = Object.entries(meta);
    if (!q) return rows;

    return rows.filter(([sig, m]) => {
      return (
        sig.toLowerCase().includes(q) ||
        m.label.toLowerCase().includes(q) ||
        (m.note ?? "").toLowerCase().includes(q) ||
        (m.proofUrl ?? "").toLowerCase().includes(q)
      );
    });
  }, [meta, globalSearch]);
 const treasureSummary = useMemo(() => {
  let inflow = 0;
  let outflow = 0;

  Object.values(txDeltaSol).forEach((v) => {
    if (v > 0) inflow += v;
    if (v < 0) outflow += v;
  });

  return {
    inflow,
    outflow,
    net: inflow + outflow,
    count: txs.length,
  };
 }, [txDeltaSol, txs]);  
  const treasuryFlow = useMemo(() => {
    const inflow: number[] = [];
    const outflow: number[] = [];

    Object.values(txDeltaSol).forEach((v) => {
      if (v > 0) inflow.push(v);
      if (v < 0) outflow.push(Math.abs(v));
    });

    return {
      inflowTotal: inflow.reduce((a, b) => a + b, 0),
      outflowTotal: outflow.reduce((a, b) => a + b, 0),
    };
  }, [txDeltaSol]);
  
  const baseBg =
    settings.theme === "dark"
      ? "radial-gradient(1200px 600px at 20% 0%, rgba(99,102,241,0.18), transparent 60%), radial-gradient(1000px 500px at 85% 25%, rgba(16,185,129,0.12), transparent 55%), #0b0f19"
      : "radial-gradient(1200px 600px at 20% 0%, rgba(99,102,241,0.10), transparent 60%), radial-gradient(1000px 500px at 85% 25%, rgba(16,185,129,0.08), transparent 55%), #f7f7fb";

  const cardBg =
    settings.theme === "dark" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)";
  const borderCol =
    settings.theme === "dark"
      ? "rgba(255,255,255,0.10)"
      : "rgba(0,0,0,0.10)";
  const textCol = settings.theme === "dark" ? "#e5e7eb" : "#0b1220";
  const subtleCol =
    settings.theme === "dark"
      ? "rgba(229,231,235,0.75)"
      : "rgba(11,18,32,0.65)";

  // CSS vars so icon tiles look good in light mode too
  const cssVars = {
    ["--ot-border" as any]: borderCol,
    ["--ot-btn-bg" as any]:
      settings.theme === "dark"
        ? "rgba(255,255,255,0.04)"
        : "rgba(255,255,255,0.70)",
    ["--ot-btn-active" as any]:
      settings.theme === "dark"
        ? "rgba(255,255,255,0.10)"
        : "rgba(0,0,0,0.06)",
  };

  return (
    <div
      style={{
        ...(cssVars as any),
        minHeight: "100vh",
        background: baseBg,
        color: textCol,
        fontFamily: "system-ui",
      }}
    >
      <div
        style={{
          maxWidth: 1220,
          margin: "0 auto",
          padding: "18px 16px 40px",
          display: "grid",
          gridTemplateColumns: isPublicView ? "1fr" : "74px 1fr",
          gap: 14,
        }}
      >
        {!isPublicView && (
          <div
            style={{
              position: "sticky",
              top: 16,
              alignSelf: "start",
              height: "calc(100vh - 32px)",
              borderRadius: 18,
              border: `1px solid ${borderCol}`,
              background: cardBg,
              padding: 10,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              backdropFilter: "blur(10px)",
            }}
          >
            <div
              style={{
                height: 46,
                borderRadius: 14,
                border: `1px solid ${borderCol}`,
                background:
                  settings.theme === "dark"
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(255,255,255,0.8)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 900,
                letterSpacing: 0.5,
              }}
              title="OpenTreasury"
            >
              OT
            </div>

            <ToolIconButton
              label="Dashboard"
              active={view === "dashboard"}
              onClick={() => setView("dashboard")}
            >
              <Icons.Dashboard size={24} />
            </ToolIconButton>

            <ToolIconButton
              label="Treasury Ledger"
              active={view === "ledger"}
              onClick={() => setView("ledger")}
            >
              <Icons.Ledger />
            </ToolIconButton>

            <ToolIconButton
              label="Protocol Proof"
              active={view === "proof"}
              onClick={() => setView("proof")}
            >
              <Icons.Proof />
            </ToolIconButton>

            <ToolIconButton
              label="Verify Proof"
              active={view === "verify"}
              onClick={() => setView("verify")}
            >
              <Icons.Verify />
            </ToolIconButton>

            <div style={{ flex: 1 }} />

            <ToolIconButton
              label="Settings"
              active={view === "settings"}
              onClick={() => setView("settings")}
            >
              <Icons.Settings />
            </ToolIconButton>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Header */}
          <div
            style={{
              borderRadius: 18,
              border: `1px solid ${borderCol}`,
              background: cardBg,
              padding: "14px 14px",
              backdropFilter: "blur(10px)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <div>
                <div
                  style={{
                    fontWeight: 950,
                    fontSize: 18,
                    letterSpacing: 0.2,
                  }}
                >
                  OpenTreasury (MVP){isPublicView ? " — Public View" : ""}
                </div>
                <div style={{ fontSize: 12, color: subtleCol, marginTop: 2 }}>
                  Treasury transparency dashboard ({settings.network}).{" "}
                  {isPublicView
                    ? "Read-only view for sharing."
                    : "Annotations are stored locally in your browser."}
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                {/* Search */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: `1px solid ${borderCol}`,
                    background:
                      settings.theme === "dark"
                        ? "rgba(0,0,0,0.25)"
                        : "rgba(255,255,255,0.7)",
                    minWidth: 280,
                  }}
                  title="Search by signature, category, description, link"
                >
                  <span style={{ opacity: 0.8 }}>
                    <Icons.Search />
                  </span>
                  <input
                    value={globalSearch}
                    onChange={(e) => setGlobalSearch(e.target.value)}
                    placeholder="Search transactions…"
                    style={{
                      width: "100%",
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      color: textCol,
                      fontSize: 13,
                    }}
                  />
                </div>

                {!isPublicView && (
                  <ToolIconButton
                    label={
                      settings.theme === "dark"
                        ? "Switch to Light mode"
                        : "Switch to Dark mode"
                    }
                    onClick={() =>
                      setSettings((s) => ({
                        ...s,
                        theme: s.theme === "dark" ? "light" : "dark",
                      }))
                    }
                  >
                    {settings.theme === "dark" ? <Icons.Moon /> : <Icons.Sun />}
                  </ToolIconButton>
                )}

                {!isPublicView && (
                  <ToolIconButton
                    label="Share (copy public link + proof link)"
                    onClick={copyShareBundle}
                  >
                    <Icons.Share />
                  </ToolIconButton>
                )}

                {isPublicView && (
                  <button
                    onClick={() => {
                      const url = new URL(window.location.href);
                      url.searchParams.delete("view");
                      navigator.clipboard.writeText(url.toString());
                      alert("Private link (no ?view=public) copied ✅");
                    }}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 14,
                      border: `1px solid ${borderCol}`,
                      background:
                        settings.theme === "dark"
                          ? "rgba(255,255,255,0.08)"
                          : "rgba(255,255,255,0.8)",
                      color: textCol,
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Copy Private Link
                  </button>
                )}
              </div>
            </div>

            {/* Treasury row */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isPublicView
                  ? "1fr"
                  : "1.4fr 0.6fr 0.6fr 0.6fr",
                gap: 12,
                marginTop: 14,
                alignItems: "end",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: subtleCol,
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
                    boxSizing: "border-box",
                    width: "100%",
                    padding: "12px 12px",
                    borderRadius: 14,
                    border: `1px solid ${borderCol}`,
                    background:
                      settings.theme === "dark"
                        ? "rgba(0,0,0,0.25)"
                        : "rgba(255,255,255,0.7)",
                    outline: "none",
                    color: textCol,
                    fontSize: 13,
                  }}
                />
                <div style={{ marginTop: 6, fontSize: 12, color: subtleCol }}>
                  Explorer:{" "}
                  <a
                    href={explorerAddrUrl(treasury.trim(), settings.network)}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: textCol,
                      fontWeight: 900,
                      textDecoration: "none",
                    }}
                  >
                    view →
                  </a>
                </div>
              </div>

              <div
               style={{
                 borderRadius: 18,
                 border: `1px solid ${borderCol}`,
                 background: cardBg,
                 padding: "12px 12px",
               }}
             >
               <div style={{ fontSize: 12, color: subtleCol }}>Balance</div>

               <div style={{ fontSize: 18, fontWeight: 900 }}>
                 {balanceSol === null
                   ? "—"
                   : settings.hideBalance
                   ? "••••"
                   : `${balanceSol.toFixed(4)} SOL`}
               </div>

               {!isPublicView && (
                 <button
                   type="button"
                   onClick={() =>
                     setSettings((s) => ({ ...s, hideBalance: !s.hideBalance }))
                   }
                   title={settings.hideBalance ? "Show balance" : "Hide balance"}
                   style={{
                     marginTop: 8,
                     padding: 0,
                     border: "none",
                     background: "transparent",
                     color: subtleCol,
                     cursor: "pointer",
                     display: "inline-flex",
                     alignItems: "center",
                     justifyContent: "center",
                   }}
                 >
                   {settings.hideBalance ? <Icons.EyeOff size={18} /> : <Icons.Eye size={18} />}
                 </button>
               )}
             </div>
             
              <div
                style={{
                  borderRadius: 18,
                  border: `1px solid ${borderCol}`,
                  background: cardBg,
                  padding: "12px 12px",
                }}
              >
                <div style={{ fontSize: 12, color: subtleCol }}>Status</div>
                <div style={{ fontSize: 13, fontWeight: 900 }}>
                  {status || "—"}
                </div>
              </div>

              <div
                style={{
                  borderRadius: 18,
                  border: `1px solid ${borderCol}`,
                  background: cardBg,
                  padding: "12px 12px",
                }}
              >
                <div style={{ fontSize: 12, color: subtleCol }}>
                  Ledger Entries
                </div>
                <div style={{ fontSize: 13, fontWeight: 900 }}>
                  {ledgerEntries}
                </div>
              </div>
            </div>
            <div
            style={{
               display: "grid",
               gridTemplateColumns: "repeat(4, 1fr)",
               gap: 12,
               marginTop: 12,
              }}
            >
             <div
               style={{
                 display: "grid",
                 gridTemplateColumns: "repeat(4, 1fr)",
                 gap: 12,
                 marginTop: 12,
               }}
            >
             <div style={{ fontSize: 12, color: subtleCol }}>Total Inflow</div>
             <div style={{ fontSize: 18, fontWeight: 900, color: "#34d399" }}>
             +{treasureSummary.inflow.toFixed(3)} SOL
             </div>
            </div>
            <div
              style={{
               borderRadius: 18,
               border: `1px solid ${borderCol}`,
               background: cardBg,
               padding: "12px",
              }}
            >
              <div style={{ fontSize: 12, color: subtleCol }}>Net Flow</div>
              <div
                style={{
                 fontSize: 18,
                 fontWeight: 900,
                 color:
                 treasureSummary.net >= 0
                   ? "#34d399"
                   : "#fb7185",
              }}
             >
               {treasureSummary.net >= 0 ? "+" : ""}
               {treasureSummary.net.toFixed(3)} SOL
             </div>
           </div>

           <div
               style={{
                 borderRadius: 18,
                 border: `1px solid ${borderCol}`,
                 background: cardBg,
                 padding: "12px",
               }}
           >
             <div style={{ fontSize: 12, color: subtleCol }}>
               Transactions Indexed
             </div>
             <div style={{ fontSize: 18, fontWeight: 900 }}>
                {treasureSummary.count}
              </div>
            </div>
          </div>


            {/* Header actions (icons) */}
            {!isPublicView && (
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  marginTop: 12,
                }}
              >
                <ToolIconButton
                  label="Copy Public View Link"
                  onClick={copyPublicLink}
                >
                  <Icons.Link />
                </ToolIconButton>

                <ToolIconButton
                  label="Download OTMS JSON"
                  onClick={exportLedger}
                >
                  <Icons.Download />
                </ToolIconButton>

                <label
                  title="Import JSON"
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 14,
                    border: `1px solid ${borderCol}`,
                    background:
                      settings.theme === "dark"
                        ? "rgba(255,255,255,0.04)"
                        : "rgba(255,255,255,0.70)",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  <Icons.Upload />
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

          {/* Error */}
          {error && (
            <div
              style={{
                borderRadius: 18,
                border: "1px solid rgba(255,0,0,0.25)",
                background:
                  settings.theme === "dark"
                    ? "rgba(255,0,0,0.08)"
                    : "rgba(255,0,0,0.06)",
                padding: 14,
              }}
            >
              <b>Error:</b> {error}
              <div style={{ marginTop: 6, fontSize: 12, color: subtleCol }}>
                Tip: Network is <b>{settings.network}</b>.
              </div>
            </div>
          )}

          {/* MAIN VIEWS */}
          {view === "dashboard" && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isPublicView ? "1fr" : "1.6fr 1fr",
                gap: 14,
              }}
            >
              {/* Recent transactions */}
              <div
                style={{
                  borderRadius: 18,
                  border: `1px solid ${borderCol}`,
                  background: cardBg,
                  padding: 14,
                  backdropFilter: "blur(10px)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <div style={{ fontWeight: 950, fontSize: 14 }}>
                    Recent Transactions {isPublicView ? "" : "(click to annotate)"}
                  </div>
                  {!isPublicView && (
                    <div style={{ fontSize: 12, color: subtleCol }}>
                      Tip: use search to filter by category (Donation/Grant/etc).
                    </div>
                  )}
                  {!isPublicView && (
                    <div
                      style={{
                        marginTop: 14,
                        borderRadius: 18,
                        border: `1px solid ${borderCol}`,
                        background: cardBg,
                        padding: 14,
                      }}
                    >
                      <div style={{ fontWeight: 900, marginBottom: 8 }}>
                        Treasury Flow
                      </div>

                      <div
                        style={{
                          display: "flex",
                          height: 12,
                          borderRadius: 8,
                          overflow: "hidden",
                          background:
                            settings.theme === "dark"
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(0,0,0,0.08)",
                        }}
                      >
                       <div
                         style={{
                           width: `${
                             (treasuryFlow.inflowTotal /
                               ((treasuryFlow.inflowTotal + treasuryFlow.outflowTotal) || 1)) *
                             100
                           }%`,
                           background: "#34d399",
                         }}
                       />

                       <div
                         style={{
                           width: `${
                             (treasuryFlow.outflowTotal /
                               ((treasuryFlow.inflowTotal + treasuryFlow.outflowTotal) || 1)) *
                             100
                           }%`,
                           background: "#fb7185",
                         }}
                       />
                     </div>

                     <div
                       style={{
                         display: "flex",
                         justifyContent: "space-between",
                         marginTop: 6,
                         fontSize: 12,
                         color: subtleCol,
                       }}
                    >
                      <span>Inflow: +{treasuryFlow.inflowTotal.toFixed(3)} SOL</span>
                      <span>Outflow: {treasuryFlow.outflowTotal.toFixed(3)} SOL</span>
                    </div>
                  </div>
                )}
                </div>

                <div
                  style={{
                    marginTop: 10,
                    overflowX: "auto",
                    borderRadius: 16,
                    border: `1px solid ${borderCol}`,
                    background:
                      settings.theme === "dark"
                        ? "rgba(0,0,0,0.18)"
                        : "rgba(255,255,255,0.6)",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      fontSize: 13,
                    }}
                  >
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${borderCol}` }}>
                        <th
                          style={{
                            textAlign: "left",
                            padding: 12,
                            color: subtleCol,
                          }}
                        >
                          Signature
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: 12,
                            color: subtleCol,
                          }}
                        >
                          Time
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: 12,
                            color: subtleCol,
                          }}
                        >
                          Category
                        </th>
                        <th 
                         style={{ 
                           textAlign: "left",
                           padding: 12,
                           color: subtleCol,
                         }}
                        >
                          Amount
                        </th>
                        <th
                          style={{
                            textAlign: "left",
                            padding: 12,
                            color: subtleCol,
                          }}
                        >
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTxs.length === 0 ? (
                        <tr>
                          <td colSpan={5} style={{ padding: 12, color: subtleCol }}>
                            No transactions found (or still loading).
                          </td>
                        </tr>
                      ) : (
                        filteredTxs.map((t) => {
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
                                borderTop: `1px solid ${borderCol}`,
                                background: isSelected
                                  ? "rgba(255,255,255,0.06)"
                                  : "transparent",
                              }}
                            >
                              <td style={{ padding: 12 }}>
                                <a
                                  href={explorerTxUrl(t.signature, settings.network)}
                                  target="_blank"
                                  rel="noreferrer"
                                  style={{
                                    textDecoration: "none",
                                    color: textCol,
                                    fontWeight: 900,
                                  }}
                                  title={t.signature}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {shortSig(t.signature)}
                                </a>
                              </td>
                              <td style={{ padding: 12, color: subtleCol }}>
                                {formatTime(t.blockTime)}
                              </td>
                              <td
                                style={{
                                  padding: 12,
                                  fontWeight: 900,
                                  color: labelColor(label),
                                }}
                              >
                                {label}
                              </td>
                              <td style={{ padding: 12, fontWeight: 900 }}>
                                {txDeltaLoading[t.signature] ? (
                                  <span style={{ color: subtleCol }}>…</span>
                                ) : txDeltaSol[t.signature] === undefined ? (
                                  <span style={{ color: subtleCol }}>—</span>
                                ) : (
                                  <span
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                    }}
                                  >
                                   <span
                                     style={{
                                       color: txDeltaSol[t.signature] >= 0 ? "#34d399" : "#fb7185",
                                     }}
                                   >
                                     {formatSolDelta(txDeltaSol[t.signature])}
                                   </span>

                                   <span
                                     style={{
                                       fontSize: 11,
                                       fontWeight: 900,
                                       padding: "3px 6px",
                                       borderRadius: 6,
                                       background:
                                         txDeltaSol[t.signature] >= 0
                                           ? "rgba(52,211,153,0.15)"
                                           : "rgba(251,113,133,0.15)",
                                       color:
                                         txDeltaSol[t.signature] >= 0
                                           ? "#34d399"
                                           : "#fb7185",
                                     }}
                                   >
                                     {txDeltaSol[t.signature] >= 0 ? "IN" : "OUT"}
                                   </span>
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
              </div>

              {/* Annotation editor */}
              {!isPublicView && (
                <div
                  ref={editorRef}
                  style={{
                    borderRadius: 18,
                    border: `1px solid ${borderCol}`,
                    background: cardBg,
                    padding: 14,
                    backdropFilter: "blur(10px)",
                  }}
                >
                  <div style={{ fontWeight: 950, fontSize: 14 }}>
                    Transaction Annotation
                  </div>
                  <div style={{ marginTop: 10 }}>
                    {!selectedSig ? (
                      <div style={{ color: subtleCol, fontSize: 13 }}>
                        Select a transaction to add context and evidence.
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 12, color: subtleCol }}>
                          Selected Transaction
                        </div>
                        <div
                          style={{
                            fontWeight: 950,
                            marginTop: 4,
                            marginBottom: 12,
                          }}
                        >
                          {shortSig(selectedSig)}
                        </div>

                        <label
                          style={{
                            display: "block",
                            fontSize: 12,
                            color: subtleCol,
                            marginBottom: 6,
                          }}
                        >
                          Category
                        </label>
                        <select
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value as LabelType)}
                          style={{
                            width: "100%",
                            padding: "12px 12px",
                            borderRadius: 14,
                            border: `1px solid ${borderCol}`,
                            outline: "none",
                            background:
                              settings.theme === "dark"
                                ? "rgba(0,0,0,0.25)"
                                : "rgba(255,255,255,0.7)",
                            color: textCol,
                            marginBottom: 12,
                            fontWeight: 900,
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
                            <label
                              style={{
                                display: "block",
                                fontSize: 12,
                                color: subtleCol,
                                marginBottom: 6,
                              }}
                            >
                              Custom Category Name
                            </label>
                            <input
                              value={editOtherDetail}
                              onChange={(e) => setEditOtherDetail(e.target.value)}
                              placeholder="e.g., Sponsorship, Refund, Equipment"
                              style={{
                                width: "100%",
                                padding: "12px 12px",
                                borderRadius: 14,
                                border: `1px solid ${borderCol}`,
                                outline: "none",
                                background:
                                  settings.theme === "dark"
                                    ? "rgba(0,0,0,0.25)"
                                    : "rgba(255,255,255,0.7)",
                                color: textCol,
                                marginBottom: 12,
                              }}
                            />
                          </>
                        )}

                        <label
                          style={{
                            display: "block",
                            fontSize: 12,
                            color: subtleCol,
                            marginBottom: 6,
                          }}
                        >
                          Description
                        </label>
                        <input
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                          placeholder="Brief explanation of transaction purpose"
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            padding: "12px 12px",
                            borderRadius: 14,
                            border: `1px solid ${borderCol}`,
                            outline: "none",
                            background:
                              settings.theme === "dark"
                                ? "rgba(0,0,0,0.25)"
                                : "rgba(255,255,255,0.7)",
                            color: textCol,
                            marginBottom: 12,
                          }}
                        />

                        <label
                          style={{
                            display: "block",
                            fontSize: 12,
                            color: subtleCol,
                            marginBottom: 6,
                          }}
                        >
                          Supporting Link
                        </label>
                        <input
                          value={editProof}
                          onChange={(e) => setEditProof(e.target.value)}
                          placeholder="https://documentation-or-proof-link"
                          style={{
                            width: "100%",
                            boxSizing: "border-box",
                            padding: "12px 12px",
                            borderRadius: 14,
                            border: `1px solid ${borderCol}`,
                            outline: "none",
                            background:
                              settings.theme === "dark"
                                ? "rgba(0,0,0,0.25)"
                                : "rgba(255,255,255,0.7)",
                            color: textCol,
                            marginBottom: 12,
                          }}
                        />

                        <div style={{ display: "flex", gap: 10 }}>
                          <button
                            onClick={saveMeta}
                            style={{
                              flex: 1,
                              padding: "12px 12px",
                              borderRadius: 14,
                              border: `1px solid ${borderCol}`,
                              background:
                                settings.theme === "dark"
                                  ? "rgba(255,255,255,0.10)"
                                  : "rgba(255,255,255,0.85)",
                              color: textCol,
                              fontWeight: 950,
                              cursor: "pointer",
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={clearMeta}
                            style={{
                              padding: "12px 12px",
                              borderRadius: 14,
                              border: `1px solid ${borderCol}`,
                              background: "transparent",
                              color: textCol,
                              fontWeight: 950,
                              cursor: "pointer",
                            }}
                          >
                            Remove
                          </button>
                        </div>

                        {saveMsg && (
                          <div style={{ marginTop: 10, fontSize: 13, color: subtleCol }}>
                            {saveMsg}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {view === "ledger" && (
            <div
              style={{
                borderRadius: 18,
                border: `1px solid ${borderCol}`,
                background: cardBg,
                padding: 14,
                backdropFilter: "blur(10px)",
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
                <div style={{ fontWeight: 950, fontSize: 14 }}>
                  Treasury Ledger ({ledgerEntries})
                </div>
                <div style={{ fontSize: 12, color: subtleCol }}>
                  Search filters this ledger too.
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                {ledgerRows.length === 0 ? (
                  <div style={{ color: subtleCol }}>No ledger entries found.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {ledgerRows.slice(0, 250).map(([sig, m]) => (
                      <div
                        key={sig}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "180px 120px 1fr 120px",
                          gap: 12,
                          alignItems: "center",
                          padding: "12px 12px",
                          borderRadius: 16,
                          border: `1px solid ${borderCol}`,
                          background:
                            settings.theme === "dark"
                              ? "rgba(0,0,0,0.20)"
                              : "rgba(255,255,255,0.6)",
                        }}
                      >
                        <a
                          href={explorerTxUrl(sig, settings.network)}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            textDecoration: "none",
                            fontWeight: 950,
                            color: textCol,
                          }}
                          title={sig}
                        >
                          {shortSig(sig)}
                        </a>

                        <div style={{ fontWeight: 950, color: labelColor(m.label) }}>
                          {m.label}
                        </div>

                        <div style={{ fontSize: 13, color: subtleCol }}>
                          {clamp(m.note ?? "", 120)}
                          {m.proofUrl ? (
                            <>
                              {" "}
                              ·{" "}
                              <a
                                href={m.proofUrl}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  color: textCol,
                                  fontWeight: 900,
                                  textDecoration: "none",
                                }}
                              >
                                link →
                              </a>
                            </>
                          ) : null}
                        </div>

                        {!isPublicView ? (
                          <button
                            onClick={() => {
                              setView("dashboard");
                              setSelectedSig(sig);
                              setTimeout(scrollToEditor, 60);
                            }}
                            style={{
                              padding: "10px 10px",
                              borderRadius: 14,
                              border: `1px solid ${borderCol}`,
                              background: "rgba(255,255,255,0.08)",
                              color: textCol,
                              fontWeight: 950,
                              cursor: "pointer",
                            }}
                            title="Edit this entry"
                          >
                            edit
                          </button>
                        ) : (
                          <span />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {!isPublicView && view === "proof" && (
            <div
              style={{
                borderRadius: 18,
                border: `1px solid ${borderCol}`,
                background: cardBg,
                padding: 14,
                backdropFilter: "blur(10px)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 950, fontSize: 14 }}>Protocol Proof</div>
                  <div style={{ fontSize: 12, color: subtleCol }}>
                    OTMS JSON → SHA-256 hash → anchor hash on-chain (Memo).
                  </div>
                </div>

                {/* ICON ACTIONS (same size tiles) */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <ToolIconButton label="Connect wallet" onClick={connectWallet}>
                    <Icons.Wallet />
                  </ToolIconButton>

                  <ToolIconButton
                    label="Use wallet as treasury"
                    onClick={useWalletAsTreasury}
                    disabled={!walletAddress}
                  >
                    <Icons.Link />
                  </ToolIconButton>

                  <ToolIconButton label="Generate proof hash" onClick={generateProof}>
                    <Icons.Hash />
                  </ToolIconButton>

                  <ToolIconButton
                    label="Anchor memo on-chain"
                    onClick={anchorProofOnChain}
                    disabled={!proofHash}
                  >
                    <Icons.Anchor />
                  </ToolIconButton>
                </div>
              </div>

              <div style={{ marginTop: 12, color: subtleCol, fontSize: 13 }}>
                Wallet:{" "}
                <b style={{ color: textCol }}>
                  {walletAddress
                    ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}`
                    : "not connected"}
                </b>
              </div>

              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, color: subtleCol }}>Current Proof Hash</div>
                <div
                  style={{
                    fontFamily: "ui-monospace, Menlo, monospace",
                    wordBreak: "break-all",
                    fontWeight: 900,
                  }}
                >
                  {proofHash || "—"}
                </div>

                {proofTxSig && (
                  <div style={{ marginTop: 8 }}>
                    Anchored Tx:{" "}
                    <a
                      href={explorerTxUrl(proofTxSig, settings.network)}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: textCol,
                        fontWeight: 950,
                        textDecoration: "none",
                      }}
                    >
                      {shortSig(proofTxSig)} →
                    </a>
                  </div>
                )}

                {proofMsg && <div style={{ marginTop: 8, color: subtleCol }}>{proofMsg}</div>}

                {proofJson && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 950 }}>
                      View OTMS JSON (Proof Payload)
                    </summary>
                    <pre
                      style={{
                        marginTop: 10,
                        padding: 12,
                        borderRadius: 16,
                        border: `1px solid ${borderCol}`,
                        background:
                          settings.theme === "dark"
                            ? "rgba(0,0,0,0.25)"
                            : "rgba(255,255,255,0.7)",
                        overflowX: "auto",
                        fontSize: 12,
                        color: textCol,
                      }}
                    >
                      {proofJson}
                    </pre>
                  </details>
                )}
              </div>
            </div>
          )}

          {!isPublicView && view === "verify" && (
            <div
              style={{
                borderRadius: 18,
                border: `1px solid ${borderCol}`,
                background: cardBg,
                padding: 14,
                backdropFilter: "blur(10px)",
              }}
            >
              <div style={{ fontWeight: 950, fontSize: 14 }}>Proof Verification</div>
              <div style={{ fontSize: 12, color: subtleCol, marginTop: 4 }}>
                Paste tx signature + OTMS JSON, then verify the hash matches the on-chain Memo.
              </div>

              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <input
                  value={verifyTx}
                  onChange={(e) => setVerifyTx(e.target.value)}
                  placeholder={`Paste ${settings.network} tx signature here…`}
                  style={{
                    width: "100%",
                    padding: "12px 12px",
                    borderRadius: 14,
                    border: `1px solid ${borderCol}`,
                    outline: "none",
                    background:
                      settings.theme === "dark"
                        ? "rgba(0,0,0,0.25)"
                        : "rgba(255,255,255,0.7)",
                    color: textCol,
                    fontSize: 13,
                  }}
                />

                <textarea
                  value={verifyJson}
                  onChange={(e) => setVerifyJson(e.target.value)}
                  placeholder="Paste OTMS JSON here…"
                  rows={9}
                  style={{
                    width: "100%",
                    padding: "12px 12px",
                    borderRadius: 14,
                    border: `1px solid ${borderCol}`,
                    outline: "none",
                    background:
                      settings.theme === "dark"
                        ? "rgba(0,0,0,0.25)"
                        : "rgba(255,255,255,0.7)",
                    color: textCol,
                    fontFamily: "ui-monospace, Menlo, monospace",
                    fontSize: 12,
                  }}
                />

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <button
                    onClick={verifyProof}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 14,
                      border: `1px solid ${borderCol}`,
                      background: "rgba(255,255,255,0.12)",
                      color: textCol,
                      fontWeight: 950,
                      cursor: "pointer",
                    }}
                  >
                    Verify Proof
                  </button>

                  {verifyTx.trim() && (
                    <a
                      href={explorerTxUrl(verifyTx.trim(), settings.network)}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: textCol, fontWeight: 950, textDecoration: "none" }}
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
                      borderRadius: 16,
                      border: `1px solid ${borderCol}`,
                      background:
                        settings.theme === "dark"
                          ? "rgba(0,0,0,0.25)"
                          : "rgba(255,255,255,0.7)",
                      whiteSpace: "pre-wrap",
                      color: textCol,
                      fontSize: 12,
                    }}
                  >
                    {verifyMsg}
                  </pre>
                )}
              </div>
            </div>
          )}

          {!isPublicView && view === "settings" && (
            <div
              style={{
                borderRadius: 18,
                border: `1px solid ${borderCol}`,
                background: cardBg,
                padding: 14,
                backdropFilter: "blur(10px)",
              }}
            >
              <div style={{ fontWeight: 950, fontSize: 14 }}>System Settings</div>
              <div style={{ fontSize: 12, color: subtleCol, marginTop: 4 }}>
                Local settings (stored in your browser for this MVP).
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
                {/* General */}
                <div
                  style={{
                    borderRadius: 16,
                    border: `1px solid ${borderCol}`,
                    background:
                      settings.theme === "dark"
                        ? "rgba(0,0,0,0.20)"
                        : "rgba(255,255,255,0.6)",
                    padding: 12,
                  }}
                >
                  <div style={{ fontWeight: 950 }}>General</div>

                  <label style={{ display: "block", marginTop: 10, fontSize: 12, color: subtleCol }}>
                    Language
                  </label>
                  <select
                    value={settings.language}
                    onChange={(e) => setSettings((s) => ({ ...s, language: e.target.value as Language }))
                    }
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      marginTop: 6,
                      borderRadius: 14,
                      border: `1px solid ${borderCol}`,
                      background:
                        settings.theme === "dark"
                          ? "rgba(0,0,0,0.25)"
                          : "rgba(255,255,255,0.85)",
                      color: textCol,
                      outline: "none",
                      fontWeight: 900,
                    }}
                  >
                    {LANGUAGE_OPTIONS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>

                  <label style={{ display: "block", marginTop: 10, fontSize: 12, color: subtleCol }}>
                    Currency
                  </label>
                  <select
                    value={settings.currency}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, currency: e.target.value as Currency }))
                    }
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      marginTop: 6,
                      borderRadius: 14,
                      border: `1px solid ${borderCol}`,
                      background:
                        settings.theme === "dark"
                          ? "rgba(0,0,0,0.25)"
                          : "rgba(255,255,255,0.85)",
                      color: textCol,
                      outline: "none",
                      fontWeight: 900,
                    }}
                  >
                    {CURRENCY_OPTIONS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Network */}
                <div
                  style={{
                    borderRadius: 16,
                    border: `1px solid ${borderCol}`,
                    background:
                      settings.theme === "dark"
                        ? "rgba(0,0,0,0.20)"
                        : "rgba(255,255,255,0.6)",
                    padding: 12,
                  }}
                >
                  <div style={{ fontWeight: 950 }}>Network</div>

                  <label style={{ display: "block", marginTop: 10, fontSize: 12, color: subtleCol }}>
                    Solana Cluster
                  </label>
                  <select
                    value={settings.network}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, network: e.target.value as ClusterKey }))
                    }
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      marginTop: 6,
                      borderRadius: 14,
                      border: `1px solid ${borderCol}`,
                      background:
                        settings.theme === "dark"
                          ? "rgba(0,0,0,0.25)"
                          : "rgba(255,255,255,0.85)",
                      color: textCol,
                      outline: "none",
                      fontWeight: 900,
                    }}
                  >
                    <option value="mainnet-beta">mainnet-beta</option>
                    <option value="testnet">testnet</option>
                    <option value="devnet">devnet</option>
                  </select>

                  <div style={{ marginTop: 10, fontSize: 12, color: subtleCol }}>
                    Changing network changes RPC + explorer links + stored ledger bucket.
                  </div>
                </div>

                {/* Privacy */}
                <div
                  style={{
                    borderRadius: 16,
                    border: `1px solid ${borderCol}`,
                    background:
                      settings.theme === "dark"
                        ? "rgba(0,0,0,0.20)"
                        : "rgba(255,255,255,0.6)",
                    padding: 12,
                  }}
                >
                  <div style={{ fontWeight: 950 }}>Security & Privacy</div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
                    <div>
                      <div style={{ fontWeight: 900 }}>Hide balance</div>
                      <div style={{ fontSize: 12, color: subtleCol }}>
                        Hides balance value in the header (local-only).
                      </div>
                    </div>
                    <button
                      onClick={() => setSettings((s) => ({ ...s, hideBalance: !s.hideBalance }))}
                      style={{
                        width: 54,
                        height: 34,
                        borderRadius: 999,
                        border: `1px solid ${borderCol}`,
                        background: settings.hideBalance
                          ? "rgba(52,211,153,0.25)"
                          : "rgba(255,255,255,0.06)",
                        position: "relative",
                        cursor: "pointer",
                      }}
                      title="Toggle hide balance"
                    >
                      <span
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: 999,
                          background: settings.theme === "dark" ? "#e5e7eb" : "#0b1220",
                          position: "absolute",
                          top: 3,
                          left: settings.hideBalance ? 26 : 3,
                          transition: "left .15s ease",
                        }}
                      />
                    </button>
                  </div>

                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${borderCol}` }}>
                    <div style={{ fontWeight: 900 }}>Auth (MVP placeholder)</div>
                    <div style={{ fontSize: 12, color: subtleCol, marginTop: 6 }}>
                      Registration/Login/Change password requires backend. We keep UI placeholders for now.
                    </div>
                  </div>
                </div>

                {/* Theme */}
                <div
                  style={{
                    borderRadius: 16,
                    border: `1px solid ${borderCol}`,
                    background:
                      settings.theme === "dark"
                        ? "rgba(0,0,0,0.20)"
                        : "rgba(255,255,255,0.6)",
                    padding: 12,
                  }}
                >
                  <div style={{ fontWeight: 950 }}>Appearance</div>

                  <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                    <button
                      onClick={() => setSettings((s) => ({ ...s, theme: "light" }))}
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        borderRadius: 14,
                        border: `1px solid ${borderCol}`,
                        background: settings.theme === "light" ? "rgba(255,255,255,0.85)" : "transparent",
                        color: textCol,
                        fontWeight: 950,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                      title="Light Mode"
                    >
                      <Icons.Sun /> Light
                    </button>

                    <button
                      onClick={() => setSettings((s) => ({ ...s, theme: "dark" }))}
                      style={{
                        flex: 1,
                        padding: "10px 12px",
                        borderRadius: 14,
                        border: `1px solid ${borderCol}`,
                        background: settings.theme === "dark" ? "rgba(255,255,255,0.10)" : "transparent",
                        color: textCol,
                        fontWeight: 950,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                      title="Dark Mode"
                    >
                      <Icons.Moon /> Dark
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {isPublicView && (
            <div
              style={{
                borderRadius: 18,
                border: `1px solid ${borderCol}`,
                background: cardBg,
                padding: 14,
                backdropFilter: "blur(10px)",
              }}
            >
              <div style={{ fontWeight: 950, fontSize: 14 }}>Public View</div>
              <div style={{ fontSize: 12, color: subtleCol, marginTop: 6 }}>
                This view is read-only. Share it publicly.
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: subtleCol }}>
                Tip: remove <b>?view=public</b> to return to the private admin view.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}