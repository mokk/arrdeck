// Settings → Calendar subscription: one address Apple Calendar, Google
// Calendar or Outlook can subscribe to, with Radarr, Sonarr and Readarr merged.
// Like the OPDS feed its address carries a secret, since calendar apps cannot
// sign in; a new secret retires the old address.
import { CalendarPlus, Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn, focusRing } from "@/lib/utils";
import { SERVICE_LABELS } from "../../../api/format";
import { useIcalSettings, useIcalToken } from "../../../hooks/queries";
import { Card, EmptyNote } from "../../Blocks";
import { useConfirm } from "../../Confirm";

export function IcalSettings() {
  const { t } = useTranslation();
  const { data } = useIcalSettings();
  const token = useIcalToken();
  const confirm = useConfirm();
  const [copied, setCopied] = useState(false);
  const [left, setLeft] = useState<Set<string>>(new Set());
  if (!data) return <EmptyNote>{t("common.loading")}</EmptyNote>;
  const apps = data.apps ?? [];
  if (apps.length === 0) return <EmptyNote>{t("ical.unavailable")}</EmptyNote>;
  const chosen = apps.filter((a) => !left.has(a));
  const query = chosen.length < apps.length ? `?apps=${chosen.join(",")}` : "";
  const url = data.token
    ? `${window.location.origin}/ical/${data.token}/arrdeck.ics${query}`
    : null;

  return (
    <>
      <p className="mx-1 mb-3 text-sm text-muted-foreground">{t("ical.intro")}</p>
      <Card className="p-4">
        {url ? (
          <>
            {apps.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-1.5">
                {apps.map((app) => {
                  const on = !left.has(app);
                  return (
                    <button
                      type="button"
                      key={app}
                      className={cn(
                        focusRing,
                        "rounded-full px-3 py-1.5 text-xs font-semibold active:opacity-60",
                        on
                          ? "bg-primary/15 text-primary"
                          : "bg-secondary text-muted-foreground",
                      )}
                      aria-pressed={on}
                      disabled={on && chosen.length === 1}
                      onClick={() =>
                        setLeft((old) => {
                          const next = new Set(old);
                          if (on) next.add(app);
                          else next.delete(app);
                          return next;
                        })
                      }
                    >
                      {SERVICE_LABELS[app] ?? app}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("ical.address")}
            </div>
            <div className="mb-3 break-all rounded-lg bg-background/50 px-3 py-2 font-mono text-xs">
              {url}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" asChild>
                <a href={url.replace(/^https?:/, "webcal:")}>
                  <CalendarPlus /> {t("ical.subscribe")}
                </a>
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await navigator.clipboard?.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                <Copy /> {copied ? t("opds.copied") : t("opds.copy")}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={token.isPending}
                onClick={async () => {
                  if (
                    await confirm({
                      action: t("opds.regenerate"),
                      subject: t("ical.regenerateHint"),
                      destructive: true,
                    })
                  )
                    token.mutate(true);
                }}
              >
                <RefreshCw /> {t("opds.regenerate")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={token.isPending}
                onClick={() => token.mutate(false)}
              >
                {t("opds.disable")}
              </Button>
            </div>
          </>
        ) : (
          <Button disabled={token.isPending} onClick={() => token.mutate(true)}>
            {t("ical.enable")}
          </Button>
        )}
      </Card>
      <p className="mx-1 mb-6 mt-2 text-xs text-muted-foreground">{t("ical.hint")}</p>
    </>
  );
}
