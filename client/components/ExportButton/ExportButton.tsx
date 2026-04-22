"use client";

import { useState } from "react";
import { exportSession } from "@/lib/api";
import { useSession } from "@/lib/sessionStore";
import styles from "./ExportButton.module.css";

export function ExportButton() {
  const { state } = useSession();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await exportSession({
        ctx: { apiKey: state.apiKey, sessionId: state.sessionId },
      });
      const blob = new Blob([JSON.stringify(data, null, 2)], {
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
    } catch (e) {
      console.error("export failed", e);
      alert(
        "Export failed. Is the backend running? See browser console for details."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={styles.btn}
      onClick={onClick}
      disabled={busy || !state.sessionId}
      title={state.sessionId ? "Download session JSON" : "Start a session first"}
    >
      {busy ? "Exporting…" : "↓ Export"}
    </button>
  );
}
