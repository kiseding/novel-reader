import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  const [animating, setAnimating] = useState(false);
  const [visible, setVisible] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) { setVisible(true); requestAnimationFrame(() => setAnimating(true)); }
    else { setAnimating(false); const t = setTimeout(() => setVisible(false), 300); return () => clearTimeout(t); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  // Focus management: capture trigger on open, restore on close, trap Tab inside
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const moveFocusIn = () => {
      const root = dialogRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(FOCUSABLE);
      (first || root).focus();
    };
    const id = requestAnimationFrame(moveFocusIn);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => !el.hasAttribute("disabled"));
      if (!items.length) { e.preventDefault(); root.focus(); return; }
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !root.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("keydown", onKey);
      const back = restoreFocusRef.current;
      if (back && document.contains(back)) {
        try { back.focus(); } catch {}
      }
    };
  }, [open]);

  if (!visible) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`absolute inset-0 bg-black/50 dark:bg-black/70 transition-opacity duration-300 ${animating ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <div ref={dialogRef} tabIndex={-1} className={`relative bg-white dark:bg-gray-800 rounded-2xl shadow-xl dark:shadow-2xl w-full max-w-md p-6 transition-all duration-300 outline-none ${animating ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}>
        {title && <h2 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">{title}</h2>}
        {children}
        <button onClick={onClose} aria-label="关闭" className="absolute top-3 right-3 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700 text-lg leading-none transition-colors">✕</button>
      </div>
    </div>,
    document.body
  );
}
