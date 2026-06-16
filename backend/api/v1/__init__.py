from fastapi import FastAPI
from .admin import router as admin_router
from .auth import router as auth_router
from .doc_generation import router as doc_generation_router
from .shipments import router as shipments_router
from .settings import router as settings_router
from .uploads import router as uploads_router


def register_routes(app: FastAPI, agent=None):    
    app.include_router(admin_router)
    app.include_router(auth_router)
    app.include_router(doc_generation_router)
    app.include_router(shipments_router)
    app.include_router(settings_router)
    app.include_router(uploads_router)


__all__ = ["register_routes"]
