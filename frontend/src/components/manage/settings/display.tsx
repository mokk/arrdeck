// Settings → Display: how each library is shown on this device. The sort sheet
// changes the same layout preference; this is where every tab's is in one place.
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LibraryKind } from "../../../api/types";
import { type Layout, setPref, type Unmonitored, usePref } from "../../../lib/prefs";
import { Card, Row, SectionTitle } from "../../Blocks";

const KINDS: { kind: LibraryKind; service: string; label: string }[] = [
  { kind: "books", service: "readarr", label: "nav.books" },
  { kind: "movies", service: "radarr", label: "nav.movies" },
  { kind: "series", service: "sonarr", label: "nav.shows" },
];
const LAYOUTS: Layout[] = ["posters", "list", "details"];
const UNMONITORED: Unmonitored[] = ["show", "dim", "hide"];

function Choice<T extends string>({
  label,
  value,
  options,
  optionLabel,
  onChange,
}: {
  label: ReactNode;
  value: T;
  options: T[];
  optionLabel: (option: T) => string;
  onChange: (value: T) => void;
}) {
  return (
    <Row>
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      <Select value={value} onValueChange={(v) => onChange(v as T)}>
        <SelectTrigger size="sm" className="w-auto bg-secondary">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {optionLabel(o)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

function LibraryPrefs({ kind, label }: { kind: LibraryKind; label: string }) {
  const { t } = useTranslation();
  const layout = usePref(`layout.${kind}`);
  const unmonitored = usePref(`unmonitored.${kind}`);
  return (
    <>
      <SectionTitle>{t(label)}</SectionTitle>
      <Card>
        <Choice
          label={t("display.layout")}
          value={layout}
          options={LAYOUTS}
          optionLabel={(o) => t(`library.layout.${o}`)}
          onChange={(v) => setPref(`layout.${kind}`, v)}
        />
        <Choice
          label={t("display.unmonitored")}
          value={unmonitored}
          options={UNMONITORED}
          optionLabel={(o) => t(`display.unmonitored_${o}`)}
          onChange={(v) => setPref(`unmonitored.${kind}`, v)}
        />
      </Card>
    </>
  );
}

export function DisplaySettings({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  return (
    <>
      {KINDS.filter((k) => configured.has(k.service)).map((k) => (
        <LibraryPrefs key={k.kind} kind={k.kind} label={k.label} />
      ))}
      <p className="mx-1 mb-6 mt-2 text-xs text-muted-foreground">{t("display.hint")}</p>
    </>
  );
}
