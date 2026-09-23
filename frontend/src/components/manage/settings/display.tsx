// Settings → Display: how each library is shown on this device. The sort sheet
// changes the same layout preference; this is where every tab's is in one place.
import { Bell, ChevronDown, ChevronRight, ChevronUp, Eye, EyeOff } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { LibraryKind } from "../../../api/types";
import {
  type ConfirmPolicy,
  type DateStyle,
  LAYOUTS_FOR,
  type SizeStyle,
  type Spoilers,
  setPref,
  type Unmonitored,
  usePref,
} from "../../../lib/prefs";
import { arrangeTabs, tabsFor } from "../../../tabs";
import { Card, Row, SectionTitle } from "../../Blocks";

const KINDS: { kind: LibraryKind; service: string; label: string }[] = [
  { kind: "books", service: "readarr", label: "nav.books" },
  { kind: "movies", service: "radarr", label: "nav.movies" },
  { kind: "series", service: "sonarr", label: "nav.shows" },
];
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
          options={LAYOUTS_FOR[kind]}
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

/** Start tab, order and which tabs show. Order is moved one step at a time:
 * dragging in a settings list on a phone fights the page scroll. */
function TabPrefs({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const order = usePref("tabOrder");
  const hidden = usePref("hiddenTabs");
  const start = usePref("startTab");
  const all = tabsFor(configured);
  const arranged = arrangeTabs(all, order, []);
  const move = (index: number, by: number) => {
    const next = arranged.map((tab) => tab.to);
    const [tab] = next.splice(index, 1);
    next.splice(index + by, 0, tab);
    setPref("tabOrder", next);
  };
  const visible = arranged.filter((tab) => !hidden.includes(tab.to));
  return (
    <>
      <SectionTitle>{t("display.tabs")}</SectionTitle>
      <Card>
        <Choice
          label={t("display.startTab")}
          value={start || "first"}
          options={["first", ...visible.map((tab) => tab.to)]}
          optionLabel={(o) =>
            o === "first" ? t("display.firstTab") : t(all.find((tab) => tab.to === o)?.key ?? o)
          }
          onChange={(v) => setPref("startTab", v === "first" ? "" : v)}
        />
        {arranged.map((tab, i) => {
          const shown = !hidden.includes(tab.to);
          const locked = tab.to === "/settings";
          return (
            <Row key={tab.to}>
              <tab.icon className="size-5 shrink-0 text-muted-foreground" />
              <span className={cn("min-w-0 flex-1 text-sm", !shown && "text-muted-foreground")}>
                {t(tab.key)}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("display.moveUp", { tab: t(tab.key) })}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ChevronUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("display.moveDown", { tab: t(tab.key) })}
                disabled={i === arranged.length - 1}
                onClick={() => move(i, 1)}
              >
                <ChevronDown />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={
                  shown
                    ? t("display.hideTab", { tab: t(tab.key) })
                    : t("display.showTab", { tab: t(tab.key) })
                }
                aria-pressed={!shown}
                disabled={locked}
                onClick={() =>
                  setPref(
                    "hiddenTabs",
                    shown ? [...hidden, tab.to] : hidden.filter((h) => h !== tab.to),
                  )
                }
              >
                {shown ? <Eye /> : <EyeOff />}
              </Button>
            </Row>
          );
        })}
      </Card>
    </>
  );
}

function BehaviourPrefs() {
  const { t } = useTranslation();
  const dates = usePref("dates");
  const sizes = usePref("sizes");
  const spoilers = usePref("spoilers");
  const confirm = usePref("confirm");
  return (
    <>
      <SectionTitle>{t("display.formatting")}</SectionTitle>
      <Card>
        <Choice<DateStyle>
          label={t("display.dates")}
          value={dates}
          options={["relative", "absolute"]}
          optionLabel={(o) => t(`display.dates_${o}`)}
          onChange={(v) => setPref("dates", v)}
        />
        <Choice<SizeStyle>
          label={t("display.sizes")}
          value={sizes}
          options={["binary", "decimal"]}
          optionLabel={(o) => t(`display.sizes_${o}`)}
          onChange={(v) => setPref("sizes", v)}
        />
      </Card>
      <SectionTitle>{t("display.behaviour")}</SectionTitle>
      <Card>
        <Choice<Spoilers>
          label={t("display.spoilers")}
          value={spoilers}
          options={["off", "unwatched", "always"]}
          optionLabel={(o) => t(`display.spoilers_${o}`)}
          onChange={(v) => setPref("spoilers", v)}
        />
        <Choice<ConfirmPolicy>
          label={t("display.confirm")}
          value={confirm}
          options={["always", "deletes", "never"]}
          optionLabel={(o) => t(`display.confirm_${o}`)}
          onChange={(v) => setPref("confirm", v)}
        />
      </Card>
      <p className="mx-1 mb-2 mt-1 text-xs text-muted-foreground">
        {t("display.behaviourHint")}
      </p>
    </>
  );
}

export function DisplaySettings({ configured }: { configured: Set<string> }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <>
      <TabPrefs configured={configured} />
      {KINDS.filter((k) => configured.has(k.service)).map((k) => (
        <LibraryPrefs key={k.kind} kind={k.kind} label={k.label} />
      ))}
      <BehaviourPrefs />
      <Card>
        <Row onClick={() => navigate("/settings/notifications")}>
          <Bell className="size-5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-sm font-medium">
            {t("display.notifications")}
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </Row>
      </Card>
      <p className="mx-1 mb-6 mt-2 text-xs text-muted-foreground">{t("display.hint")}</p>
    </>
  );
}
