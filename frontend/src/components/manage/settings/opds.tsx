// Settings → Reading apps: the OPDS feed e-reader apps browse and download
// from. Its address carries a secret, since those apps cannot sign in; a new
// secret retires the old address.
import { Copy, RefreshCw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useOpdsSettings, useOpdsToken } from "../../../hooks/queries";
import { Card, EmptyNote } from "../../Blocks";
import { useConfirm } from "../../Confirm";

export function OpdsSettings() {
  const { t } = useTranslation();
  const { data } = useOpdsSettings();
  const token = useOpdsToken();
  const confirm = useConfirm();
  const [copied, setCopied] = useState(false);
  if (!data) return <EmptyNote>{t("common.loading")}</EmptyNote>;
  if (!data.available) return <EmptyNote>{t("opds.unavailable")}</EmptyNote>;
  const url = data.token ? `${window.location.origin}/opds/${data.token}` : null;

  return (
    <>
      <p className="mx-1 mb-3 text-sm text-muted-foreground">{t("opds.intro")}</p>
      <Card className="p-4">
        {url ? (
          <>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("opds.address")}
            </div>
            <div className="mb-3 break-all rounded-lg bg-background/50 px-3 py-2 font-mono text-xs">
              {url}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
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
                      subject: t("opds.regenerateHint"),
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
            {t("opds.enable")}
          </Button>
        )}
      </Card>
      <p className="mx-1 mb-6 mt-2 text-xs text-muted-foreground">{t("opds.hint")}</p>
    </>
  );
}
