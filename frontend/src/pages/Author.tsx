import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "../api/format";
import {
  Card,
  EmptyNote,
  ErrorNote,
  Row,
  SectionTitle,
  StateBadge,
} from "../components/Blocks";
import { DetailHeader } from "../components/detail";
import { useAuthor, useUpdateAuthor, useUpdateLibraryItem } from "../hooks/queries";

/** An author as Readarr keeps them: their whole bibliography including the
 * books the library hides because nobody monitors them — this is where one
 * of those gets monitored again — plus what to do about new books. */
export default function AuthorPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const authorId = Number(id);
  const navigate = useNavigate();
  const { data, error, isLoading } = useAuthor(authorId);
  const update = useUpdateAuthor(authorId);
  const updateBook = useUpdateLibraryItem("books");

  return (
    <>
      <DetailHeader title={data?.name} />
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && <Skeleton className="mb-4 h-40 w-full rounded-2xl" />}
      {data && (
        <>
          <div className="mb-4 flex gap-3">
            {data.poster && (
              <img
                src={data.poster}
                alt=""
                className="w-[72px] shrink-0 rounded-lg bg-secondary object-cover [aspect-ratio:2/3]"
              />
            )}
            <div className="min-w-0">
              <div className="line-clamp-5 text-xs leading-relaxed text-muted-foreground">
                {data.overview || t("add.noDescription")}
              </div>
              <div className="mt-1.5 text-xs text-muted-foreground">
                {t("author.have", { have: data.available_count, total: data.book_count })}
                {data.size_on_disk ? ` · ${formatBytes(data.size_on_disk)}` : ""}
              </div>
            </div>
          </div>

          <Card>
            <Row>
              <div className="min-w-0 flex-1 text-sm">{t("author.monitored")}</div>
              <Button
                size="sm"
                variant={data.monitored ? "default" : "secondary"}
                disabled={update.isPending}
                onClick={() => update.mutate({ monitored: !data.monitored })}
              >
                {data.monitored ? t("add.unmonitor") : t("add.monitor")}
              </Button>
            </Row>
            <Row>
              <div className="min-w-0 flex-1 text-sm">{t("author.newBooks")}</div>
              <Select
                value={data.monitor_new_items ?? "none"}
                onValueChange={(v) =>
                  update.mutate({ monitor_new_items: v as "all" | "none" | "new" })
                }
              >
                <SelectTrigger size="sm" className="w-auto bg-secondary">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("author.newBooks_all")}</SelectItem>
                  <SelectItem value="new">{t("author.newBooks_new")}</SelectItem>
                  <SelectItem value="none">{t("author.newBooks_none")}</SelectItem>
                </SelectContent>
              </Select>
            </Row>
          </Card>

          <SectionTitle>{t("author.books", { count: data.books?.length ?? 0 })}</SectionTitle>
          <Card>
            {(data.books ?? []).length === 0 && <EmptyNote>{t("manage.noMatches")}</EmptyNote>}
            {(data.books ?? []).map((book) => (
              <Row key={book.id} onClick={() => navigate(`/book/${book.id}`)}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {book.title}{" "}
                    <span className="text-muted-foreground">{book.year ?? ""}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {book.series_title ?? ""}
                  </div>
                </div>
                <StateBadge
                  state={
                    book.has_file ? "downloaded" : book.monitored ? "wanted" : "unmonitored"
                  }
                />
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={updateBook.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateBook.mutate({ id: book.id, monitored: !book.monitored });
                  }}
                >
                  {book.monitored ? t("add.unmonitor") : t("add.monitor")}
                </Button>
              </Row>
            ))}
          </Card>

          {(data.series ?? []).map((series) => (
            <div key={series.id}>
              <SectionTitle>
                {t("book.seriesTitle", { title: series.title ?? "" })}
              </SectionTitle>
              <Card>
                {(series.books ?? []).map((entry) => (
                  <Row key={entry.book_id} onClick={() => navigate(`/book/${entry.book_id}`)}>
                    <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                      {entry.position ? `#${entry.position}` : ""}
                    </span>
                    <div className="min-w-0 flex-1 truncate text-sm">{entry.title}</div>
                    <StateBadge
                      state={
                        entry.has_file
                          ? "downloaded"
                          : entry.monitored
                            ? "wanted"
                            : "unmonitored"
                      }
                    />
                  </Row>
                ))}
              </Card>
            </div>
          ))}
        </>
      )}
    </>
  );
}
