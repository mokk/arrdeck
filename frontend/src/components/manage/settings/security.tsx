// Passkeys, signed-in devices and the setup code.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { Label } from "@/components/ui/label";
import {
  useAuthState,
  useDeletePasskey,
  useLogout,
  usePasskeys,
  useRevokeSessions,
  useSessions,
  useSetupCode,
} from "../../../hooks/queries";

import { passkeysSupported, registerPasskey } from "../../../lib/passkey";
import { Card } from "../../Blocks";

/* ---------------- services (connection settings) ---------------- */

const _SERVICE_FIELDS: Record<string, ("url" | "api_key" | "username" | "password")[]> = {
  radarr: ["url", "api_key"],
  sonarr: ["url", "api_key"],
  prowlarr: ["url", "api_key"],
  overseerr: ["url", "api_key"],
  qbittorrent: ["url", "username", "password"],
  transmission: ["url"],
  gluetun: ["url", "api_key"],
  bazarr: ["url", "api_key"],
  plex: ["url", "api_key"],
  prometheus: ["url"],
};

const _FIELD_KEYS: Record<string, string> = {
  url: "manage.url",
  api_key: "manage.apiKey",
  username: "manage.usernameOptional",
  password: "manage.passwordOptional",
};

export function SecurityCard() {
  const { t } = useTranslation();
  const { data: auth, refetch } = useAuthState();
  const supported = passkeysSupported();
  const { data: passkeys } = usePasskeys(supported || (auth?.lan ?? false));
  const { data: setup } = useSetupCode((auth?.lan ?? false) || (auth?.authenticated ?? false));
  const deletePasskey = useDeletePasskey();
  const logout = useLogout();
  const signedIn = (auth?.lan ?? false) || (auth?.authenticated ?? false);
  const { data: sessions } = useSessions(signedIn);
  const revoke = useRevokeSessions();
  const [busy, setBusy] = useState(false);

  const addPasskey = async () => {
    setBusy(true);
    try {
      await registerPasskey(`passkey ${new Date().toISOString().slice(0, 10)}`);
      toast.success(t("auth.passkeys"));
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-semibold">{t("auth.security")}</span>
          <div className="flex gap-1.5">
            {supported && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={addPasskey}>
                {t("auth.addPasskey")}
              </Button>
            )}
            {auth?.authenticated && (
              <Button
                size="sm"
                variant="secondary"
                className="text-destructive"
                disabled={logout.isPending}
                onClick={() => logout.mutate()}
              >
                {t("auth.signOut")}
              </Button>
            )}
          </div>
        </div>
        {!supported && (
          <span className="text-xs text-muted-foreground">{t("auth.needsHttps")}</span>
        )}
        {(passkeys ?? []).map((pk) => (
          <div key={pk.id} className="flex items-center justify-between text-sm">
            <span>
              {pk.name}{" "}
              <span className="text-xs text-muted-foreground">
                {new Date(pk.created * 1000).toLocaleDateString()}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={deletePasskey.isPending}
              aria-label={t("auth.deletePasskey", { name: pk.name })}
              onClick={() => deletePasskey.mutate(pk.id)}
            >
              ✕
            </Button>
          </div>
        ))}
        {passkeys && passkeys.length === 0 && (
          <span className="text-xs text-muted-foreground">{t("auth.noPasskeys")}</span>
        )}
        {(sessions ?? []).length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs text-muted-foreground">{t("auth.sessions")}</Label>
              {(sessions ?? []).some((s) => !s.current) && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={revoke.isPending}
                  onClick={() =>
                    revoke.mutate(undefined, {
                      onSuccess: (r) =>
                        toast.success(t("auth.sessionsRevoked", { count: r?.revoked ?? 0 })),
                    })
                  }
                >
                  {t("auth.signOutOthers")}
                </Button>
              )}
            </div>
            {(sessions ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t("auth.sessionSeen", {
                    when: new Date(s.last_used * 1000).toLocaleString(),
                  })}
                  {s.current && ` · ${t("auth.thisDevice")}`}
                </span>
                {!s.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={revoke.isPending}
                    aria-label={t("auth.revokeSession")}
                    onClick={() => revoke.mutate(s.id)}
                  >
                    ✕
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {setup && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("auth.setupCode")}</span>
            <span className="font-mono font-semibold tracking-[0.2em]">{setup.code}</span>
          </div>
        )}
        <span className="text-xs text-muted-foreground">{t("auth.registerHint")}</span>
      </div>
    </Card>
  );
}
