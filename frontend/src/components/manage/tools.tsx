// Settings → Tools: the arrs' exclusions, and what Radarr or Sonarr makes of a
// release name.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SERVICE_LABELS } from "../../api/format";
import type { Exclusion } from "../../api/types";
import { useExclusions, useParse, useRemoveExclusion } from "../../hooks/queries";
import {
  Card,
  EmptyNote,
  ErrorNote,
  Row,
  SectionTitle,
  Segmented,
  StateBadge,
} from "../Blocks";
import { useConfirm } from "../Confirm";

/** What Cleanup, "Not interested" and the arrs' own lists keep out. */
export function ExclusionsTool() {
  const { t } = useTranslation();
  const { data, error, isLoading } = useExclusions();
  const remove = useRemoveExclusion();
  const confirm = useConfirm();
  const byApp = new Map<string, Exclusion[]>();
  for (const e of data ?? []) byApp.set(e.app, [...(byApp.get(e.app) ?? []), e]);
  return (
    <>
      <p className="mx-1 mb-3 text-sm text-muted-foreground">{t("tools.exclusionsIntro")}</p>
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && <EmptyNote>{t("common.loading")}</EmptyNote>}
      {data && data.length === 0 && <EmptyNote>{t("tools.noExclusions")}</EmptyNote>}
      {[...byApp.entries()].map(([app, rows]) => (
        <div key={app}>
          <SectionTitle>{SERVICE_LABELS[app] ?? app}</SectionTitle>
          <Card>
            {rows.map((e) => (
              <Row key={`${e.app}-${e.id}`}>
                <div className="min-w-0 flex-1 truncate text-sm">
                  {e.title} <span className="text-muted-foreground">{e.year ?? ""}</span>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={remove.isPending}
                  onClick={async () => {
                    if (await confirm({ action: t("tools.allowAgain"), subject: e.title }))
                      remove.mutate({ app: e.app, id: e.id });
                  }}
                >
                  {t("tools.allowAgain")}
                </Button>
              </Row>
            ))}
          </Card>
        </div>
      ))}
    </>
  );
}

/** Paste a release name, see how the arr reads it. */
export function ParseTool({ apps }: { apps: string[] }) {
  const { t } = useTranslation();
  const [app, setApp] = useState(apps[0] ?? "radarr");
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("");
  const { data, error, isFetching } = useParse(app, title);
  const facts: [string, string | number | null | undefined][] = data
    ? [
        [t("tools.parsedTitle"), data.parsed_title],
        [t("tools.year"), data.year],
        [
          t("tools.episode"),
          data.season != null
            ? `S${String(data.season).padStart(2, "0")}${(data.episodes ?? []).map((n) => `E${String(n).padStart(2, "0")}`).join("")}${data.full_season ? ` (${t("tools.fullSeason")})` : ""}`
            : null,
        ],
        [t("tools.quality"), data.quality],
        [t("tools.languages"), (data.languages ?? []).join(", ") || null],
        [t("tools.group"), data.release_group],
        [t("tools.edition"), data.edition],
        [t("tools.formats"), (data.custom_formats ?? []).join(", ") || null],
        // a score without any formats is always 0, and says nothing
        [
          t("tools.score"),
          (data.custom_formats ?? []).length ? data.custom_format_score : null,
        ],
      ]
    : [];
  return (
    <>
      <p className="mx-1 mb-3 text-sm text-muted-foreground">{t("tools.parseIntro")}</p>
      {apps.length > 1 && (
        <Segmented
          options={apps.map((a) => ({ value: a, label: SERVICE_LABELS[a] ?? a }))}
          value={app}
          onChange={setApp}
        />
      )}
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTitle(input.trim());
        }}
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Dune.Part.Two.2024.2160p.UHD.BluRay.x265-GROUP"
          aria-label={t("tools.releaseName")}
          className="font-mono text-xs"
        />
        <Button type="submit" disabled={input.trim().length < 4 || isFetching}>
          {t("tools.parse")}
        </Button>
      </form>
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {data && (
        <>
          <Card>
            <Row>
              <div className="min-w-0 flex-1 text-sm">
                {data.match_title ? (
                  <>
                    <StateBadge state="ok" /> {t("tools.matches", { title: data.match_title })}
                    {(data.match_episodes ?? []).map((e) => (
                      <div key={e} className="truncate text-xs text-muted-foreground">
                        {e}
                      </div>
                    ))}
                  </>
                ) : (
                  <span className="text-muted-foreground">{t("tools.noMatch")}</span>
                )}
              </div>
            </Row>
          </Card>
          <Card>
            {facts
              .filter(([, v]) => v !== null && v !== undefined && v !== "")
              .map(([label, value]) => (
                <Row key={label}>
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
                  <span className="min-w-0 flex-1 break-words text-sm">{value}</span>
                </Row>
              ))}
          </Card>
        </>
      )}
    </>
  );
}
