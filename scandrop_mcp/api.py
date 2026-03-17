from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request

from scandrop_mcp.pipeline.import_gltf import create_scene_from_gltf
from scandrop_mcp.schemas import (
    CreateSceneFromGltfResponse,
    ImportSceneByPathRequest,
    SceneGraphModel,
    SceneSummaryResponse,
)
from scandrop_mcp.store import FileSceneStore

app = FastAPI(title="scandrop-mcp API", version="0.1.0")
store = FileSceneStore()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/scenes/import")
async def import_scene(request: Request) -> dict[str, Any]:
    content_type = request.headers.get("content-type", "")
    temp_path: Path | None = None

    try:
        if "multipart/form-data" in content_type:
            form = await request.form()
            upload = form.get("file")
            if upload is None:
                raise HTTPException(status_code=400, detail="multipart request must include a file field")
            file_bytes = await upload.read()
            if not file_bytes:
                raise HTTPException(status_code=400, detail="uploaded file is empty")
            suffix = Path(getattr(upload, "filename", "scan.glb")).suffix or ".glb"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as handle:
                handle.write(file_bytes)
                temp_path = Path(handle.name)
            scene_id, version = create_scene_from_gltf(path=str(temp_path), store=store)
        else:
            payload = ImportSceneByPathRequest.model_validate(await request.json())
            scene_id, version = create_scene_from_gltf(path=payload.path, store=store)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)

    response = CreateSceneFromGltfResponse(scene_id=scene_id, version=version)
    return response.model_dump(mode="json")


@app.get("/scenes/{scene_id}/summary")
def get_scene_summary(scene_id: str, version: int | None = None) -> dict[str, Any]:
    try:
        summary: SceneSummaryResponse = store.get_summary(scene_id=scene_id, version=version)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return summary.model_dump(mode="json")


@app.get("/scenes/{scene_id}/scene_graph")
def get_scene_graph(scene_id: str, version: int | None = None) -> dict[str, Any]:
    try:
        scene_graph: SceneGraphModel = store.load_scene_graph(scene_id=scene_id, version=version)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return scene_graph.model_dump(mode="json")
