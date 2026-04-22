import { useEffect, useRef, type RefObject } from "react";

/**
 * Scrolls `ref` to the bottom whenever any value in `deps` changes AND the
 * user was already near the bottom (within 80px). Avoids yanking users who
 * have scrolled up to re-read earlier text.
 */
export function useAutoScroll(
  ref: RefObject<HTMLElement | null>,
  deps: ReadonlyArray<unknown>
): void {
  const wasPinned = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
      wasPinned.current = distance < 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [ref]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (wasPinned.current) el.scrollTop = el.scrollHeight;
  }, deps);
}
