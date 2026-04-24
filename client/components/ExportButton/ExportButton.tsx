"use client";

import { useState } from "react";
import { useSession } from "@/lib/sessionStore";
import { buildExport } from "@/lib/export";
import styles from "./ExportButton.module.css";

export function ExportButton() {
  const { state } = useSession();
  const [busy, setBusy] = useState(false);

  const hasContent =
    state.transcript.length > 0 ||
    state.batches.length > 0 ||
    state.chat.length > 0;

  const onClick = () => {
    if (busy) return;
    setBusy(true);
    try {
      const bundle = buildExport(state);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `twinmind-session-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={styles.btn}
      onClick={onClick}
      disabled={busy || !hasContent}
      title={hasContent ? "Download session JSON" : "Start a session first"}
    >
      {busy ? "Exporting…" : "↓ Export"}
    </button>
  );
}
