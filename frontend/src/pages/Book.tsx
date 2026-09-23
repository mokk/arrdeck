import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatBytes, formatDay } from "../api/format";
import { Card, ErrorNote, Row, SectionTitle, StateBadge } from "../components/Blocks";
import {
  DetailActions,
  DetailHeader,
  DetailHero,
  DetailHistory,
  DetailProfileSelect,
  type ExternalLink,
} from "../components/detail";
import { BigButton } from "../components/media";
import { ReleasesSheet } from "../components/ReleasesSheet";
import {
  useBookDetail,
  useDeleteLibraryItem,
  useOptions,
  useTriggerSearch,
  useUpdateLibraryItem,
} from "../hooks/queries";

export default function BookPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const bookId = Number(id);
  const navigate = useNavigate();
  const { data, error, isLoading } = useBookDetail(bookId);
  const { data: options } = useOptions("readarr");
  const update = useUpdateLibraryItem("books");
  const remove = useDeleteLibraryItem("books");
  const search = useTriggerSearch();
  const [showReleases, setShowReleases] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const links: ExternalLink[] = [];
  if (data?.goodreads_url) links.push({ label: "Goodreads", url: data.goodreads_url });

  return (
    <>
      <DetailHeader title={data?.title} year={data?.year} />
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && <Skeleton className="mb-4 h-40 w-full rounded-2xl" />}
      {data && (
        <>
          <DetailHero
            poster={data.poster}
            overview={data.overview}
            links={links}
            badges={
              <>
                <StateBadge
                  state={
                    data.has_file ? "downloaded" : data.monitored ? "wanted" : "unmonitored"
                  }
                />
                {data.author &&
                  (data.author_id ? (
                    <Link to={`/author/${data.author_id}`} className="text-primary">
                      {data.author}
                    </Link>
                  ) : (
                    <span>{data.author}</span>
                  ))}
                {data.series_title && <span>· {data.series_title}</span>}
                {data.page_count ? (
                  <span>· {t("book.pages", { count: data.page_count })}</span>
                ) : null}
                {data.rating != null && <span>· ★ {data.rating.toFixed(1)}</span>}
              </>
            }
          />

          <div className="mb-5">
            <div className="mb-2 flex items-center gap-2">
              <DetailProfileSelect
                value={data.quality_profile_id}
                options={options}
                disabled={update.isPending}
                onChange={(pid) => update.mutate({ id: bookId, quality_profile_id: pid })}
              />
            </div>
            <DetailActions
              monitored={data.monitored ?? false}
              busy={update.isPending || remove.isPending || search.isPending}
              confirming={confirmingDelete}
              onConfirmingChange={setConfirmingDelete}
              onToggleMonitor={() => update.mutate({ id: bookId, monitored: !data.monitored })}
              onSearch={() => search.mutate({ app: "readarr", id: bookId })}
              onDelete={(deleteFiles) =>
                remove.mutate({ id: bookId, deleteFiles }, { onSuccess: () => navigate(-1) })
              }
              extra={
                <BigButton color="blue" onClick={() => setShowReleases(true)}>
                  {t("releases.interactive")}
                </BigButton>
              }
            />
          </div>

          <SectionTitle>{t("movie.file")}</SectionTitle>
          <Card>
            {(data.files ?? []).map((file) => (
              <Row key={file.id}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{file.name ?? data.title}</div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {[file.format, formatBytes(file.size)].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {/* only our Readarr fork serves files; upstream has no such
                    endpoint, so the button waits for the capability */}
                {data.downloadable && (
                  <a
                    href={`/api/v1/library/books/${bookId}/files/${file.id}`}
                    download={file.name ?? undefined}
                    className={cn(
                      buttonVariants({ variant: "secondary", size: "sm" }),
                      "shrink-0 text-primary",
                    )}
                  >
                    {t("book.download")}
                  </a>
                )}
              </Row>
            ))}
            {(data.files?.length ?? 0) === 0 && (
              <Row>
                {data.has_file ? (
                  <div className="text-sm font-medium">{formatBytes(data.size_on_disk)}</div>
                ) : (
                  <span className="text-sm text-muted-foreground">{t("movie.noFile")}</span>
                )}
              </Row>
            )}
            {data.release_date && (
              <Row>
                <div className="text-xs text-muted-foreground">
                  {t("book.released", { date: formatDay(data.release_date) })}
                </div>
              </Row>
            )}
          </Card>

          {(data.editions?.length ?? 0) > 0 && (
            <>
              <SectionTitle>{t("book.editions")}</SectionTitle>
              <Card>
                {(data.editions ?? []).map((edition, i) => (
                  <Row key={`${edition.title}-${i}`}>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{edition.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {[
                          edition.format,
                          edition.is_ebook ? t("book.ebook") : null,
                          edition.page_count
                            ? t("book.pages", { count: edition.page_count })
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                    {edition.monitored && <StateBadge state="monitored" />}
                  </Row>
                ))}
              </Card>
            </>
          )}

          {(data.series ?? []).map((series) => (
            <div key={series.id}>
              <SectionTitle>
                {t("book.seriesTitle", { title: series.title ?? "" })}
              </SectionTitle>
              <Card>
                {(series.books ?? []).map((entry) => (
                  <Row
                    key={entry.book_id}
                    onClick={
                      entry.book_id !== bookId
                        ? () => navigate(`/book/${entry.book_id}`)
                        : undefined
                    }
                  >
                    <span className="w-8 shrink-0 font-mono text-xs text-muted-foreground">
                      {entry.position ? `#${entry.position}` : ""}
                    </span>
                    <div
                      className={cn(
                        "min-w-0 flex-1 truncate text-sm",
                        entry.book_id === bookId && "font-semibold",
                      )}
                    >
                      {entry.title}
                    </div>
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

          {(data.genres?.length ?? 0) > 0 && (
            <>
              <SectionTitle>{t("book.genres")}</SectionTitle>
              <div className="mb-4 flex flex-wrap gap-1.5">
                {(data.genres ?? []).map((genre) => (
                  <span
                    key={genre}
                    className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground"
                  >
                    {genre}
                  </span>
                ))}
              </div>
            </>
          )}

          <DetailHistory history={data.history} />
        </>
      )}
      {showReleases && (
        <ReleasesSheet
          app="readarr"
          params={{ bookId }}
          title={data?.title ?? ""}
          onClose={() => setShowReleases(false)}
        />
      )}
    </>
  );
}
