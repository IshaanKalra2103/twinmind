import type { ReactNode } from "react";
import styles from "./HelpBanner.module.css";

export type HelpBannerVariant = "info" | "warn" | "danger";

export interface HelpBannerAction {
  label: string;
  onClick: () => void;
}

export function HelpBanner({
  variant = "info",
  children,
  action,
}: {
  variant?: HelpBannerVariant;
  children: ReactNode;
  action?: HelpBannerAction;
}) {
  return (
    <div className={`${styles.banner} ${styles[variant]}`} role="note">
      <span className={styles.message}>{children}</span>
      {action && (
        <button
          type="button"
          className={styles.action}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
