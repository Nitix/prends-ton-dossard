import { createContext, use, useEffect, useRef, useState, type ReactNode } from "react";

/** How long a message stays on screen. */
const TOAST_MS = 5000;

type Toast = { id: number; message: string };

const ToastContext = createContext<{ show(message: string): void } | null>(null);

/**
 * Shows short messages that go away by themselves ("Saved", an error that is
 * not tied to a field). The messages are in a live region, so a screen reader
 * reads them out as they appear.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Set<number>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) window.clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const show = (message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message }]);
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, TOAST_MS);
    timers.current.add(timer);
  };

  return (
    <ToastContext value={{ show }}>
      {children}
      {/* Above the tab bar on a phone, above the corner on a larger screen. */}
      <output className="pointer-events-none fixed inset-x-4 bottom-36 z-40 flex flex-col items-center gap-2 md:bottom-6">
        {toasts.map((toast) => (
          <p
            key={toast.id}
            className="flex animate-rise items-center gap-2.5 rounded-full bg-toast py-3 pr-5 pl-3.5 text-sm font-medium text-white shadow-[0_14px_36px_-12px_rgb(36_27_53/0.7)] ring-1 ring-white/10"
          >
            <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full bg-dawn" />
            {toast.message}
          </p>
        ))}
      </output>
    </ToastContext>
  );
}

export function useToast(): { show(message: string): void } {
  const value = use(ToastContext);
  if (!value) throw new Error("useToast must be used inside a ToastProvider");
  return value;
}
