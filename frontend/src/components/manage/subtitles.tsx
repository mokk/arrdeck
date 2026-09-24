// Settings → Subtitles: everything Bazarr is still missing, and language
// profiles handed out in bulk — a title without one never gets subtitles.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SubtitleTitle } from "../../api/types";
import {
  useAssignProfile,
  useLanguageProfiles,
  useSubtitleSearch,
  useSubtitleSearchAll,
  useSubtitlesWanted,
  useSubtitleTitles,
} from "../../hooks/queries";
import { Card, EmptyNote, ErrorNote, Row, Segmented } from "../Blocks";
import { useConfirm } from "../Confirm";

type Tab = "missing" | "profiles";

export function SubtitlesTool() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("missing");
  return (
    <>
      <Segmented
        options={[
          { value: "missing", label: t("subtitles.missingTab") },
          { value: "profiles", label: t("subtitles.profilesTab") },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "missing" ? <MissingList /> : <ProfilesEditor />}
    </>
  );
}

function MissingList() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<"episode" | "movie">("episode");
  const { data, error, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useSubtitlesWanted(kind);
  const search = useSubtitleSearch();
  const searchAll = useSubtitleSearchAll();
  const items = data?.pages.flatMap((p) => p.items ?? []) ?? [];
  const total = data?.pages[0]?.total ?? 0;
  return (
    <>
      <Segmented
        options={[
          { value: "episode", label: t("subtitles.episodes") },
          { value: "movie", label: t("subtitles.movies") },
        ]}
        value={kind}
        onChange={setKind}
      />
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && <EmptyNote>{t("common.loading")}</EmptyNote>}
      {data && total === 0 && <EmptyNote>{t("subtitles.nothingMissing")}</EmptyNote>}
      {total > 0 && (
        <div className="mx-1 mb-2 flex items-center gap-3">
          <span className="flex-1 text-sm text-muted-foreground">
            {t("subtitles.missingCount", { count: total })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            disabled={searchAll.isPending}
            onClick={() => searchAll.mutate(kind)}
          >
            {t("subtitles.searchAll")}
          </Button>
        </div>
      )}
      {items.length > 0 && (
        <Card>
          {items.map((item) => (
            <Row key={`${item.kind}-${item.id}`}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{item.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {[item.subtitle, (item.missing ?? []).join(", ")].filter(Boolean).join(" · ")}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={search.isPending}
                onClick={() =>
                  search.mutate({
                    kind: item.kind as "movie" | "episode",
                    id: item.id,
                    series_id: item.series_id,
                  })
                }
              >
                {t("subtitles.search")}
              </Button>
            </Row>
          ))}
        </Card>
      )}
      {hasNextPage && (
        <Button
          variant="ghost"
          className="mb-4 w-full"
          disabled={isFetchingNextPage}
          onClick={() => fetchNextPage()}
        >
          {t("subtitles.more")}
        </Button>
      )}
    </>
  );
}

const NONE = "none";

function ProfilesEditor() {
  const { t } = useTranslation();
  const { data: profiles } = useLanguageProfiles();
  const { data: titles, error, isLoading } = useSubtitleTitles();
  const assign = useAssignProfile();
  const confirm = useConfirm();
  const [kind, setKind] = useState<"series" | "movie">("series");
  const [onlyUnset, setOnlyUnset] = useState(true);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState<string>("");
  const names = new Map((profiles ?? []).map((p) => [p.id, p.name]));
  const all = (titles ?? []).filter((r) => r.kind === kind);
  const shown = onlyUnset ? all.filter((r) => r.profile_id == null) : all;
  const unset = all.filter((r) => r.profile_id == null).length;
  const chosen = target || (profiles?.[0] ? String(profiles[0].id) : NONE);
  const allPicked = shown.length > 0 && shown.every((r) => picked.has(r.id));

  const switchKind = (k: "series" | "movie") => {
    setKind(k);
    setPicked(new Set());
  };
  const toggle = (row: SubtitleTitle) =>
    setPicked((old) => {
      const next = new Set(old);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });

  const apply = async () => {
    const profileId = chosen === NONE ? null : Number(chosen);
    const label = profileId == null ? t("subtitles.noProfile") : (names.get(profileId) ?? "");
    const ok = await confirm({
      action: t("subtitles.applyProfile", { profile: label }),
      subject: t("subtitles.titlesCount", { count: picked.size }),
    });
    if (!ok) return;
    assign.mutate(
      { kind, ids: [...picked], profile_id: profileId },
      { onSuccess: () => setPicked(new Set()) },
    );
  };

  return (
    <>
      <p className="mx-1 mb-3 text-sm text-muted-foreground">{t("subtitles.profilesIntro")}</p>
      <Segmented
        options={[
          { value: "series", label: t("subtitles.shows") },
          { value: "movie", label: t("subtitles.movies") },
        ]}
        value={kind}
        onChange={switchKind}
      />
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && <EmptyNote>{t("common.loading")}</EmptyNote>}
      {titles && (
        <Card>
          <Row>
            <label className="flex min-w-0 flex-1 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={onlyUnset}
                onChange={() => setOnlyUnset((v) => !v)}
                className="size-5 shrink-0 accent-primary"
              />
              {t("subtitles.onlyUnset", { count: unset })}
            </label>
          </Row>
          <Row>
            <label className="flex min-w-0 flex-1 items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={allPicked}
                disabled={shown.length === 0}
                onChange={() =>
                  setPicked(allPicked ? new Set() : new Set(shown.map((r) => r.id)))
                }
                className="size-5 shrink-0 accent-primary"
              />
              {t("subtitles.pickAll")}
            </label>
          </Row>
          <Row>
            <Select value={chosen} onValueChange={setTarget}>
              <SelectTrigger size="sm" className="w-auto flex-1 bg-secondary">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(profiles ?? []).map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name} ({p.languages?.join(", ")})
                  </SelectItem>
                ))}
                <SelectItem value={NONE}>{t("subtitles.noProfile")}</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" disabled={picked.size === 0 || assign.isPending} onClick={apply}>
              {t("subtitles.applyCount", { count: picked.size })}
            </Button>
          </Row>
        </Card>
      )}
      {titles && shown.length === 0 && <EmptyNote>{t("subtitles.allHaveProfile")}</EmptyNote>}
      {shown.length > 0 && (
        <Card>
          {shown.map((row) => (
            <Row key={row.id}>
              <label className="flex min-w-0 flex-1 items-center gap-3">
                <input
                  type="checkbox"
                  checked={picked.has(row.id)}
                  onChange={() => toggle(row)}
                  className="size-5 shrink-0 accent-primary"
                />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {row.title} <span className="text-muted-foreground">{row.year ?? ""}</span>
                </span>
              </label>
              <span className="shrink-0 text-xs text-muted-foreground">
                {row.profile_id == null
                  ? t("subtitles.noProfile")
                  : (names.get(row.profile_id) ?? row.profile_id)}
              </span>
            </Row>
          ))}
        </Card>
      )}
    </>
  );
}
