import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import type { IndexerSchema } from "../../api/types";
import { Card, EmptyNote, ErrorNote, Row } from "../Blocks";
import { Sheet } from "../Sheet";
import { useRegisterSortButton } from "../subnav";
import { SortSheet } from "../SortSheet";
import { useSort } from "../sortable";
import {
  useAddIndexer,
  useIndexerSchemas,
  useIndexers,
  useTestIndexer,
  useTestNewIndexer,
  useToggleIndexer,
} from "../../hooks/queries";

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

export function Indexers() {
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
