import React, { createContext, useCallback, useContext, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Sparkles, Info, X } from 'lucide-react';

type ToastType = 'success' | 'info' | 'achievement';

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastContextValue {
  showToast: (toast: Omit<ToastItem, 'id'>) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const useToast = (): ToastContextValue => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
};

const ICON: Record<ToastType, React.ElementType> = {
  success: CheckCircle2,
  info: Info,
  achievement: Sparkles,
};

const ACCENT: Record<ToastType, string> = {
  success: 'bg-emerald-600',
  info: 'bg-blue-600',
  achievement: 'bg-indigo-600',
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: Omit<ToastItem, 'id'>) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      setToasts((prev) => [...prev, { ...toast, id }]);
      setTimeout(() => dismiss(id), 4200);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-100 flex flex-col gap-3 w-80 max-w-[calc(100vw-3rem)] pointer-events-none">
        <AnimatePresence>
          {toasts.map((toast) => {
            const Icon = ICON[toast.type];
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, y: 24, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 60, scale: 0.94, transition: { duration: 0.2 } }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                className="pointer-events-auto bg-white rounded-xl shadow-xl border border-slate-200 p-4 flex items-start gap-3"
              >
                <div
                  className={`w-8 h-8 rounded-lg ${ACCENT[toast.type]} text-white flex items-center justify-center shrink-0`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-900">{toast.title}</div>
                  {toast.message && (
                    <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{toast.message}</div>
                  )}
                </div>
                <button
                  onClick={() => dismiss(toast.id)}
                  className="text-slate-400 hover:text-slate-600 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};
