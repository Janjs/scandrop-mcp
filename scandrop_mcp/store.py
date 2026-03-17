from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from typing import Literal

from scandrop_mcp.schemas import (
    ProcessingStatusResponse,
    SceneGraphModel,
    SceneListEntry,
    SceneManifestModel,
    SceneSummaryResponse,
    StageBParams,
)


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(f"{path.suffix}.tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
    tmp_path.replace(path)


def _read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _polygon_area_xz(points: list[tuple[float, float]]) -> float:
    if len(points) < 3:
        return 0.0
    area = 0.0
    for idx, (x1, z1) in enumerate(points):
        x2, z2 = points[(idx + 1) % len(points)]
        area += (x1 * z2) - (x2 * z1)
    return abs(area) * 0.5


class FileSceneStore:
    def __init__(self, base_dir: str | Path = "./data/scenes") -> None:
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _scene_dir(self, scene_id: str) -> Path:
        return self.base_dir / scene_id

    def _manifest_path(self, scene_id: str) -> Path:
        return self._scene_dir(scene_id) / "manifest.json"

    def _version_dir(self, scene_id: str, version: int) -> Path:
        return self._scene_dir(scene_id) / f"v{version}"

    def _generate_scene_id(self) -> str:
        return uuid.uuid4().hex[:12]

    def _load_manifest(self, scene_id: str) -> SceneManifestModel:
        manifest_path = self._manifest_path(scene_id)
        if not manifest_path.exists():
            raise FileNotFoundError(f"Unknown scene_id: {scene_id}")
        return SceneManifestModel.model_validate(_read_json(manifest_path))

    def _save_manifest(self, manifest: SceneManifestModel) -> None:
        _atomic_write_json(self._manifest_path(manifest.scene_id), manifest.model_dump(mode="json"))

    def create_scene_version(self, scene_id: str | None = None) -> tuple[str, int]:
        now = _now_utc()
        if scene_id is None:
            scene_id = self._generate_scene_id()
            scene_dir = self._scene_dir(scene_id)
            scene_dir.mkdir(parents=True, exist_ok=False)
            manifest = SceneManifestModel(
                scene_id=scene_id,
                created_at=now,
                updated_at=now,
                latest_version=0,
                status="processing",
            )
        else:
            scene_dir = self._scene_dir(scene_id)
            if not scene_dir.exists():
                raise FileNotFoundError(f"Unknown scene_id: {scene_id}")
            manifest = self._load_manifest(scene_id)
            manifest.updated_at = now
            manifest.status = "processing"
            manifest.message = None

        version = manifest.latest_version + 1
        self._version_dir(scene_id, version).mkdir(parents=True, exist_ok=False)
        manifest.latest_version = version
        manifest.updated_at = now
        manifest.status = "processing"
        manifest.message = None
        self._save_manifest(manifest)
        return scene_id, version

    def set_status(
        self,
        scene_id: str,
        status: Literal["ready", "processing", "error"],
        message: str | None = None,
        version: int | None = None,
    ) -> None:
        manifest = self._load_manifest(scene_id)
        if version is not None:
            manifest.latest_version = max(manifest.latest_version, version)
        manifest.status = status
        manifest.message = message
        manifest.updated_at = _now_utc()
        self._save_manifest(manifest)

    def save_scene_graph(
        self,
        scene_id: str,
        version: int,
        scene_graph: SceneGraphModel,
        params: StageBParams,
    ) -> None:
        version_dir = self._version_dir(scene_id, version)
        if not version_dir.exists():
            raise FileNotFoundError(f"Missing version directory for {scene_id} v{version}")
        _atomic_write_json(version_dir / "scene_graph.json", scene_graph.model_dump(mode="json"))
        _atomic_write_json(version_dir / "params.json", params.model_dump(mode="json"))
        self.set_status(scene_id, status="ready", message=None, version=version)

    def get_status(self, scene_id: str) -> ProcessingStatusResponse:
        manifest = self._load_manifest(scene_id)
        return ProcessingStatusResponse(status=manifest.status, message=manifest.message)

    def get_latest_version(self, scene_id: str) -> int:
        manifest = self._load_manifest(scene_id)
        return manifest.latest_version

    def load_scene_graph(self, scene_id: str, version: int | None = None) -> SceneGraphModel:
        if version is None:
            version = self.get_latest_version(scene_id)
        scene_graph_path = self._version_dir(scene_id, version) / "scene_graph.json"
        if not scene_graph_path.exists():
            raise FileNotFoundError(f"Scene graph not found for {scene_id} version {version}")
        return SceneGraphModel.model_validate(_read_json(scene_graph_path))

    def get_summary(self, scene_id: str, version: int | None = None) -> SceneSummaryResponse:
        scene_graph = self.load_scene_graph(scene_id=scene_id, version=version)
        floor_area = _polygon_area_xz(scene_graph.room.floor_polygon_xz)
        return SceneSummaryResponse(
            bounds_aabb=scene_graph.room.bounds_aabb,
            floor_area_m2=floor_area,
            obstacle_count=len(scene_graph.obstacles),
        )

    def list_scenes(self) -> list[SceneListEntry]:
        results: list[SceneListEntry] = []
        for scene_dir in sorted(self.base_dir.glob("*")):
            if not scene_dir.is_dir():
                continue
            manifest_path = scene_dir / "manifest.json"
            if not manifest_path.exists():
                continue
            manifest = SceneManifestModel.model_validate(_read_json(manifest_path))
            results.append(
                SceneListEntry(
                    scene_id=manifest.scene_id,
                    created_at=manifest.created_at,
                    latest_version=manifest.latest_version,
                )
            )
        results.sort(key=lambda item: item.created_at, reverse=True)
        return results
