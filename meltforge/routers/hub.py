"""
Hub Router - Search, inspect, and synchronize plugins from Meltano Hub.
"""

from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Optional
from meltforge.services.hub_service import MeltanoHubService

router = APIRouter(prefix="/api/hub", tags=["hub"])


def get_hub_service() -> MeltanoHubService:
    from meltforge.server import hub_service
    return hub_service


@router.get("/status")
async def get_catalog_status(svc: MeltanoHubService = Depends(get_hub_service)):
    """Returns catalog counts and last sync timestamps."""
    return svc.get_status()


@router.post("/sync/taps")
async def sync_taps(svc: MeltanoHubService = Depends(get_hub_service)):
    """Synchronizes extractors (taps) catalog from Meltano Hub GitHub tree."""
    try:
        res = await svc.sync_plugins("extractors")
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sync/targets")
async def sync_targets(svc: MeltanoHubService = Depends(get_hub_service)):
    """Synchronizes loaders (targets) catalog from Meltano Hub GitHub tree."""
    try:
        res = await svc.sync_plugins("loaders")
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/plugins")
async def list_plugins(
    type: str = Query("extractors", pattern="^(extractors|loaders)$"),
    query: Optional[str] = None,
    svc: MeltanoHubService = Depends(get_hub_service)
):
    """Lists available extractors or loaders with optional search query."""
    plugins = await svc.list_plugins(plugin_type=type, query=query)
    return {"type": type, "count": len(plugins), "plugins": plugins}


@router.get("/plugins/{plugin_type}/{plugin_name}")
async def get_plugin_details(
    plugin_type: str,
    plugin_name: str,
    variant: Optional[str] = None,
    svc: MeltanoHubService = Depends(get_hub_service)
):
    """Retrieves full settings schema and metadata for a plugin."""
    if plugin_type not in ["extractors", "loaders"]:
        raise HTTPException(status_code=400, detail="Invalid plugin_type")
    
    details = await svc.get_plugin_details(plugin_type, plugin_name, variant)
    if not details:
        raise HTTPException(status_code=404, detail="Plugin not found")
    return details
