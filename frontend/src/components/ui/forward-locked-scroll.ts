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
 * Dialog scroll-lock blocks wheel on portaled menus (scrollbar still worked).
 * Mouse wheel is forwarded in JS. Touch is left native — JS scrollTop + iOS
 * momentum fighting is what made the list flicker.
 */
export function useForwardLockedScroll<T extends HTMLElement>(): RefCallback<T> {
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

    const onTouchMove = (e: TouchEvent) => {
      if (!node.contains(e.target as Node)) return;
      if (!scrollableAncestor(e.target, node)) return;
      // Keep the dialog lock from seeing this; do not preventDefault or
      // write scrollTop — native overflow handles finger pan + momentum.
      e.stopPropagation();
    };

    window.addEventListener("wheel", onWheel, { capture: true, passive: false });
    window.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
    cleanup.current = () => {
      window.removeEventListener("wheel", onWheel, { capture: true });
      window.removeEventListener("touchmove", onTouchMove, { capture: true });
    };
  }, []);
}
