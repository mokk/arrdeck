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
import { api } from "../api/client";
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
import {
  useRegisterSearchbar,
  useRegisterSortButton,
  useRegisterSubnav,
} from "../components/subnav";
import { SortSheet } from "../components/SortSheet";
import { VirtualList } from "../components/VirtualList";
import { useSort } from "../components/sortable";
import {
  useAddIndexer,
  useBulkDeleteLibrary,
  useBulkLibrary,
  useBulkSearchLibrary,
  useDeleteLibraryItem,
  useIndexerSchemas,
  useIndexers,
  useLibraryMovies,
  useLibrarySeries,
  useOptions,
  useImportSettings,
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

function SettingsTransfer() {
  const { t } = useTranslation();
  const importSettings = useImportSettings();

  const doExport = async () => {
    const data = await api.get<{ services: Record<string, unknown> }>("/settings/export");
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "arrdeck-settings.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const doImport = (file: File) => {
    file.text().then((text) => {
      const parsed = JSON.parse(text);
      importSettings.mutate(parsed.services ?? parsed);
    });
  };

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2 p-4">
        <Button variant="secondary" size="sm" onClick={doExport}>
          {t("manage.export")}
        </Button>
        <Button variant="secondary" size="sm" asChild disabled={importSettings.isPending}>
          <label className="cursor-pointer">
            {t("manage.import")}
            <input
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) doImport(f);
                e.target.value = "";
              }}
            />
          </label>
        </Button>
      </div>
    </Card>
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
      <SettingsTransfer />
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
  const [sortOpen, setSortOpen] = useState(false);
  const sort = useSort<Record<string, unknown>>("manage.indexers", "name");
  useRegisterSortButton(() => setSortOpen(true));

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
      <div className="mb-4 flex items-center">
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
      {sortOpen && (
        <SortSheet
          options={INDEXER_SORT_KEYS.map((key) => ({ key, label: t(`manage.sort.${key}`) }))}
          sort={sort}
          onClose={() => setSortOpen(false)}
        />
      )}
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

function LibraryBulkBar({
  kind,
  selected,
  options,
  onDone,
}: {
  kind: "movies" | "series";
  selected: Set<number>;
  options: Options | undefined;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const bulk = useBulkLibrary(kind);
  const bulkDelete = useBulkDeleteLibrary(kind);
  const bulkSearch = useBulkSearchLibrary(kind);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const ids = [...selected];
  const pending = bulk.isPending || bulkDelete.isPending || bulkSearch.isPending;

  return (
    <div className="fixed bottom-[calc(7.4rem+env(safe-area-inset-bottom))] left-1/2 z-40 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-2xl border border-white/10 bg-card/90 px-3 py-2 shadow-2xl shadow-black/60 backdrop-blur-xl">
      <span className="px-1 text-xs text-muted-foreground">
        {t("dl.selected", { count: ids.length })}
      </span>
      {confirmingDelete ? (
        <>
          <Button
            size="sm"
            variant="destructive"
            disabled={pending}
            onClick={() => bulkDelete.mutate({ ids, delete_files: true }, { onSettled: onDone })}
          >
            {t("manage.plusFiles")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="text-destructive"
            disabled={pending}
            onClick={() => bulkDelete.mutate({ ids, delete_files: false }, { onSettled: onDone })}
          >
            {t("manage.entryOnly")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(false)}>
            ✕
          </Button>
        </>
      ) : (
        <>
          <ProfileSelect
            value={null}
            options={options}
            disabled={pending || !ids.length}
            onChange={(pid) => bulk.mutate({ ids, quality_profile_id: pid }, { onSettled: onDone })}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !ids.length}
            onClick={() => bulk.mutate({ ids, monitored: true }, { onSettled: onDone })}
          >
            {t("add.monitor")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !ids.length}
            onClick={() => bulk.mutate({ ids, monitored: false }, { onSettled: onDone })}
          >
            {t("add.unmonitor")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending || !ids.length}
            onClick={() => {
              bulkSearch.mutate(ids);
              onDone();
            }}
          >
            {t("common.search")}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="text-destructive"
            disabled={!ids.length}
            onClick={() => setConfirmingDelete(true)}
          >
            {t("common.delete")}
          </Button>
        </>
      )}
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
  const [sortOpen, setSortOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  useRegisterSearchbar(t("manage.filterMovies"), q, setQ);
  useRegisterSortButton(() => setSortOpen(true));

  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;

  const toggleChecked = (id: number) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };

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
      <div className="mb-3 flex justify-end">
        <Button
          size="sm"
          variant={selectMode ? "default" : "secondary"}
          className="rounded-full"
          onClick={() => {
            setSelectMode(!selectMode);
            setChecked(new Set());
          }}
        >
          {selectMode ? t("dl.done") : t("dl.select")}
        </Button>
      </div>
      <Card>
        <VirtualList
          items={shown}
          estimateSize={96}
          renderRow={(m) => (
            <Row
              className="border-b border-t-0 border-border/60"
              onClick={selectMode ? () => toggleChecked(m.id) : undefined}
            >
              {selectMode && (
                <div
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] text-white",
                    checked.has(m.id) ? "border-primary bg-primary" : "border-muted-foreground/50",
                  )}
                >
                  {checked.has(m.id) ? "✓" : ""}
                </div>
              )}
              {m.poster ? (
                <img
                  src={m.poster}
                  alt=""
                  loading="lazy"
                  className="w-10 shrink-0 rounded-md bg-secondary object-cover [aspect-ratio:2/3]"
                />
              ) : (
                <div className="w-10 shrink-0 rounded-md bg-secondary [aspect-ratio:2/3]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">
                  {m.title} <span className="text-muted-foreground">{m.year ?? ""}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <StateBadge state={m.status} />
                  {formatBytes(m.size_on_disk)}
                </div>
                {!selectMode && (
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
                )}
              </div>
            </Row>
          )}
        />
        {shown.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
      </Card>
      {selectMode && (
        <LibraryBulkBar
          kind="movies"
          selected={checked}
          options={options}
          onDone={() => {
            setChecked(new Set());
            setSelectMode(false);
          }}
        />
      )}
      {sortOpen && (
        <SortSheet
          options={MOVIE_SORT_KEYS.map((key) => ({ key, label: t(`manage.sort.${key}`) }))}
          sort={sort}
          onClose={() => setSortOpen(false)}
        />
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
  const [sortOpen, setSortOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  useRegisterSearchbar(t("manage.filterSeries"), q, setQ);
  useRegisterSortButton(() => setSortOpen(true));

  if (error) return <ErrorNote>{(error as Error).message}</ErrorNote>;

  const toggleChecked = (id: number) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };

  const filtered = (data ?? []).filter((se) =>
    (se.title ?? "").toLowerCase().includes(q.toLowerCase()),
  );
  const shown = sort.sortRows(
    filtered as unknown as Record<string, unknown>[],
  ) as unknown as LibrarySeries[];

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button
          size="sm"
          variant={selectMode ? "default" : "secondary"}
          className="rounded-full"
          onClick={() => {
            setSelectMode(!selectMode);
            setChecked(new Set());
          }}
        >
          {selectMode ? t("dl.done") : t("dl.select")}
        </Button>
      </div>
      <Card>
        <VirtualList
          items={shown}
          estimateSize={96}
          renderRow={(se) => (
            <Row
              className="border-b border-t-0 border-border/60"
              onClick={selectMode ? () => toggleChecked(se.id) : undefined}
            >
              {selectMode && (
                <div
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-[10px] text-white",
                    checked.has(se.id)
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/50",
                  )}
                >
                  {checked.has(se.id) ? "✓" : ""}
                </div>
              )}
              {se.poster ? (
                <img
                  src={se.poster}
                  alt=""
                  loading="lazy"
                  className="w-10 shrink-0 cursor-pointer rounded-md bg-secondary object-cover [aspect-ratio:2/3]"
                  onClick={selectMode ? undefined : () => navigate(`/series/${se.id}`)}
                />
              ) : (
                <div className="w-10 shrink-0 rounded-md bg-secondary [aspect-ratio:2/3]" />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={cn("truncate text-sm font-medium", !selectMode && "cursor-pointer active:opacity-70")}
                  onClick={selectMode ? undefined : () => navigate(`/series/${se.id}`)}
                >
                  {se.title} <span className="text-muted-foreground">{se.year ?? ""}</span>{" "}
                  {!selectMode && <span className="text-primary">›</span>}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <StateBadge state={se.monitored ? "ok" : "paused"} />
                  {t("manage.episodes", {
                    files: se.episode_file_count,
                    total: se.episode_count,
                  })}{" "}
                  · {formatBytes(se.size_on_disk)}
                </div>
                {!selectMode && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <ProfileSelect
                      value={se.quality_profile_id}
                      options={options}
                      disabled={update.isPending}
                      onChange={(id) => update.mutate({ id: se.id, quality_profile_id: id })}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: se.id, monitored: !se.monitored })}
                    >
                      {se.monitored ? t("add.unmonitor") : t("add.monitor")}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={search.isPending}
                      onClick={() => search.mutate({ app: "sonarr", id: se.id })}
                    >
                      {t("common.search")}
                    </Button>
                    <DeleteButtons
                      pending={remove.isPending}
                      onDelete={(deleteFiles) => remove.mutate({ id: se.id, deleteFiles })}
                    />
                  </div>
                )}
              </div>
            </Row>
          )}
        />
        {shown.length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
      </Card>
      {selectMode && (
        <LibraryBulkBar
          kind="series"
          selected={checked}
          options={options}
          onDone={() => {
            setChecked(new Set());
            setSelectMode(false);
          }}
        />
      )}
      {sortOpen && (
        <SortSheet
          options={SERIES_SORT_KEYS.map((key) => ({ key, label: t(`manage.sort.${key}`) }))}
          sort={sort}
          onClose={() => setSortOpen(false)}
        />
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
