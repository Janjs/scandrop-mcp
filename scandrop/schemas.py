from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Vec2 = tuple[float, float]
Vec3 = tuple[float, float, float]
Mat3 = tuple[Vec3, Vec3, Vec3]


class PlaneModel(BaseModel):
    normal: Vec3
    d: float


class AABBModel(BaseModel):
    min: Vec3
    max: Vec3


class OBBModel(BaseModel):
    center: Vec3
    extent: Vec3
    rotation: Mat3


class ObstacleSemanticModel(BaseModel):
    label: str
    confidence: float = Field(ge=0.0, le=1.0)


class ObstacleModel(BaseModel):
    id: str
    footprint_xz: list[Vec2] = Field(min_length=3)
    obb: OBBModel
    semantic: ObstacleSemanticModel | None = None


class RoomModel(BaseModel):
    floor_plane: PlaneModel
    floor_polygon_xz: list[Vec2] = Field(min_length=3)
    bounds_aabb: AABBModel

    @field_validator("floor_polygon_xz")
    @classmethod
    def _validate_floor_polygon(cls, value: list[Vec2]) -> list[Vec2]:
        if len({(round(x, 6), round(z, 6)) for x, z in value}) < 3:
            raise ValueError("floor_polygon_xz must contain at least three unique vertices")
        return value


class SceneGraphModel(BaseModel):
    units: Literal["meters"] = "meters"
    room: RoomModel
    obstacles: list[ObstacleModel] = Field(default_factory=list)


class StageBParams(BaseModel):
    sample_points_n: int = 250_000
    random_seed: int = 42
    voxel_size_m: float = 0.05
    ransac_iterations: int = 2_000
    max_ransac_planes: int = 5
    ransac_min_inliers: int = 500
    floor_ransac_distance_m: float = 0.03
    floor_min_up_dot: float = 0.9
    floor_support_max_height_m: float = 0.2
    floor_polygon_simplify_m: float = 0.01
    floor_alpha: float = 1.2
    obstacle_height_threshold_m: float = 0.12
    obstacle_max_height_m: float = 1.8
    obstacle_wall_clearance_m: float = 0.25
    dbscan_eps_m: float = 0.18
    dbscan_min_points: int = 40
    obstacle_min_cluster_points: int = 60
    min_obstacle_area_m2: float = 0.02
    max_obstacle_floor_coverage: float = 0.5


class SceneManifestModel(BaseModel):
    scene_id: str
    created_at: datetime
    updated_at: datetime
    latest_version: int = 0
    status: Literal["ready", "processing", "error"] = "processing"
    message: str | None = None


class SceneListEntry(BaseModel):
    scene_id: str
    created_at: datetime
    latest_version: int


class CreateSceneFromGltfRequest(BaseModel):
    path: str


class CreateSceneFromGltfResponse(BaseModel):
    scene_id: str
    version: int


class ProcessingStatusResponse(BaseModel):
    status: Literal["ready", "processing", "error"]
    message: str | None = None


class SceneSummaryResponse(BaseModel):
    bounds_aabb: AABBModel
    floor_area_m2: float
    obstacle_count: int


class PoseModel(BaseModel):
    pos: Vec3
    yaw_rad: float


class CheckFitRequest(BaseModel):
    scene_id: str
    version: int | None = None
    size_m: Vec3
    pose: PoseModel
    clearance_m: float = 0.0

    @field_validator("size_m")
    @classmethod
    def _size_positive(cls, value: Vec3) -> Vec3:
        if any(v <= 0 for v in value):
            raise ValueError("size_m values must be > 0")
        return value


class CheckFitResponse(BaseModel):
    ok: bool
    reasons: list[str]


class FreeSpaceCandidate(BaseModel):
    pos: Vec3
    yaw_rad: float
    score: float
    notes: list[str]


class FindFreeSpacesRequest(BaseModel):
    scene_id: str
    version: int | None = None
    size_m: Vec3
    clearance_m: float = 0.6
    yaw_steps: int = 4
    grid_step_m: float = 0.2
    max_results: int = 5

    @field_validator("size_m")
    @classmethod
    def _size_positive(cls, value: Vec3) -> Vec3:
        if any(v <= 0 for v in value):
            raise ValueError("size_m values must be > 0")
        return value

    @field_validator("clearance_m", "grid_step_m")
    @classmethod
    def _non_negative(cls, value: float) -> float:
        if value < 0:
            raise ValueError("value must be >= 0")
        return value

    @field_validator("yaw_steps", "max_results")
    @classmethod
    def _positive_int(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("value must be > 0")
        return value


class FindFreeSpacesResponse(BaseModel):
    candidates: list[FreeSpaceCandidate]


class ImportSceneByPathRequest(BaseModel):
    path: str
