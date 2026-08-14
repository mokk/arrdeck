import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import { SERVICE_LABELS, formatBytes } from "../api/format";
import i18n, { LANGUAGES, setLanguage } from "../i18n";
import type {
  IndexerSchema,
  LibraryMovie,
  LibrarySeries,
  Options,
  ServiceSettings,
} from "../api/types";
import {
  Card,
  EmptyNote,
  ErrorNote,
  Row,
  StateBadge,
} from "../components/Blocks";
import { Sheet } from "../components/Sheet";
import { useRegisterSubnav } from "../components/subnav";
import { SortBar, useSort } from "../components/sortable";
import {
  useAddIndexer,
  useDeleteLibraryItem,
  useIndexerSchemas,
  useIndexers,
  useLibraryMovies,
  useLibrarySeries,
  useOptions,
  useSaveServiceSettings,
  useServiceSettings,
  useServices,
  useStatus,
  useTestIndexer,
  useTestNewIndexer,
  useTestService,
  useToggleIndexer,
  useTriggerSearch,
  useUpdateLibraryItem,
} from "../hooks/queries";
import { usePersistentState } from "../hooks/usePersistentState";

/* ---------------- services (connection settings) ---------------- */

const SERVICE_FIELDS: Record<string, ("url" | "api_key" | "username" | "password")[]> = {
  radarr: ["url", "api_key"],
  sonarr: ["url", "api_key"],
  prowlarr: ["url", "api_key"],
  overseerr: ["url", "api_key"],
  qbittorrent: ["url", "username", "password"],
  transmission: ["url"],
};

const FIELD_KEYS: Record<string, string> = {
  url: "manage.url",
  api_key: "manage.apiKey",
  username: "manage.usernameOptional",
  password: "manage.passwordOptional",
};

function ServiceSettingsCard({ name, initial }: { name: string; initial: ServiceSettings }) {
  const { t } = useTranslation();
  const save = useSaveServiceSettings();
  const test = useTestService();
  const [form, setForm] = useState({
    url: initial.url,
    api_key: initial.api_key,
    username: initial.username,
    password: initial.password,
  });
  const [result, setResult] = useState<string | null>(null);
  const dirty =
    form.url !== initial.url ||
    form.api_key !== initial.api_key ||
    form.username !== initial.username ||
    form.password !== initial.password;

  return (
    <Card>
      <div className="flex flex-col gap-2.5 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{SERVICE_LABELS[name] ?? name}</span>
          <Badge
            variant="secondary"
            className={cn(
              "px-2 py-0 text-[0.68rem]",
              initial.configured ? "text-success" : "text-muted-foreground",
            )}
          >
            {initial.configured ? t("manage.configured") : t("manage.notConfigured")}
          </Badge>
          {result && (
            <span
              className={cn(
                "text-xs",
                result.startsWith("ok") ? "text-success" : "text-destructive",
              )}
            >
              {result}
            </span>
          )}
        </div>
        {SERVICE_FIELDS[name].map((field) => (
          <div key={field}>
            <Label className="mb-1 text-xs text-muted-foreground">{t(FIELD_KEYS[field])}</Label>
            <Input
              value={form[field]}
              placeholder={field === "url" ? t("manage.urlPlaceholder") : ""}
              onChange={(e) => setForm({ ...form, [field]: e.target.value })}
            />
          </div>
        ))}
        <div className="flex gap-2">
          <Button
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(
                { service: name, ...form },
                {
                  onSuccess: (r) =>
                    setResult(r.configured ? t("manage.savedOk") : t("manage.savedDisabled")),
                  onError: (e) => setResult(`error: ${(e as Error).message}`),
                },
              )
            }
          >
            {save.isPending ? t("common.saving") : t("common.save")}
          </Button>
          <Button
            variant="secondary"
            disabled={test.isPending || dirty}
            title={dirty ? t("manage.saveFirst") : t("manage.testSaved")}
            onClick={() =>
              test.mutate(name, {
                onSuccess: (r) => setResult(`ok: v${r.version}`),
                onError: (e) => setResult(`error: ${(e as Error).message}`),
              })
            }
          >
            {test.isPending ? t("common.testing") : t("common.test")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function LanguagePicker() {
  const { t } = useTranslation();
  return (
    <Card>
      <div className="flex items-center justify-between p-4">
        <span className="font-semibold">{t("common.language")}</span>
        <Select value={i18n.language} onValueChange={setLanguage}>
          <SelectTrigger size="sm" className="w-auto bg-secondary">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((l) => (
              <SelectItem key={l.code} value={l.code}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}

function StatusStrip() {
  const { t } = useTranslation();
  const { data } = useStatus();
  if (!data?.length) return null;
  return (
    <div className="mb-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
      {data.map((s) => (
        <div
          key={s.service}
          className={cn(
            "flex shrink-0 items-center gap-2 rounded-full bg-card px-3.5 py-2 text-xs font-semibold",
            !s.ok && "text-destructive",
          )}
        >
          <span className={cn("size-2 rounded-full", s.ok ? "bg-success" : "bg-destructive")} />
          {SERVICE_LABELS[s.service] ?? s.service}
          <span className="font-normal text-muted-foreground">
            {s.ok ? s.version : t("manage.offlineShort")}
          </span>
        </div>
      ))}
    </div>
  );
}

function ServiceSettingsTab() {
  const { t } = useTranslation();
  const { data, error } = useServiceSettings();
  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;
  if (!data) return <EmptyNote>{t("common.loading")}</EmptyNote>;
  return (
    <>
      <StatusStrip />
      <LanguagePicker />
      {Object.entries(data).map(([name, conf]) => (
        <ServiceSettingsCard
          key={`${name}-${conf.url}-${conf.api_key}`}
          name={name}
          initial={conf}
        />
      ))}
    </>
  );
}

/* ---------------- indexers ---------------- */

const INDEXER_SORT_KEYS = ["name", "protocol", "privacy", "enable"];

function AddIndexerSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { data: schemas, isLoading, error } = useIndexerSchemas(true);
  const [filter, setFilter] = useState("");
  const [schema, setSchema] = useState<IndexerSchema | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [note, setNote] = useState<string | null>(null);
  const addIndexer = useAddIndexer();
  const testNew = useTestNewIndexer();
  const pending = addIndexer.isPending || testNew.isPending;

  const body = schema && {
    schema_name: schema.name,
    display_name: displayName,
    field_values: values,
  };

  if (!schema) {
    const shown = (schemas ?? [])
      .filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()))
      .slice(0, 60);
    return (
      <Sheet title={t("manage.addIndexerTitle")} subtitle={t("manage.pickDefinition")} onClose={onClose}>
        <Input
          placeholder={t("manage.searchIndexers")}
          value={filter}
          autoFocus
          onChange={(e) => setFilter(e.target.value)}
          className="mb-3"
        />
        {isLoading && <EmptyNote>{t("manage.loadingDefinitions")}</EmptyNote>}
        {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
        {shown.map((s) => (
          <div
            key={s.name}
            className="cursor-pointer border-t border-border py-2.5 first:border-t-0 active:opacity-70"
            onClick={() => {
              setSchema(s);
              setDisplayName(s.name);
              setValues({});
            }}
          >
            <div className="text-sm font-medium">{s.name}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {s.privacy} · {s.protocol}
            </div>
          </div>
        ))}
        {schemas && shown.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
      </Sheet>
    );
  }

  return (
    <Sheet
      title={t("manage.addNamed", { name: schema.name })}
      subtitle={schema.description ?? undefined}
      onClose={onClose}
    >
      <Label className="mb-1 text-xs text-muted-foreground">{t("manage.name")}</Label>
      <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      {schema.fields.map((f) => {
        const current = f.name in values ? values[f.name] : f.value;
        if (f.type === "checkbox") {
          return (
            <div key={f.name} className="mt-3">
              <Button
                variant={current ? "default" : "secondary"}
                size="sm"
                onClick={() => setValues({ ...values, [f.name]: !current })}
              >
                {f.label}: {current ? "on" : "off"}
              </Button>
            </div>
          );
        }
        if (f.type === "select") {
          return (
            <div key={f.name} className="mt-3">
              <Label className="mb-1 text-xs text-muted-foreground">{f.label}</Label>
              <Select
                value={String(current ?? "")}
                onValueChange={(v) => setValues({ ...values, [f.name]: Number(v) })}
              >
                <SelectTrigger className="w-full bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {f.select_options.map((o) => (
                    <SelectItem key={String(o.value)} value={String(o.value)}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        }
        return (
          <div key={f.name} className="mt-3">
            <Label className="mb-1 text-xs text-muted-foreground" title={f.help_text ?? undefined}>
              {f.label}
            </Label>
            <Input
              value={String(current ?? "")}
              placeholder={f.help_text ?? ""}
              onChange={(e) =>
                setValues({
                  ...values,
                  [f.name]: f.type === "number" ? Number(e.target.value) : e.target.value,
                })
              }
            />
          </div>
        );
      })}
      {note && (
        <div
          className={cn(
            "py-2 text-sm",
            note.startsWith("ok") ? "text-success" : "text-destructive",
          )}
        >
          {note}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={() => setSchema(null)}>
          {t("common.back")}
        </Button>
        <Button
          variant="secondary"
          className="flex-1"
          disabled={pending}
          onClick={() =>
            testNew.mutate(body!, {
              onSuccess: () => setNote(t("manage.testPassed")),
              onError: (e) => setNote((e as Error).message),
            })
          }
        >
          {testNew.isPending ? t("common.testing") : t("common.test")}
        </Button>
        <Button
          className="flex-1"
          disabled={pending}
          onClick={() =>
            addIndexer.mutate(body!, {
              onSuccess: onClose,
              onError: (e) => setNote((e as Error).message),
            })
          }
        >
          {addIndexer.isPending ? t("add.adding") : t("nav.add")}
        </Button>
      </div>
    </Sheet>
  );
}

function Indexers() {
  const { t } = useTranslation();
  const { data, error } = useIndexers();
  const toggle = useToggleIndexer();
  const test = useTestIndexer();
  const [tested, setTested] = useState<Record<number, "ok" | "fail">>({});
  const [adding, setAdding] = useState(false);
  const sort = useSort<Record<string, unknown>>("manage.indexers", "name");

  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;
  const rows = sort.sortRows((data ?? []) as unknown as Record<string, unknown>[]) as unknown as {
    id: number;
    name: string;
    protocol: string;
    privacy: string;
    enable: boolean;
  }[];

  return (
    <>
      <div className="mb-4 flex items-center gap-2">
        <SortBar
          options={INDEXER_SORT_KEYS.map((key) => ({ key, label: t(`manage.sort.${key}`) }))}
          sort={sort}
        />
        <Button size="sm" className="ml-auto rounded-full" onClick={() => setAdding(true)}>
          {t("manage.addIndexer")}
        </Button>
      </div>
      <Card>
        {rows.map((i) => (
          <Row key={i.id}>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{i.name}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Badge
                  variant="secondary"
                  className={cn(
                    "px-2 py-0 text-[0.68rem]",
                    i.enable ? "text-success" : "text-muted-foreground",
                  )}
                >
                  {i.enable ? t("manage.enabled") : t("manage.disabled")}
                </Badge>
                {i.protocol} · {i.privacy}
                {tested[i.id] && (
                  <Badge
                    variant="secondary"
                    className={cn(
                      "px-2 py-0 text-[0.68rem]",
                      tested[i.id] === "ok" ? "text-success" : "text-destructive",
                    )}
                  >
                    {t("manage.testResult", { result: tested[i.id] })}
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                disabled={toggle.isPending}
                onClick={() => toggle.mutate({ id: i.id, enable: !i.enable })}
              >
                {i.enable ? t("manage.disable") : t("manage.enable")}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={test.isPending}
                onClick={() =>
                  test.mutate(i.id, {
                    onSuccess: () => setTested((m) => ({ ...m, [i.id]: "ok" })),
                    onError: () => setTested((m) => ({ ...m, [i.id]: "fail" })),
                  })
                }
              >
                {t("common.test")}
              </Button>
            </div>
          </Row>
        ))}
      </Card>
      {adding && <AddIndexerSheet onClose={() => setAdding(false)} />}
    </>
  );
}

/* ---------------- libraries ---------------- */

function ProfileSelect({
  value,
  options,
  disabled,
  onChange,
}: {
  value: number | null | undefined;
  options: Options | undefined;
  disabled: boolean;
  onChange: (id: number) => void;
}) {
  return (
    <Select
      value={value != null ? String(value) : undefined}
      disabled={disabled || !options}
      onValueChange={(v) => onChange(Number(v))}
    >
      <SelectTrigger size="sm" className="w-auto bg-secondary">
        <SelectValue placeholder="Profile" />
      </SelectTrigger>
      <SelectContent>
        {(options?.quality_profiles ?? []).map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DeleteButtons({
  pending,
  onDelete,
}: {
  pending: boolean;
  onDelete: (deleteFiles: boolean) => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  if (!confirming)
    return (
      <Button
        variant="secondary"
        size="sm"
        className="text-destructive"
        onClick={() => setConfirming(true)}
      >
        {t("common.delete")}
      </Button>
    );
  return (
    <div className="flex gap-1.5">
      <Button variant="destructive" size="sm" disabled={pending} onClick={() => onDelete(true)}>
        {t("manage.plusFiles")}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className="text-destructive"
        disabled={pending}
        onClick={() => onDelete(false)}
      >
        {t("manage.entryOnly")}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
        ✕
      </Button>
    </div>
  );
}

const MOVIE_SORT_KEYS = ["title", "year", "status", "size_on_disk"];

function MovieLibrary() {
  const { t } = useTranslation();
  const { data, error } = useLibraryMovies();
  const { data: options } = useOptions("radarr");
  const search = useTriggerSearch();
  const update = useUpdateLibraryItem("movies");
  const remove = useDeleteLibraryItem("movies");
  const [q, setQ] = usePersistentState("manage.movies.filter", "");
  const sort = useSort<Record<string, unknown>>("manage.movies", "title");

  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;

  const withStatus = (data ?? [])
    .filter((m) => (m.title ?? "").toLowerCase().includes(q.toLowerCase()))
    .map((m) => ({
      ...m,
      status: m.has_file ? "downloaded" : m.monitored ? "wanted" : "unmonitored",
    }));
  const shown = sort.sortRows(
    withStatus as unknown as Record<string, unknown>[],
  ) as unknown as (LibraryMovie & { status: string })[];

  return (
    <>
      <div className="mb-3">
        <Input
          placeholder={t("manage.filterMovies")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="mb-4">
        <SortBar
          options={MOVIE_SORT_KEYS.map((key) => ({ key, label: t(`manage.sort.${key}`) }))}
          sort={sort}
        />
      </div>
      <Card>
        {shown.slice(0, 100).map((m) => (
          <Row key={m.id}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">
                {m.title} <span className="text-muted-foreground">{m.year ?? ""}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={m.status} />
                {formatBytes(m.size_on_disk)}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <ProfileSelect
                  value={m.quality_profile_id}
                  options={options}
                  disabled={update.isPending}
                  onChange={(id) => update.mutate({ id: m.id, quality_profile_id: id })}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: m.id, monitored: !m.monitored })}
                >
                  {m.monitored ? t("add.unmonitor") : t("add.monitor")}
                </Button>
                {!m.has_file && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={search.isPending}
                    onClick={() => search.mutate({ app: "radarr", id: m.id })}
                  >
                    {t("common.search")}
                  </Button>
                )}
                <DeleteButtons
                  pending={remove.isPending}
                  onDelete={(deleteFiles) => remove.mutate({ id: m.id, deleteFiles })}
                />
              </div>
            </div>
          </Row>
        ))}
      </Card>
      {shown.length > 100 && (
        <div className="mt-2 text-center text-xs text-muted-foreground">
          {t("manage.showingFirst", { shown: 100, total: shown.length })}
        </div>
      )}
    </>
  );
}

const SERIES_SORT_KEYS = ["title", "year", "status", "episode_file_count", "size_on_disk"];

function SeriesLibrary() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, error } = useLibrarySeries();
  const { data: options } = useOptions("sonarr");
  const search = useTriggerSearch();
  const update = useUpdateLibraryItem("series");
  const remove = useDeleteLibraryItem("series");
  const [q, setQ] = usePersistentState("manage.series.filter", "");
  const sort = useSort<Record<string, unknown>>("manage.series", "title");

  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;

  const filtered = (data ?? []).filter((s) =>
    (s.title ?? "").toLowerCase().includes(q.toLowerCase()),
  );
  const shown = sort.sortRows(
    filtered as unknown as Record<string, unknown>[],
  ) as unknown as LibrarySeries[];

  return (
    <>
      <div className="mb-3">
        <Input
          placeholder={t("manage.filterSeries")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="mb-4">
        <SortBar
          options={SERIES_SORT_KEYS.map((key) => ({ key, label: t(`manage.sort.${key}`) }))}
          sort={sort}
        />
      </div>
      <Card>
        {shown.slice(0, 100).map((s) => (
          <Row key={s.id}>
            <div className="min-w-0 flex-1">
              <div
                className="cursor-pointer truncate text-sm font-medium active:opacity-70"
                onClick={() => navigate(`/series/${s.id}`)}
              >
                {s.title} <span className="text-muted-foreground">{s.year ?? ""}</span>{" "}
                <span className="text-primary">›</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <StateBadge state={s.monitored ? "ok" : "paused"} />
                {t("manage.episodes", { files: s.episode_file_count, total: s.episode_count })} ·{" "}
                {formatBytes(s.size_on_disk)}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <ProfileSelect
                  value={s.quality_profile_id}
                  options={options}
                  disabled={update.isPending}
                  onChange={(id) => update.mutate({ id: s.id, quality_profile_id: id })}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={update.isPending}
                  onClick={() => update.mutate({ id: s.id, monitored: !s.monitored })}
                >
                  {s.monitored ? t("add.unmonitor") : t("add.monitor")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={search.isPending}
                  onClick={() => search.mutate({ app: "sonarr", id: s.id })}
                >
                  {t("common.search")}
                </Button>
                <DeleteButtons
                  pending={remove.isPending}
                  onDelete={(deleteFiles) => remove.mutate({ id: s.id, deleteFiles })}
                />
              </div>
            </div>
          </Row>
        ))}
      </Card>
      {shown.length > 100 && (
        <div className="mt-2 text-center text-xs text-muted-foreground">
          {t("manage.showingFirst", { shown: 100, total: shown.length })}
        </div>
      )}
    </>
  );
}

/* ---------------- page ---------------- */

type Tab = "movies" | "series" | "indexers" | "services";

export default function Manage() {
  const { t } = useTranslation();
  const { data: services } = useServices();
  const configured = new Set(
    (services ?? []).filter((s) => s.configured).map((s) => s.service as string),
  );
  const tabs: { value: Tab; label: string }[] = [
    ...(configured.has("radarr") ? [{ value: "movies" as Tab, label: t("manage.movies") }] : []),
    ...(configured.has("sonarr") ? [{ value: "series" as Tab, label: t("manage.series") }] : []),
    ...(configured.has("prowlarr")
      ? [{ value: "indexers" as Tab, label: t("manage.indexers") }]
      : []),
    // services (connection settings) deliberately last
    { value: "services" as Tab, label: t("manage.services") },
  ];

  const [storedTab, setTab] = usePersistentState<Tab>("manage.tab", "movies");
  const tab = tabs.some((t) => t.value === storedTab) ? storedTab : tabs[0].value;
  useRegisterSubnav(tabs, tab, (v) => setTab(v as Tab));

  return (
    <>
      {tab === "movies" && <MovieLibrary />}
      {tab === "series" && <SeriesLibrary />}
      {tab === "indexers" && <Indexers />}
      {tab === "services" && <ServiceSettingsTab />}
    </>
  );
}
