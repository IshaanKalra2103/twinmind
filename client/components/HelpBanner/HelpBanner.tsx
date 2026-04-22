import type { ReactNode } from "react";
import styles from "./HelpBanner.module.css";

export type HelpBannerVariant = "info" | "warn" | "danger";

export function HelpBanner({
  variant = "info",
  children,
}: {
  variant?: HelpBannerVariant;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.banner} ${styles[variant]}`} role="note">
      {children}
    </div>
  );
}
