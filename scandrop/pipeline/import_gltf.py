from __future__ import annotations

from pathlib import Path

import trimesh

from scandrop.pipeline.stage_b import derive_scene_graph
from scandrop.schemas import StageBParams
from scandrop.store import FileSceneStore


def load_merged_mesh(path: str) -> trimesh.Trimesh:
    source_path = Path(path).expanduser().resolve()
    if not source_path.exists():
        raise FileNotFoundError(f"Input file does not exist: {source_path}")
    if source_path.suffix.lower() not in {".glb", ".gltf"}:
        raise ValueError("Input file must have .glb or .gltf extension")

    loaded = trimesh.load(source_path, force="scene")
    if isinstance(loaded, trimesh.Scene):
        if not loaded.geometry:
            raise ValueError("GLTF/GLB scene has no geometry")
        merged = loaded.dump(concatenate=True)
    elif isinstance(loaded, trimesh.Trimesh):
        merged = loaded
    else:
        raise ValueError("Unsupported geometry type in GLTF/GLB")

    if isinstance(merged, list):
        merged = trimesh.util.concatenate(merged)
    if not isinstance(merged, trimesh.Trimesh):
        raise ValueError("Failed to merge scene into a mesh")
    if merged.is_empty or merged.faces.shape[0] == 0:
        raise ValueError("Merged mesh is empty")

    merged.remove_unreferenced_vertices()
    return merged


def create_scene_from_gltf(
    path: str,
    store: FileSceneStore | None = None,
    params: StageBParams | None = None,
    scene_id: str | None = None,
) -> tuple[str, int]:
    scene_store = store or FileSceneStore()
    config = params or StageBParams()
    created_scene_id, version = scene_store.create_scene_version(scene_id=scene_id)

    try:
        mesh = load_merged_mesh(path)
        scene_graph = derive_scene_graph(mesh=mesh, params=config)
        scene_store.save_scene_graph(
            scene_id=created_scene_id,
            version=version,
            scene_graph=scene_graph,
            params=config,
        )
    except Exception as exc:
        scene_store.set_status(
            scene_id=created_scene_id,
            status="error",
            message=str(exc),
            version=version,
        )
        raise

    return created_scene_id, version
