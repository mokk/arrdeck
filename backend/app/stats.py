import asyncio
import logging
import time

from .config import get_settings
from .db import SettingsDB
from .posters import backup_database
from .posters import prune as prune_posters
from .registry import Registry

logger = logging.getLogger("arrdeck.stats")

SAMPLE_INTERVAL = 6 * 3600
MIN_GAP = 5 * 3600  # skip startup sample if the last one is fresh enough


class _Failed:
    """A call that did not answer: its values are unknown, not zero."""


FAILED = _Failed()


async def collect_sample(registry: Registry) -> dict:
    """One sample. A service that is down leaves its keys out, so they are
    stored as unknown (NULL) rather than as an empty library — a zero would
    draw a cliff in every chart and wreck the disk forecast."""
    sample: dict = {"ts": int(time.time())}

    async def safe(coro):
        try:
            return await coro
        except Exception:  # noqa: BLE001 — a down service is a gap, not an error
            return FAILED

    library_parts: list[int] = []
    library_known = True
    if registry.is_configured("radarr"):
        movies = await safe(registry.get("radarr").movies())
        if movies is FAILED:
            library_known = False
        else:
            sample["movies"] = len(movies)
            library_parts.append(sum(m.get("sizeOnDisk", 0) for m in movies))
    if registry.is_configured("sonarr"):
        series = await safe(registry.get("sonarr").series())
        if series is FAILED:
            library_known = False
        else:
            sample["series"] = len(series)
            stats = [s.get("statistics") or {} for s in series]
            sample["episode_files"] = sum(st.get("episodeFileCount", 0) for st in stats)
            library_parts.append(sum(st.get("sizeOnDisk", 0) for st in stats))
    # the library is the films and the shows together: half of it is not a size
    if library_parts and library_known:
        sample["library_bytes"] = sum(library_parts)
    # Root folders, not /diskspace: in Docker the arrs only report their own
    # container root there. Distinct paths on the same volume report a
    # byte-identical freeSpace, so de-duplicating on the value (rather than the
    # path) is what keeps a shared disk from being counted twice. If one arr
    # did not answer, its disk may be missing from the sum: leave it unknown.
    free_space: set[int] = set()
    free_known = True
    for name in ("radarr", "sonarr"):
        if not registry.is_configured(name):
            continue
        folders = await safe(registry.get(name).root_folders())
        if folders is FAILED:
            free_known = False
            continue
        for entry in folders:
            if entry.get("freeSpace"):
                free_space.add(entry["freeSpace"])
    if free_space and free_known:
        sample["disk_free_bytes"] = sum(free_space)
    for name, key in (("qbittorrent", "torrents_qbit"), ("transmission", "torrents_tm")):
        if registry.is_configured(name):
            torrents = await safe(registry.get(name).torrents())
            if torrents is not FAILED:
                sample[key] = len(torrents)
    if registry.is_configured("prowlarr"):
        stats = await safe(registry.get("prowlarr").indexer_stats())
        if stats is not FAILED:
            indexers = stats.get("indexers") or []
            sample["indexer_grabs"] = sum(i.get("numberOfGrabs", 0) for i in indexers)
            sample["indexer_queries"] = sum(i.get("numberOfQueries", 0) for i in indexers)
    return sample


async def sampler_loop(db: SettingsDB, registry: Registry) -> None:
    while True:
        try:
            if time.time() - db.last_sample_ts() >= MIN_GAP:
                db.insert_sample(await collect_sample(registry))
            await asyncio.to_thread(prune_posters)
            await asyncio.to_thread(backup_database, get_settings().db_path)
        except Exception:
            logger.exception("stats sample failed")
        await asyncio.sleep(SAMPLE_INTERVAL)
