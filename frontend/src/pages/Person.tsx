// Someone from a film's credits: their films in the library first, then —
// when Overseerr is there to ask — the released ones that are not, ready to add.
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, focusRing } from "@/lib/utils";
import { EmptyNote, ErrorNote, SectionTitle } from "../components/Blocks";
import { DetailHeader } from "../components/detail";
import { Cover } from "../components/library/Cover";
import { PosterGrid } from "../components/media";
import { usePerson } from "../hooks/queries";

export default function PersonPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, error, isLoading } = usePerson(Number(id));

  return (
    <>
      <DetailHeader title={data?.name} />
      {error && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading && <Skeleton className="h-40 w-full rounded-2xl" />}
      {data && (
        <>
          <div className="mb-5 flex items-center gap-4">
            {data.image ? (
              <img
                src={data.image}
                alt=""
                className="size-20 shrink-0 rounded-full bg-secondary object-cover"
              />
            ) : null}
            <div className="text-sm text-muted-foreground">
              {data.known_for && <div>{data.known_for}</div>}
              <div>{t("person.inLibrary", { count: data.owned?.length ?? 0 })}</div>
            </div>
          </div>

          <SectionTitle>{t("person.yours")}</SectionTitle>
          {(data.owned ?? []).length === 0 ? (
            <EmptyNote>{t("person.noneOwned")}</EmptyNote>
          ) : (
            <div className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {(data.owned ?? []).map((m) => (
                <button
                  type="button"
                  key={m.movie_id}
                  onClick={() => navigate(`/movie/${m.movie_id}`)}
                  className={cn(focusRing, "min-w-0 pb-1 text-left active:opacity-70")}
                >
                  <Cover
                    src={m.poster}
                    title={m.title ?? ""}
                    subtitle={m.year ? String(m.year) : null}
                  />
                  <div className="mt-1.5 truncate text-sm font-medium">{m.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[m.year, m.role].filter(Boolean).join(" · ")}
                  </div>
                </button>
              ))}
            </div>
          )}

          {(data.elsewhere ?? []).length > 0 && (
            <>
              <SectionTitle>{t("person.notYours")}</SectionTitle>
              <PosterGrid results={data.elsewhere ?? []} />
            </>
          )}
        </>
      )}
    </>
  );
}
