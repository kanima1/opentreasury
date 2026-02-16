import { useEffect, useMemo, useRef, useState } from "react";
import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
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
  note?: string; // used as "Description" (and also stores Other detail via "Other: ...")
  proofUrl?: string; // "Supporting Link"
};

type Tab = "Dashboard" | "Classified Transactions";

const DEFAULT_TREASURY = "Vote111111111111111111111111111111111111111"; // placeholder (valid address)

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
      return "#16a34a"; // green
    case "Grant":
      return "#2563eb"; // blue
    case "Ops":
      return "#f59e0b"; // amber
    case "Milestone":
      return "#9333ea"; // purple
    case "Other":
      return "#64748b"; // gray
    default:
      return "#111";
  }
}

// If note is like "Other: xyz", extract "xyz"
function parseOtherDetail(note?: string) {
  if (!note) return "";
  const m = note.match(/^other:\s*(.*)$/i);
  return m ? m[1] : "";
}

export default function App() {
  const [tab, setTab] = useState<Tab>("Dashboard");

  const [treasury, setTreasury] = useState<string>(DEFAULT_TREASURY);
  const [status, setStatus] = useState<string>("");
  const [balanceSol, setBalanceSol] = useState<number | null>(null);
  const [txs, setTxs] = useState<TxRow[]>([]);
  const [error, setError] = useState<string>("");

  const [meta, setMeta] = useState<Record<string, TxMeta>>({});
  const [selectedSig, setSelectedSig] = useState<string | null>(null);

  const [editLabel, setEditLabel] = useState<LabelType>("Donation");
  const [editOtherDetail, setEditOtherDetail] = useState<string>(""); // only used when label = Other
  const [editNote, setEditNote] = useState<string>(""); // "Description"
  const [editProof, setEditProof] = useState<string>(""); // "Supporting Link"
  const [saveMsg, setSaveMsg] = useState<string>("");

  const [searchSaved, setSearchSaved] = useState<string>("");

  const editorRef = useRef<HTMLDivElement | null>(null);

  // Devnet for now (safe + free). We'll add mainnet toggle later.
  const connection = useMemo(
    () => new Connection("https://api.devnet.solana.com", "confirmed"),
    []
  );

  // Load saved classifications for current treasury
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(treasury));
      setMeta(raw ? JSON.parse(raw) : {});
    } catch {
      setMeta({});
    }
    setSelectedSig(null);
    setSaveMsg("");
    setSearchSaved("");
  }, [treasury]);

  // Fetch balance + tx list
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

        const rows: TxRow[] = sigs.map((s) => ({
          signature: s.signature,
          slot: s.slot,
          blockTime: s.blockTime,
          err: s.err ? JSON.stringify(s.err) : null,
        }));

        setTxs(rows);
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

  // When selecting a tx, populate editor fields with saved values
  useEffect(() => {
    if (!selectedSig) return;

    const saved = meta[selectedSig];
    if (saved) {
      setEditLabel(saved.label);
      setEditProof(saved.proofUrl ?? "");

      if (saved.label === "Other") {
        setEditOtherDetail(parseOtherDetail(saved.note));
        // If note includes extra info like "Other: X | Y", keep Y as Description
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

  // If user changes label away from Other, clear Other detail
  useEffect(() => {
    if (editLabel !== "Other") setEditOtherDetail("");
  }, [editLabel]);

  function scrollToEditor() {
    editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function selectTx(sig: string, opts?: { goEditor?: boolean }) {
    setSelectedSig(sig);
    if (opts?.goEditor) {
      setTimeout(() => {
        setTab("Dashboard");
        setTimeout(scrollToEditor, 50);
      }, 0);
    }
  }

  function saveMeta() {
    if (!selectedSig) return;

    const trimmedProof = editProof.trim();
    if (trimmedProof && !isValidHttpUrl(trimmedProof)) {
      setSaveMsg("❌ Supporting Link must be a valid http(s) URL.");
      return;
    }

    const desc = editNote.trim();
    const other = editOtherDetail.trim();

    let finalNote: string | undefined = undefined;

    if (editLabel === "Other") {
      // Store as: "Other: <custom>" + optionally " | <description>"
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
    if (!selectedSig) return;
    const next = { ...meta };
    delete next[selectedSig];
    setMeta(next);
    localStorage.setItem(storageKey(treasury), JSON.stringify(next));
    setSaveMsg("Removed ✅");
  }

  const labeledCount = Object.keys(meta).length;

  const savedEntries = Object.entries(meta).filter(([sig, m]) => {
    const q = searchSaved.trim().toLowerCase();
    if (!q) return true;
    return (
      sig.toLowerCase().includes(q) ||
      m.label.toLowerCase().includes(q) ||
      (m.note ?? "").toLowerCase().includes(q) ||
      (m.proofUrl ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "40px auto",
        padding: "0 16px",
        fontFamily: "system-ui",
      }}
    >
      <h1 style={{ marginBottom: 4 }}>OpenTreasury (MVP)</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Treasury transparency dashboard (devnet). Classifications are stored locally in your browser.
      </p>

      {/* Top Controls */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end", marginTop: 16 }}>
        <div style={{ flex: 1, minWidth: 320 }}>
          <label style={{ display: "block", fontSize: 12, opacity: 0.75, marginBottom: 6 }}>
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
          <div style={{ fontSize: 12, opacity: 0.75 }}>Classified Transactions</div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{labeledCount}</div>
        </div>
      </div>

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
          onClick={() => setTab("Classified Transactions")}
          style={{
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.15)",
            background: tab === "Classified Transactions" ? "#111" : "rgba(0,0,0,0.06)",
            color: tab === "Classified Transactions" ? "white" : "black",
            fontWeight: 900,
            cursor: "pointer",
          }}
        >
          Classified Transactions ({labeledCount})
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
        <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14, marginTop: 20 }}>
          <div>
            <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 16 }}>
              Recent Transactions (select to classify)
            </h2>

            <div style={{ overflowX: "auto", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead style={{ background: "rgba(0,0,0,0.03)" }}>
                  <tr>
                    <th style={{ textAlign: "left", padding: 10 }}>Signature</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Time</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Category</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Error</th>
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
                            setSelectedSig(t.signature);
                            setTimeout(scrollToEditor, 50);
                          }}
                          style={{
                            cursor: "pointer",
                            borderTop: "1px solid rgba(0,0,0,0.08)",
                            background: isSelected ? "rgba(0,0,0,0.04)" : "transparent",
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
                          <td style={{ padding: 10 }}>{t.err ?? "—"}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
              Tip: Use “Classified Transactions” to search and revisit any classification.
            </div>
          </div>

          {/* Classification editor */}
          <div ref={editorRef}>
            <h2 style={{ marginTop: 0, marginBottom: 8, fontSize: 16 }}>
              Transaction Classification
            </h2>

            <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 12 }}>
              {!selectedSig ? (
                <div style={{ opacity: 0.75, fontSize: 13 }}>
                  Select a transaction to classify and document its purpose.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>Selected Transaction</div>
                  <div style={{ fontWeight: 900, marginBottom: 14 }}>{shortSig(selectedSig)}</div>

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
                      Save Classification
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
                      Remove Classification
                    </button>
                  </div>

                  {saveMsg && <div style={{ marginTop: 10, fontSize: 13 }}>{saveMsg}</div>}
                </>
              )}
            </div>

            <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
              Next: add mainnet toggle + public share view.
            </div>
          </div>
        </div>
      )}

      {/* Classified Transactions Tab */}
      {tab === "Classified Transactions" && (
        <div style={{ marginTop: 18, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <div style={{ fontSize: 16, fontWeight: 900 }}>Classified Transactions</div>
            <input
              value={searchSaved}
              onChange={(e) => setSearchSaved(e.target.value)}
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
            {savedEntries.length === 0 ? (
              <div style={{ opacity: 0.75 }}>No classifications found.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {savedEntries.slice(0, 200).map(([sig, m]) => (
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

                    <div style={{ flex: 1, fontSize: 13, opacity: 0.9 }}>
                      {m.note ?? ""}
                    </div>

                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {m.proofUrl && (
                        <a href={m.proofUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                          link
                        </a>
                      )}
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
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
            Tip: Click “edit” to return to the Dashboard and open the editor automatically.
          </div>
        </div>
      )}
    </div>
  );
}
