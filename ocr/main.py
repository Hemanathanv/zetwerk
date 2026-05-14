import uvicorn
import fastapi

from database import lifespan
from objectstore_router import router as documents_router

app = fastapi.FastAPI(lifespan=lifespan)
app.include_router(documents_router)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
