"""Top-level API router composition."""

from fastapi import APIRouter

from app.api.routes.admin_users import router as admin_users_router
from app.api.routes.admin_traces import router as admin_traces_router
from app.api.routes.admin_telemetry import router as admin_telemetry_router
from app.api.routes.auth import router as auth_router
from app.api.routes.chats import router as chats_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.documents import router as documents_router
from app.api.routes.events import router as events_router
from app.api.routes.health import router as health_router
from app.api.routes.rag import router as hr_rag_router
from app.api.routes.profile import router as profile_router

from app.api.routes.feedback import router as feedback_router

api_router = APIRouter()
api_router.include_router(feedback_router)
api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(admin_users_router)
api_router.include_router(admin_traces_router)
api_router.include_router(admin_telemetry_router)
api_router.include_router(profile_router)
api_router.include_router(dashboard_router)
api_router.include_router(hr_rag_router)
api_router.include_router(documents_router)
api_router.include_router(chats_router)
api_router.include_router(events_router)