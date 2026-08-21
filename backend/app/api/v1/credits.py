"""Cast and crew for a film. Radarr only — Sonarr has no /credit endpoint."""

from fastapi import APIRouter, Depends

from ...cache import cached
from ...clients.radarr import RadarrClient
from ...deps import get_radarr
from ...schemas import CreditPersonOut, CreditsOut
from .posters import TMDB_HEADSHOT_SIZE, proxy_poster

router = APIRouter(tags=["library"])


# Crew is 30 rows deep and includes Thanks, Painter and Stunt Double. These are
# the jobs someone actually looks for on a film's page, Director first.
CREW_JOBS = ("Director", "Screenplay", "Writer", "Story", "Original Music Composer")
CAST_LIMIT = 12
CREW_LIMIT = 6
# A blockbuster can carry four Screenplay credits plus a Story credit, which
# fills the whole crew list with writers and pushes the director out of view.
CREW_PER_JOB = 2


@router.get("/library/movies/{movie_id}/credits", response_model=CreditsOut)
async def movie_credits(
    movie_id: int, radarr: RadarrClient = Depends(get_radarr)
) -> CreditsOut:
    """Top-billed cast and the crew worth naming.

    Kept off the detail response on purpose: credits are ~60 rows per film and
    almost never change, so they cache far longer than the file and monitoring
    state the page reloads for.
    """

    async def build() -> dict:
        rows = await radarr.credits(movie_id)

        def person(row: dict, role_key: str) -> CreditPersonOut:
            images = row.get("images") or []
            headshot = next(
                (i.get("remoteUrl") or i.get("url") for i in images if i.get("remoteUrl")),
                None,
            )
            return CreditPersonOut(
                name=row.get("personName") or "",
                role=row.get(role_key) or None,
                image=proxy_poster(headshot, TMDB_HEADSHOT_SIZE),
                tmdb_id=row.get("personTmdbId"),
            )

        # The arr returns cast unsorted; `order` is TMDB's billing order, so
        # sorting by it is what makes "top billed" mean anything.
        cast = sorted(
            (r for r in rows if r.get("type") == "cast"),
            key=lambda r: r.get("order") if r.get("order") is not None else 999,
        )
        crew_rows = [r for r in rows if r.get("type") == "crew" and r.get("job") in CREW_JOBS]
        crew_rows.sort(key=lambda r: CREW_JOBS.index(r.get("job", "")))
        # One person often holds two of these credits — Screenplay and Story is
        # the common pair — and listing them twice reads as a mistake. Jobs are
        # already in priority order, so the first mention is the one to keep.
        seen_people: set[str] = set()
        per_job: dict[str, int] = {}
        crew = []
        for row in crew_rows:
            name, job = row.get("personName") or "", row.get("job") or ""
            if name in seen_people or per_job.get(job, 0) >= CREW_PER_JOB:
                continue
            seen_people.add(name)
            per_job[job] = per_job.get(job, 0) + 1
            crew.append(row)
        return CreditsOut(
            cast=[person(r, "character") for r in cast[:CAST_LIMIT]],
            crew=[person(r, "job") for r in crew[:CREW_LIMIT]],
        ).model_dump()

    return CreditsOut(**await cached(f"credits:{movie_id}", 86_400, build))
