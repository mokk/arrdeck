import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, SectionTitle } from "./Blocks";
import { useRenameFiles, useRenamePreview } from "../hooks/queries";

/** Files whose names drifted from the arr's naming scheme. The card is absent
 * when everything already matches, so its presence is the signal. */
export function RenameCard({ app, id }: { app: "radarr" | "sonarr"; id: number }) {
  const { t } = useTranslation();
  const { data } = useRenamePreview(app, id, true);
  const rename = useRenameFiles();
  if (!data || data.length === 0) return null;
  return (
    <div className="mb-6">
      <SectionTitle>{t("movie.rename")}</SectionTitle>
      <Card>
        <div className="flex flex-col gap-2 p-4">
          {data.slice(0, 6).map((f) => (
            <div key={f.file_id} className="text-xs">
              <div className="truncate text-muted-foreground line-through">
                {f.existing_path}
              </div>
              <div className="truncate">{f.new_path}</div>
            </div>
          ))}
          {data.length > 6 && (
            <div className="text-xs text-muted-foreground">
              {t("movie.andMore", { count: data.length - 6 })}
            </div>
          )}
          <Button
            size="sm"
            disabled={rename.isPending}
            onClick={() =>
              rename.mutate(
                { app, id, fileIds: data.map((f) => f.file_id) },
                { onSuccess: () => toast.success(t("movie.renameStarted")) },
              )
            }
          >
            {t("movie.renameAll", { count: data.length })}
          </Button>
        </div>
      </Card>
    </div>
  );
}
