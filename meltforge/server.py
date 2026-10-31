"""
MeltForge Server - FastAPI Application Factory & Entrypoint.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path
import os

from meltforge.config import PROJECT_ROOT, STATIC_DIR, APP_NAME, API_VERSION
from meltforge.services.meltano_yaml import MeltanoYamlService
from meltforge.services.hub_service import MeltanoHubService
from meltforge.services.runner_service import MeltanoRunnerService
from meltforge.services.git_service import GitService

# Initialize singleton services
yaml_service = MeltanoYamlService(PROJECT_ROOT)
hub_service = MeltanoHubService()
runner_service = MeltanoRunnerService(yaml_service.project_root)
git_service = GitService(yaml_service.project_root)

app = FastAPI(
    title=APP_NAME,
    version=API_VERSION,
    description="MeltForge: Modern GitOps-first visual interface for Meltano data pipelines."
)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
from meltforge.routers.project import router as project_router
from meltforge.routers.hub import router as hub_router
from meltforge.routers.pipelines import router as pipelines_router
from meltforge.routers.git import router as git_router

app.include_router(project_router)
app.include_router(hub_router)
app.include_router(pipelines_router)
app.include_router(git_router)

@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "app": APP_NAME,
        "version": API_VERSION,
        "project_root": str(yaml_service.project_root),
        "initialized": yaml_service.is_initialized()
    }

# Mount static frontend
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
