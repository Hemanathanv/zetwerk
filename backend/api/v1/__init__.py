from fastapi import FastAPI
from .admin import router as admin_router
from .auth import router as auth_router
from .doc_generation import router as doc_generation_router
from .dnd import router as dnd_router
from .documents import router as documents_router
from .inventory import router as inventory_router
from .settings import router as settings_router
from .tasks import router as tasks_router
from .tracking import router as tracking_router
from .uploads import router as uploads_router
from .uploads import validation_router


def register_routes(app: FastAPI, agent=None):    
    app.include_router(admin_router)
    app.include_router(auth_router)
    app.include_router(doc_generation_router)
    app.include_router(documents_router)
    app.include_router(dnd_router)
    app.include_router(inventory_router)
    app.include_router(settings_router)
    app.include_router(tasks_router)
    app.include_router(tracking_router)
    app.include_router(uploads_router)
    app.include_router(validation_router)


__all__ = ["register_routes"]
