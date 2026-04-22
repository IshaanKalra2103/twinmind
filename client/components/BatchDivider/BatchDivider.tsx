import styles from "./BatchDivider.module.css";

export function BatchDivider({
  batchNumber,
  createdAt,
}: {
  batchNumber: number;
  createdAt: string;
}) {
  const time = new Date(createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return (
    <div className={styles.divider}>
      — Batch {batchNumber} · {time} —
    </div>
  );
}
