// One "are you sure?" for the whole app, governed by Settings → Display:
// ask before everything, only before deleting, or never. Callers await it and
// carry on when it resolves true, so a skipped question costs nothing.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { readPref } from "../lib/prefs";
import { BigButton } from "./media";
import { Sheet } from "./Sheet";

type Ask = {
  /** what will happen, as the button says it: "Unmonitor", "Delete file" */
  action: string;
  /** what it happens to */
  subject?: string | null;
  destructive?: boolean;
};

type Confirm = (ask: Ask) => Promise<boolean>;

const ConfirmContext = createContext<Confirm>(async () => true);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Ask | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback<Confirm>((ask) => {
    const policy = readPref("confirm");
    if (policy === "never" || (policy === "deletes" && !ask.destructive)) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setPending(ask);
    });
  }, []);

  const settle = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Sheet
          title={t("confirm.title", { action: pending.action })}
          subtitle={pending.subject ?? undefined}
          onClose={() => settle(false)}
        >
          <BigButton color={pending.destructive ? "red" : "blue"} onClick={() => settle(true)}>
            {pending.action}
          </BigButton>
          <BigButton color="muted" onClick={() => settle(false)}>
            {t("common.cancel")}
          </BigButton>
        </Sheet>
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
