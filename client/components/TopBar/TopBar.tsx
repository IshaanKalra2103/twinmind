import type { ReactNode } from "react";
import styles from "./TopBar.module.css";

export function TopBar({
  title,
  meta,
  onOpenSettings,
  exportSlot,
}: {
  title: string;
  meta?: string;
  onOpenSettings?: () => void;
  exportSlot?: ReactNode;
}) {
  return (
    <div className={styles.topbar}>
      <h1 className={styles.title}>{title}</h1>
      {meta && <div className={styles.meta}>{meta}</div>}
      <div className={styles.actions}>
        {exportSlot}
        {onOpenSettings && (
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Settings"
          >
            ⚙ Settings
          </button>
        )}
      </div>
    </div>
  );
}
