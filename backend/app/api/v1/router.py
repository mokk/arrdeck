from fastapi import APIRouter

from . import auth, dashboard, downloads, manage, media, settings

router = APIRouter(prefix="/api/v1")
router.include_router(dashboard.router)
router.include_router(downloads.router)
router.include_router(media.router)
router.include_router(manage.router)
router.include_router(settings.router)
router.include_router(auth.router)
