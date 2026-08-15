import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuthState } from "../hooks/queries";
import { loginWithPasskey, passkeysSupported, registerPasskey } from "../lib/passkey";

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { data: auth } = useAuthState();
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const hasCredentials = auth?.has_credentials ?? true;
  const [showSetup, setShowSetup] = useState(false);
  const supported = passkeysSupported();
  const setupOpen = showSetup || !hasCredentials;

  const signIn = async () => {
    setBusy(true);
    try {
      await loginWithPasskey();
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const createPasskey = async () => {
    setBusy(true);
    try {
      await registerPasskey(`passkey ${new Date().toISOString().slice(0, 10)}`, code);
      onDone();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-8">
      <img src="/pwa-192.png" alt="" className="size-20 rounded-3xl" />
      <h1 className="text-3xl font-extrabold tracking-tight">arrdeck</h1>
      {supported ? (
        <div className="flex w-full max-w-xs flex-col gap-3">
          {hasCredentials && (
            <Button className="h-12 w-full rounded-2xl text-base" disabled={busy} onClick={signIn}>
              {busy ? t("auth.signingIn") : t("auth.passkey")}
            </Button>
          )}
          {setupOpen ? (
            <>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={t("auth.setupCode")}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                className="h-12 rounded-2xl text-center font-mono text-base tracking-[0.3em]"
              />
              <Button
                variant={hasCredentials ? "secondary" : "default"}
                className="h-12 w-full rounded-2xl text-base"
                disabled={busy || code.trim().length === 0}
                onClick={createPasskey}
              >
                {t("auth.createPasskey")}
              </Button>
              <p className="text-center text-xs text-muted-foreground">{t("auth.setupCodeHint")}</p>
            </>
          ) : (
            <button
              type="button"
              className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => setShowSetup(true)}
            >
              {t("auth.useSetupCode")}
            </button>
          )}
        </div>
      ) : (
        <p className="max-w-xs text-center text-sm text-muted-foreground">
          {t("auth.needsHttps")}
        </p>
      )}
    </div>
  );
}
