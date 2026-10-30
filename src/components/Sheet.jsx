import { useEffect, useRef } from "react";

// In-app dialog: a bottom sheet on phones, a centered card on wider screens.
// Replaces window.confirm(), which iPhone Safari was not showing reliably.
export default function Sheet({ open, onClose, title, children, role = "dialog", busy = false }) {
  const panelRef = useRef(null);
  const lastFocus = useRef(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    lastFocus.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the element marked data-autofocus, else the panel itself.
    const t = setTimeout(() => {
      const el =
        panelRef.current?.querySelector("[data-autofocus]") || panelRef.current;
      el?.focus();
    }, 0);
    const onKey = (e) => {
      if (e.key === "Escape" && !busyRef.current) closeRef.current();
      if (e.key === "Tab" && panelRef.current) {
        const f = panelRef.current.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      lastFocus.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="q-sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="q-sheet"
        role={role}
        aria-modal="true"
        aria-labelledby="q-sheet-title"
        tabIndex={-1}
      >
        <div className="q-sheet-grip" aria-hidden="true" />
        <h2 className="q-sheet-title" id="q-sheet-title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
