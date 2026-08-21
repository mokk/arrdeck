"""Quality profiles as the arrs see them, read-only.

Answering "what will this actually grab, and what does it stop at" meant opening
Radarr, then Sonarr. The dropdowns elsewhere in arrdeck only carry a profile's id
and name; this is the rest of it.
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException

from ...cache import cached
from ...clients.base import ArrClient
from ...clients.radarr import RadarrClient
from ...clients.sonarr import SonarrClient
from ...deps import get_radarr, get_sonarr
from ...schemas import (
    CustomFormatScoreOut,
    QualityDefinitionOut,
    QualityItemOut,
    QualityProfileDetailOut,
    QualityProfilesOut,
)

router = APIRouter(tags=["settings"])


def _cutoff_name(profile: dict) -> str | None:
    """Resolve the cutoff id against the profile's own items.

    Groups and qualities share the field but not the id space — groups start at
    1000 — so a group is checked as a group rather than trusting the number.
    """
    cutoff = profile.get("cutoff")
    if cutoff is None:
        return None
    for item in profile.get("items") or []:
        quality = item.get("quality")
        if quality and quality.get("id") == cutoff:
            return quality.get("name")
        if item.get("items") and item.get("id") == cutoff:
            return item.get("name")
    return None


def _items(profile: dict) -> list[QualityItemOut]:
    cutoff = profile.get("cutoff")
    out: list[QualityItemOut] = []
    for item in profile.get("items") or []:
        quality = item.get("quality")
        if quality:
            out.append(
                QualityItemOut(
                    name=quality.get("name") or "",
                    allowed=bool(item.get("allowed")),
                    is_cutoff=quality.get("id") == cutoff,
                )
            )
            continue
        members = [
            (m.get("quality") or {}).get("name") or ""
            for m in item.get("items") or []
        ]
        out.append(
            QualityItemOut(
                name=item.get("name") or "",
                allowed=bool(item.get("allowed")),
                is_group=True,
                members=[m for m in members if m],
                is_cutoff=item.get("id") == cutoff,
            )
        )
    # The arr returns worst first and shows best first; match what the user sees
    # when they open Radarr next to this.
    out.reverse()
    return out


def _format_scores(profile: dict, names: dict[int, str]) -> list[CustomFormatScoreOut]:
    scores = [
        CustomFormatScoreOut(
            name=names.get(f.get("format"), f.get("name") or str(f.get("format"))),
            score=f.get("score") or 0,
        )
        for f in profile.get("formatItems") or []
        # A zero score means the format is defined but does not influence this
        # profile, which is every format by default — listing them all would
        # bury the ones that matter.
        if (f.get("score") or 0) != 0
    ]
    scores.sort(key=lambda s: (-s.score, s.name))
    return scores


@router.get("/quality-profiles/{app}", response_model=QualityProfilesOut)
async def quality_profiles(
    app: str,
    radarr: RadarrClient = Depends(get_radarr),
    sonarr: SonarrClient = Depends(get_sonarr),
) -> QualityProfilesOut:
    client: ArrClient
    if app == "radarr":
        client = radarr
    elif app == "sonarr":
        client = sonarr
    else:
        raise HTTPException(404, f"unknown app {app!r}")

    async def build() -> dict:
        profiles, formats, definitions = await asyncio.gather(
            client.quality_profiles(),
            # A profile references formats by id, so the names have to come from
            # here. Not fatal if it fails: the scores still render by id.
            client.custom_formats(),
            # Nor is this: the size table is context, not the point of the card.
            client.quality_definitions(),
            return_exceptions=True,
        )
        if isinstance(profiles, BaseException):
            raise profiles
        format_list = [] if isinstance(formats, BaseException) else formats
        definition_list = [] if isinstance(definitions, BaseException) else definitions
        names = {f.get("id"): f.get("name") or "" for f in format_list}
        return QualityProfilesOut(
            profiles=[
                QualityProfileDetailOut(
                    id=p["id"],
                    name=p.get("name") or "",
                    upgrade_allowed=bool(p.get("upgradeAllowed")),
                    cutoff=_cutoff_name(p),
                    min_format_score=p.get("minFormatScore") or 0,
                    items=_items(p),
                    format_scores=_format_scores(p, names),
                )
                for p in profiles
            ],
            custom_formats=sorted(f.get("name") or "" for f in format_list),
            quality_definitions=[
                QualityDefinitionOut(
                    name=d.get("title") or (d.get("quality") or {}).get("name") or "",
                    min_size=d.get("minSize"),
                    preferred_size=d.get("preferredSize"),
                    max_size=d.get("maxSize"),
                )
                for d in sorted(definition_list, key=lambda d: d.get("weight") or 0)
            ],
        ).model_dump()

    return QualityProfilesOut(**await cached(f"quality_profiles:{app}", 300, build))
