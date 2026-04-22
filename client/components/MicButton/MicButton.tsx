import styles from "./MicButton.module.css";

export function MicButton({
  recording,
  onToggle,
  disabled,
}: {
  recording: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${styles.btn} ${recording ? styles.recording : ""}`}
      onClick={onToggle}
      disabled={disabled}
      title={recording ? "Stop recording" : "Start recording"}
      aria-pressed={recording}
      aria-label={recording ? "Stop recording" : "Start recording"}
    >
      {/* Matches prototype's filled-circle glyph (&#9679;) */}
      ●
    </button>
  );
}
