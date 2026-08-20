from fastapi import APIRouter

from . import (
    arrmeta,
    arrqueue,
    auth,
    dashboard,
    discover,
    hooks,
    importing,
    indexers,
    library,
    plex,
    popular,
    posters,
    releases,
    requests,
    settings,
    subtitles,
    system,
    torrentactions,
    torrents,
    wanted,
)

router = APIRouter(prefix="/api/v1")
router.include_router(dashboard.router)
router.include_router(system.router)
router.include_router(plex.router)
router.include_router(popular.router)
router.include_router(subtitles.router)
router.include_router(torrents.router)
router.include_router(torrentactions.router)
router.include_router(importing.router)
router.include_router(arrqueue.router)
router.include_router(posters.router)
router.include_router(discover.router)
router.include_router(releases.router)
router.include_router(requests.router)
router.include_router(indexers.router)
router.include_router(library.router)
router.include_router(wanted.router)
router.include_router(arrmeta.router)
router.include_router(settings.router)
router.include_router(auth.router)
router.include_router(hooks.router)
