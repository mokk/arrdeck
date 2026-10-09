import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "../api/client";

// a base64url sha256 — what the iOS app puts in the link it opens
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** Where the iOS app's sign-in sheet lands once the passkey has worked.
 * The app can't run WebAuthn itself, so this page hands it a one-time code to
 * trade for a session of its own. Behind a button, not automatic: any page
 * could send a signed-in browser here, and the code should only leave on a
 * deliberate tap. */
export function PairScreen() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const challenge = new URLSearchParams(window.location.search).get("challenge") ?? "";
  const valid = CHALLENGE.test(challenge);

  const pair = async () => {
    setBusy(true);
    try {
      const { code } = await api.post<{ code: string }>("/auth/pair/code", { challenge });
      window.location.href = `arrdeck://paired?code=${encodeURIComponent(code)}`;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-8">
      <img src="/pwa-192.png" alt="" className="size-20 rounded-3xl" />
      <h1 className="text-3xl font-extrabold tracking-tight">arrdeck</h1>
      {valid ? (
        <div className="flex w-full max-w-xs flex-col gap-3">
          <Button className="h-12 w-full rounded-2xl text-base" disabled={busy} onClick={pair}>
            {t("auth.pairPhone")}
          </Button>
          <p className="text-center text-xs text-muted-foreground">{t("auth.pairHint")}</p>
        </div>
      ) : (
        <p className="max-w-xs text-center text-sm text-muted-foreground">
          {t("auth.pairFromApp")}
        </p>
      )}
    </div>
  );
}
