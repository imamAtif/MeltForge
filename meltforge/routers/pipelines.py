"""
Pipelines Router - Orchestration, stream selection, connection testing, and live execution streaming.
"""

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, Depends
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
import asyncio
from meltforge.services.meltano_yaml import MeltanoYamlService
from meltforge.services.runner_service import MeltanoRunnerService

router = APIRouter(prefix="/api/pipelines", tags=["pipelines"])


class TestConnectionRequest(BaseModel):
    plugin_type: str
    plugin_name: str


class DiscoverStreamsRequest(BaseModel):
    extractor_name: str


class RunPipelineRequest(BaseModel):
    extractor: str
    loader: str


def get_yaml_service() -> MeltanoYamlService:
    from meltforge.server import yaml_service
    return yaml_service


def get_runner_service() -> MeltanoRunnerService:
    from meltforge.server import runner_service
    return runner_service


@router.get("")
async def list_pipelines(yaml_svc: MeltanoYamlService = Depends(get_yaml_service)):
    """Returns all configured pipelines and jobs."""
    pipelines = yaml_svc.get_pipelines()
    return {"count": len(pipelines), "pipelines": pipelines}


@router.post("/test-connection")
async def test_connection(
    req: TestConnectionRequest,
    runner_svc: MeltanoRunnerService = Depends(get_runner_service)
):
    """Executes a connection test against the target plugin."""
    res = await runner_svc.test_connection(req.plugin_type, req.plugin_name)
    return res


@router.post("/discover-streams")
async def discover_streams(
    req: DiscoverStreamsRequest,
    runner_svc: MeltanoRunnerService = Depends(get_runner_service)
):
    """Executes schema & stream discovery on an extractor."""
    res = await runner_svc.discover_streams(req.extractor_name)
    return res


@router.post("/run")
async def run_pipeline(
    req: RunPipelineRequest,
    runner_svc: MeltanoRunnerService = Depends(get_runner_service)
):
    """Triggers an async pipeline run and returns a run_id for WebSocket tracking."""
    run_id = await runner_svc.run_pipeline(req.extractor, req.loader)
    return {
        "success": True,
        "run_id": run_id,
        "message": f"Pipeline {req.extractor} ➔ {req.loader} triggered.",
        "websocket_url": f"/api/pipelines/ws/{run_id}"
    }


@router.get("/runs")
async def list_runs(runner_svc: MeltanoRunnerService = Depends(get_runner_service)):
    """Returns all past and active runs."""
    runs = [r.to_dict() for r in runner_svc.runs.values()]
    runs.reverse()
    return {"runs": runs}


@router.get("/runs/{run_id}")
async def get_run_details(run_id: str, runner_svc: MeltanoRunnerService = Depends(get_runner_service)):
    """Returns full details and historical logs for a run."""
    run = runner_svc.runs.get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run ID not found")
    data = run.to_dict()
    data["logs"] = run.logs
    return data


@router.websocket("/ws/{run_id}")
async def stream_run_logs(websocket: WebSocket, run_id: str):
    """WebSocket connection for real-time log streaming."""
    from meltforge.server import runner_service
    await websocket.accept()

    run = runner_service.runs.get(run_id)
    if not run:
        await websocket.send_json({"stream": "system", "message": f"Run ID {run_id} not found."})
        await websocket.close()
        return

    # First, send any existing logs that already occurred
    for log in run.logs:
        await websocket.send_json(log)

    # If run already finished, close
    if run.status in ["SUCCESS", "FAILED"]:
        await websocket.send_json({
            "stream": "system",
            "message": f"[PROCESS COMPLETE] Status: {run.status}",
            "complete": True,
            "status": run.status
        })
        await websocket.close()
        return

    # Subscribe to new live log lines
    queue = runner_service.subscribe(run_id)
    try:
        while True:
            log_item = await queue.get()
            await websocket.send_json(log_item)
            if run.status in ["SUCCESS", "FAILED"] and queue.empty():
                await websocket.send_json({
                    "stream": "system",
                    "message": f"[PROCESS COMPLETE] Status: {run.status}",
                    "complete": True,
                    "status": run.status
                })
                break
    except WebSocketDisconnect:
        pass
    finally:
        runner_service.unsubscribe(run_id, queue)
