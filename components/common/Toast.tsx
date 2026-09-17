"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * Toast：小便签从右上滑入，3~5 秒自动消失，可手动关闭。
 * 只使用 transform / opacity 动画。
 */

interface ToastItem {
  id: number;
  message: string;
  tone: "info" | "success" | "error";
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  push: (message: string, opts?: { tone?: ToastItem["tone"]; action?: ToastItem["action"] }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内使用");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<ToastApi["push"]>(
    (message, opts) => {
      const id = Date.now() + Math.random();
      setItems((prev) => [...prev.slice(-3), { id, message, tone: opts?.tone ?? "info", action: opts?.action }]);
      setTimeout(() => remove(id), opts?.action ? 6000 : 4000);
    },
    [remove],
  );

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-[min(320px,calc(100vw-2rem))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className={[
                "paper-noise pointer-events-auto relative rounded-[3px] px-3.5 py-2.5 text-sm shadow-(--shadow-paper)",
                item.tone === "error" ? "bg-rose text-paper-strong" : item.tone === "success" ? "bg-sage text-paper-strong" : "bg-paper-strong text-ink",
              ].join(" ")}
              role="status"
            >
              <div className="flex items-start gap-2">
                <span className="flex-1">{item.message}</span>
                {item.action ? (
                  <button
                    type="button"
                    className="paper-focus shrink-0 underline decoration-dotted underline-offset-2"
                    onClick={() => {
                      item.action?.onClick();
                      remove(item.id);
                    }}
                  >
                    {item.action.label}
                  </button>
                ) : null}
                <button type="button" aria-label="关闭提示" className="paper-focus shrink-0 opacity-60" onClick={() => remove(item.id)}>
                  ×
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
