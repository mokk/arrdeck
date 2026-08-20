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


async def collect_sample(registry: Registry) -> dict:
    sample = {"ts": int(time.time())}

    async def safe(coro, default):
        try:
            return await coro
        except Exception:  # noqa: BLE001 — a down service contributes zeros
            return default

    if registry.is_configured("radarr"):
        movies = await safe(registry.get("radarr").movies(), [])
        sample["movies"] = len(movies)
        sample["library_bytes"] = sum(m.get("sizeOnDisk", 0) for m in movies)
    if registry.is_configured("sonarr"):
        series = await safe(registry.get("sonarr").series(), [])
        sample["series"] = len(series)
        stats = [s.get("statistics") or {} for s in series]
        sample["episode_files"] = sum(st.get("episodeFileCount", 0) for st in stats)
        sample["library_bytes"] = sample.get("library_bytes", 0) + sum(
            st.get("sizeOnDisk", 0) for st in stats
        )
    # Root folders, not /diskspace: in Docker the arrs only report their own
    # container root there. Distinct paths on the same volume report a
    # byte-identical freeSpace, so de-duplicating on the value (rather than the
    # path) is what keeps a shared disk from being counted twice.
    free_space: set[int] = set()
    for name in ("radarr", "sonarr"):
        if not registry.is_configured(name):
            continue
        for entry in await safe(registry.get(name).root_folders(), []):
            if entry.get("freeSpace"):
                free_space.add(entry["freeSpace"])
    if free_space:
        sample["disk_free_bytes"] = sum(free_space)
    if registry.is_configured("qbittorrent"):
        sample["torrents_qbit"] = len(await safe(registry.get("qbittorrent").torrents(), []))
    if registry.is_configured("transmission"):
        sample["torrents_tm"] = len(await safe(registry.get("transmission").torrents(), []))
    if registry.is_configured("prowlarr"):
        stats = await safe(registry.get("prowlarr").indexer_stats(), {})
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
