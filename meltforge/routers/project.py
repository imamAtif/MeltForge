"""
Project Router - Project state, raw meltano.yml, and plugin management.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from meltforge.services.meltano_yaml import MeltanoYamlService

router = APIRouter(prefix="/api/project", tags=["project"])


class InitProjectRequest(BaseModel):
    project_name: Optional[str] = "meltforge-project"


class PluginSaveRequest(BaseModel):
    plugin_type: str  # 'extractors' or 'loaders'
    name: str
    variant: Optional[str] = None
    pip_url: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    secrets: Optional[Dict[str, str]] = None
    select: Optional[List[str]] = None


def get_yaml_service() -> MeltanoYamlService:
    from meltforge.server import yaml_service
    return yaml_service


@router.get("")
async def get_project(svc: MeltanoYamlService = Depends(get_yaml_service)):
    """Returns project overview, initialized state, plugins, and raw meltano.yml."""
    is_init = svc.is_initialized()
    parsed = svc.read() if is_init else {}
    raw = svc.read_raw() if is_init else ""
    secrets = svc.get_secrets() if is_init else {}

    # Mask secrets for security
    masked_secrets = {k: "••••••••" if v else "" for k, v in secrets.items()}

    return {
        "initialized": is_init,
        "project_root": str(svc.project_root),
        "meltano_yml_path": str(svc.yaml_file),
        "parsed": parsed,
        "raw_yaml": raw,
        "secrets_keys": list(secrets.keys()),
        "masked_secrets": masked_secrets,
        "extractors": parsed.get("plugins", {}).get("extractors", []),
        "loaders": parsed.get("plugins", {}).get("loaders", [])
    }


@router.post("/init")
async def init_project(req: InitProjectRequest, svc: MeltanoYamlService = Depends(get_yaml_service)):
    """Creates a new meltano.yml and .env if not already present."""
    data = svc.init_project(req.project_name or "meltforge-project")
    return {"success": True, "message": "Meltano project initialized.", "data": data}


@router.post("/plugin")
async def save_plugin(req: PluginSaveRequest, svc: MeltanoYamlService = Depends(get_yaml_service)):
    """Saves or updates an extractor or loader in meltano.yml and .env."""
    if req.plugin_type not in ["extractors", "loaders"]:
        raise HTTPException(status_code=400, detail="Invalid plugin_type. Must be 'extractors' or 'loaders'.")

    # If project not initialized, initialize it first
    if not svc.is_initialized():
        svc.init_project()

    updated = svc.upsert_plugin(
        plugin_type=req.plugin_type,
        name=req.name,
        variant=req.variant,
        pip_url=req.pip_url,
        config=req.config,
        secrets=req.secrets,
        select=req.select
    )
    return {
        "success": True,
        "message": f"Plugin {req.name} saved successfully.",
        "plugins": updated.get("plugins", {})
    }


@router.delete("/plugin/{plugin_type}/{name}")
async def remove_plugin(plugin_type: str, name: str, svc: MeltanoYamlService = Depends(get_yaml_service)):
    """Removes a plugin from meltano.yml."""
    if plugin_type not in ["extractors", "loaders"]:
        raise HTTPException(status_code=400, detail="Invalid plugin_type.")
    updated = svc.remove_plugin(plugin_type, name)
    return {"success": True, "message": f"Plugin {name} removed.", "plugins": updated.get("plugins", {})}
