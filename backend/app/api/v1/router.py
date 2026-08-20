from fastapi import APIRouter

from . import (
    auth,
    dashboard,
    downloads,
    hooks,
    arrmeta,
    indexers,
    library,
    wanted,
    media,
    plex,
    popular,
    settings,
    subtitles,
    system,
    torrents,
)

router = APIRouter(prefix="/api/v1")
router.include_router(dashboard.router)
router.include_router(system.router)
router.include_router(plex.router)
router.include_router(popular.router)
router.include_router(subtitles.router)
router.include_router(torrents.router)
router.include_router(downloads.router)
router.include_router(media.router)
router.include_router(indexers.router)
router.include_router(library.router)
router.include_router(wanted.router)
router.include_router(arrmeta.router)
router.include_router(settings.router)
router.include_router(auth.router)
router.include_router(hooks.router)
