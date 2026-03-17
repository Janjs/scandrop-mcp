from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

from scandrop_mcp.pipeline.import_gltf import create_scene_from_gltf
from scandrop_mcp.pipeline.placement import check_fit, find_free_spaces
from scandrop_mcp.schemas import (
    CheckFitRequest,
    CreateSceneFromGltfRequest,
    FindFreeSpacesRequest,
)
from scandrop_mcp.store import FileSceneStore

store = FileSceneStore()
mcp = FastMCP("scandrop-mcp")


@mcp.tool(name="scandrop.create_scene_from_gltf")
def tool_create_scene_from_gltf(path: str) -> dict[str, Any]:
    request = CreateSceneFromGltfRequest(path=path)
    scene_id, version = create_scene_from_gltf(path=request.path, store=store)
    return {"scene_id": scene_id, "version": version}


@mcp.tool(name="scandrop.get_processing_status")
def tool_get_processing_status(scene_id: str) -> dict[str, Any]:
    status = store.get_status(scene_id=scene_id)
    return status.model_dump(mode="json")


@mcp.tool(name="scandrop.get_scene_summary")
def tool_get_scene_summary(scene_id: str, version: int | None = None) -> dict[str, Any]:
    summary = store.get_summary(scene_id=scene_id, version=version)
    return summary.model_dump(mode="json")


@mcp.tool(name="scandrop.get_scene_graph")
def tool_get_scene_graph(scene_id: str, version: int | None = None) -> dict[str, Any]:
    scene_graph = store.load_scene_graph(scene_id=scene_id, version=version)
    return scene_graph.model_dump(mode="json")


@mcp.tool(name="scandrop.find_free_spaces")
def tool_find_free_spaces(
    scene_id: str,
    size_m: tuple[float, float, float],
    version: int | None = None,
    clearance_m: float = 0.6,
    yaw_steps: int = 4,
    grid_step_m: float = 0.2,
    max_results: int = 5,
) -> dict[str, Any]:
    request = FindFreeSpacesRequest(
        scene_id=scene_id,
        version=version,
        size_m=size_m,
        clearance_m=clearance_m,
        yaw_steps=yaw_steps,
        grid_step_m=grid_step_m,
        max_results=max_results,
    )
    scene_graph = store.load_scene_graph(scene_id=request.scene_id, version=request.version)
    result = find_free_spaces(
        scene_graph=scene_graph,
        size_m=request.size_m,
        clearance_m=request.clearance_m,
        yaw_steps=request.yaw_steps,
        grid_step_m=request.grid_step_m,
        max_results=request.max_results,
    )
    return result.model_dump(mode="json")


@mcp.tool(name="scandrop.check_fit")
def tool_check_fit(
    scene_id: str,
    size_m: tuple[float, float, float],
    pose: dict[str, Any],
    version: int | None = None,
    clearance_m: float = 0.0,
) -> dict[str, Any]:
    request = CheckFitRequest(
        scene_id=scene_id,
        version=version,
        size_m=size_m,
        pose=pose,
        clearance_m=clearance_m,
    )
    scene_graph = store.load_scene_graph(scene_id=request.scene_id, version=request.version)
    result = check_fit(
        scene_graph=scene_graph,
        size_m=request.size_m,
        pose=request.pose,
        clearance_m=request.clearance_m,
    )
    return result.model_dump(mode="json")


@mcp.tool(name="scandrop.list_scenes")
def tool_list_scenes() -> list[dict[str, Any]]:
    scenes = store.list_scenes()
    return [entry.model_dump(mode="json") for entry in scenes]
