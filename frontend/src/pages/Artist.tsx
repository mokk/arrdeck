import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "../api/format";
import type { ArtistDetail, LibraryAlbum } from "../api/types";
import {
  Card,
  EmptyNote,
  ErrorNote,
  Row,
  SectionTitle,
  StateBadge,
} from "../components/Blocks";
import { useConfirm } from "../components/Confirm";
import { DetailActions, DetailHeader, DetailHero } from "../components/detail";
import { Cover } from "../components/library/Cover";
import { albumState, musicLinks } from "../components/library/music";
import { BigButton } from "../components/media";
import { Sheet } from "../components/Sheet";
import {
  useArtistDetail,
  useBulkSearchLibrary,
  useDeleteLibraryItem,
  useMonitorAlbum,
  useOptions,
  useRefreshArtist,
  useTags,
  useUpdateArtist,
} from "../hooks/queries";

// Lidarr's primary album types, in the order its own artist page shows them;
// anything else follows under its own name
const TYPE_ORDER = ["Album", "EP", "Single", "Broadcast", "Other"];

function groupByType(albums: LibraryAlbum[]): [string, LibraryAlbum[]][] {
  const groups = new Map<string, LibraryAlbum[]>();
  for (const album of albums) {
    const type = album.album_type || "Other";
    groups.set(type, [...(groups.get(type) ?? []), album]);
  }
  const rank = (type: string) => {
    const i = TYPE_ORDER.indexOf(type);
    return i === -1 ? TYPE_ORDER.length : i;
  };
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

/** An artist as Lidarr keeps them: every album their metadata profile allows,
 * monitored or not — this is where an album gets monitored — grouped by
 * type, with the artist's own settings behind Edit. */
export default function ArtistPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const artistId = Number(id);
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data, error, isLoading } = useArtistDetail(artistId);
  const update = useUpdateArtist(artistId);
  const refresh = useRefreshArtist(artistId);
  const search = useBulkSearchLibrary("music");
  const remove = useDeleteLibraryItem("music");
  const monitorAlbum = useMonitorAlbum();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [editing, setEditing] = useState(false);

  return (
    <>
      <DetailHeader title={data?.name} sequence={{ route: "artist", id: artistId }} />
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && <Skeleton className="mb-4 h-40 w-full rounded-2xl" />}
      {data && (
        <>
          <DetailHero
            poster={data.poster}
            backdrop={data.fanart}
            square
            overview={data.overview}
            ratings={data.ratings}
            links={musicLinks("artist", data.slug, data.links)}
            badges={
              <>
                <StateBadge
                  state={
                    !data.monitored
                      ? "unmonitored"
                      : (data.track_file_count ?? 0) > 0
                        ? "downloaded"
                        : "wanted"
                  }
                />
                {data.disambiguation && <span>{data.disambiguation}</span>}
                <span>· {t("music.albums", { count: data.album_count ?? 0 })}</span>
                {(data.track_count ?? 0) > 0 && (
                  <span>
                    ·{" "}
                    {t("music.tracksOnDisk", {
                      have: data.track_file_count ?? 0,
                      total: data.track_count,
                    })}
                  </span>
                )}
                {data.size_on_disk ? <span>· {formatBytes(data.size_on_disk)}</span> : null}
              </>
            }
          />

          {(data.genres?.length ?? 0) > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {(data.genres ?? []).slice(0, 8).map((genre) => (
                <span
                  key={genre}
                  className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground"
                >
                  {genre}
                </span>
              ))}
            </div>
          )}

          <div className="mb-5">
            <DetailActions
              monitored={data.monitored ?? false}
              busy={update.isPending || remove.isPending || search.isPending}
              confirming={confirmingDelete}
              onConfirmingChange={setConfirmingDelete}
              onToggleMonitor={() => update.mutate({ monitored: !data.monitored })}
              // every monitored album of theirs that is missing or below cutoff
              onSearch={() => search.mutate([artistId])}
              // the two red buttons are the confirmation, as on the other pages
              onDelete={(deleteFiles) =>
                remove.mutate(
                  { id: artistId, deleteFiles },
                  { onSuccess: () => navigate("/music", { replace: true }) },
                )
              }
              extra={
                <>
                  <BigButton
                    color="blue"
                    disabled={refresh.isPending}
                    onClick={() => refresh.mutate()}
                  >
                    {t("artist.refresh")}
                  </BigButton>
                  <BigButton color="blue" onClick={() => setEditing(true)}>
                    {t("artist.edit")}
                  </BigButton>
                </>
              }
            />
          </div>

          {(data.albums ?? []).length === 0 && <EmptyNote>{t("artist.noAlbums")}</EmptyNote>}
          {groupByType(data.albums ?? []).map(([type, albums]) => (
            <div key={type}>
              <SectionTitle>
                {t(`music.type.${type}`, { defaultValue: type })} ({albums.length})
              </SectionTitle>
              <Card>
                {albums.map((album) => (
                  <Row key={album.id} onClick={() => navigate(`/album/${album.id}`)}>
                    <div className="w-10 shrink-0">
                      <Cover src={album.poster} title={album.title ?? ""} compact square />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {album.title}{" "}
                        <span className="text-muted-foreground">{album.year ?? ""}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {[
                          t("music.tracksOnDisk", {
                            have: album.track_file_count ?? 0,
                            total: album.track_count ?? 0,
                          }),
                          ...(album.secondary_types ?? []),
                        ].join(" · ")}
                      </div>
                    </div>
                    <StateBadge state={albumState(album)} />
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={monitorAlbum.isPending}
                      onClick={async (e) => {
                        e.stopPropagation();
                        const action = album.monitored ? t("add.unmonitor") : t("add.monitor");
                        if (await confirm({ action, subject: album.title }))
                          monitorAlbum.mutate({ id: album.id, monitored: !album.monitored });
                      }}
                    >
                      {album.monitored ? t("add.unmonitor") : t("add.monitor")}
                    </Button>
                  </Row>
                ))}
              </Card>
            </div>
          ))}
        </>
      )}
      {editing && data && <EditArtist artist={data} onClose={() => setEditing(false)} />}
    </>
  );
}

/** The artist's settings, as Lidarr's own Edit Artist has them. Only what
 * changed is sent. */
function EditArtist({ artist, onClose }: { artist: ArtistDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: options } = useOptions("lidarr");
  const { data: tags } = useTags("lidarr");
  const update = useUpdateArtist(artist.id);
  const [quality, setQuality] = useState(artist.quality_profile_id ?? null);
  const [metadata, setMetadata] = useState(artist.metadata_profile_id ?? null);
  const [newItems, setNewItems] = useState(artist.monitor_new_items ?? "all");
  const [path, setPath] = useState(artist.path ?? "");
  const [moveFiles, setMoveFiles] = useState(false);
  const [chosenTags, setChosenTags] = useState<number[]>(artist.tags ?? []);

  const save = () => {
    const input: Parameters<typeof update.mutate>[0] = {};
    if (quality != null && quality !== artist.quality_profile_id)
      input.quality_profile_id = quality;
    if (metadata != null && metadata !== artist.metadata_profile_id)
      input.metadata_profile_id = metadata;
    if (newItems !== artist.monitor_new_items)
      input.monitor_new_items = newItems as "all" | "none" | "new";
    if (path.trim() && path.trim() !== artist.path) {
      input.path = path.trim();
      input.move_files = moveFiles;
    }
    const sameTags =
      chosenTags.length === (artist.tags ?? []).length &&
      chosenTags.every((tag) => (artist.tags ?? []).includes(tag));
    if (!sameTags) input.tags = chosenTags;
    update.mutate(input, { onSuccess: onClose });
  };

  const select = (
    label: string,
    value: number | null,
    choices: { id: number; name: string }[] | undefined,
    onChange: (id: number) => void,
  ) => (
    <>
      <Label className="mb-1.5 mt-3 text-xs text-muted-foreground">{label}</Label>
      <Select
        value={value != null ? String(value) : undefined}
        onValueChange={(v) => onChange(Number(v))}
      >
        <SelectTrigger className="w-full bg-secondary">
          <SelectValue placeholder={label} />
        </SelectTrigger>
        <SelectContent>
          {(choices ?? []).map((p) => (
            <SelectItem key={p.id} value={String(p.id)}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  return (
    <Sheet title={t("artist.editTitle", { name: artist.name })} onClose={onClose}>
      {select(t("add.qualityProfile"), quality, options?.quality_profiles, setQuality)}
      {select(t("add.metadataProfile"), metadata, options?.metadata_profiles, setMetadata)}
      <Label className="mb-1.5 mt-3 text-xs text-muted-foreground">
        {t("artist.newAlbums")}
      </Label>
      <Select value={newItems} onValueChange={setNewItems}>
        <SelectTrigger className="w-full bg-secondary">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("artist.newAlbums_all")}</SelectItem>
          <SelectItem value="new">{t("artist.newAlbums_new")}</SelectItem>
          <SelectItem value="none">{t("artist.newAlbums_none")}</SelectItem>
        </SelectContent>
      </Select>
      <Label htmlFor="artist-path" className="mb-1.5 mt-3 text-xs text-muted-foreground">
        {t("artist.path")}
      </Label>
      <Input
        id="artist-path"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        className="bg-secondary"
        spellCheck={false}
        autoCapitalize="off"
      />
      {path.trim() !== (artist.path ?? "") && path.trim() && (
        <label className="mt-2 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={moveFiles}
            onChange={(e) => setMoveFiles(e.target.checked)}
          />
          {t("artist.moveFiles")}
        </label>
      )}
      {(tags?.length ?? 0) > 0 && (
        <>
          <Label className="mb-1.5 mt-3 text-xs text-muted-foreground">
            {t("artist.tags")}
          </Label>
          <div className="flex flex-wrap gap-1.5">
            {(tags ?? []).map((tag) => {
              const on = chosenTags.includes(tag.id);
              return (
                <Button
                  key={tag.id}
                  size="sm"
                  variant={on ? "default" : "secondary"}
                  className="rounded-full"
                  aria-pressed={on}
                  onClick={() =>
                    setChosenTags(
                      on ? chosenTags.filter((x) => x !== tag.id) : [...chosenTags, tag.id],
                    )
                  }
                >
                  {tag.label}
                </Button>
              );
            })}
          </div>
        </>
      )}
      {update.isError && <ErrorNote>{(update.error as Error).message}</ErrorNote>}
      <div className="mt-5 flex gap-2">
        <Button variant="secondary" className="h-11 flex-1 rounded-xl" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button className="h-11 flex-1 rounded-xl" disabled={update.isPending} onClick={save}>
          {t("common.save")}
        </Button>
      </div>
    </Sheet>
  );
}
