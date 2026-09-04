import { useCallback, useRef, type RefCallback } from "react";

function scrollableAncestor(start: EventTarget | null, root: HTMLElement): HTMLElement | null {
  let node = start instanceof HTMLElement ? start : null;
  while (node && root.contains(node)) {
    const { overflowY } = getComputedStyle(node);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return node;
    }
    if (node === root) break;
    node = node.parentElement;
  }
  return root.scrollHeight > root.clientHeight + 1 ? root : null;
}

function clampScroll(el: HTMLElement, delta: number) {
  const max = el.scrollHeight - el.clientHeight;
  const next = Math.max(0, Math.min(max, el.scrollTop + delta));
  if (next === el.scrollTop) return false;
  el.scrollTop = next;
  return true;
}

/**
 * Dialog scroll-lock preventDefaults wheel/touch on portaled menus.
 * Native non-passive listeners restore scrolling (scrollbar drag already worked).
 */
export function useForwardLockedScroll<T extends HTMLElement>(): RefCallback<T> {
  const lastY = useRef<number | null>(null);
  const cleanup = useRef<(() => void) | null>(null);

  return useCallback((node: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!node) return;

    const onWheel = (e: WheelEvent) => {
      if (!node.contains(e.target as Node)) return;
      const el = scrollableAncestor(e.target, node);
      if (!el) return;
      if (!clampScroll(el, e.deltaY)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    const onTouchStart = (e: TouchEvent) => {
      lastY.current = e.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (lastY.current == null) return;
      if (!node.contains(e.target as Node)) return;
      const el = scrollableAncestor(e.target, node);
      const y = e.touches[0]?.clientY;
      if (!el || y == null) return;
      const dy = lastY.current - y;
      lastY.current = y;
      if (!clampScroll(el, dy)) return;
      e.preventDefault();
      e.stopPropagation();
    };

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    cleanup.current = () => {
      node.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("touchmove", onTouchMove, { capture: true });
    };
  }, []);
}
