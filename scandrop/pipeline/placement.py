from __future__ import annotations

import math
from typing import Any

import numpy as np
from shapely.geometry import Point, Polygon

from scandrop.schemas import (
    CheckFitResponse,
    FindFreeSpacesResponse,
    FreeSpaceCandidate,
    PoseModel,
    SceneGraphModel,
)


def _coerce_scene_graph(scene_graph: SceneGraphModel | dict[str, Any]) -> SceneGraphModel:
    if isinstance(scene_graph, SceneGraphModel):
        return scene_graph
    return SceneGraphModel.model_validate(scene_graph)


def _polygon_from_coords(coords: list[tuple[float, float]]) -> Polygon:
    polygon = Polygon(coords)
    if polygon.is_empty or not polygon.is_valid or polygon.area <= 0:
        raise ValueError("Invalid polygon geometry in scene graph")
    return polygon


def _rect_polygon_xz(size_m: tuple[float, float, float], x: float, z: float, yaw_rad: float) -> Polygon:
    width, depth, _ = size_m
    half_w = width * 0.5
    half_d = depth * 0.5
    base = np.array(
        [
            [-half_w, -half_d],
            [half_w, -half_d],
            [half_w, half_d],
            [-half_w, half_d],
        ],
        dtype=float,
    )
    cos_y = math.cos(yaw_rad)
    sin_y = math.sin(yaw_rad)
    rotation = np.array([[cos_y, -sin_y], [sin_y, cos_y]], dtype=float)
    rotated = base @ rotation.T
    rotated[:, 0] += x
    rotated[:, 1] += z
    return Polygon(rotated.tolist())


def _floor_y(plane_normal: tuple[float, float, float], plane_d: float, x: float, z: float) -> float:
    nx, ny, nz = plane_normal
    if abs(ny) < 1e-8:
        return 0.0
    return float((-plane_d - (nx * x) - (nz * z)) / ny)


def check_fit(
    scene_graph: SceneGraphModel | dict[str, Any],
    size_m: tuple[float, float, float],
    pose: PoseModel | dict[str, Any],
    clearance_m: float = 0.0,
) -> CheckFitResponse:
    scene = _coerce_scene_graph(scene_graph)
    pose_model = pose if isinstance(pose, PoseModel) else PoseModel.model_validate(pose)

    floor_polygon = _polygon_from_coords(scene.room.floor_polygon_xz)
    footprint = _rect_polygon_xz(
        size_m=size_m,
        x=pose_model.pos[0],
        z=pose_model.pos[2],
        yaw_rad=pose_model.yaw_rad,
    )

    if clearance_m > 0:
        inflated_footprint = footprint.buffer(clearance_m, join_style=2)
    else:
        inflated_footprint = footprint

    reasons: list[str] = []
    if not floor_polygon.contains(inflated_footprint):
        reasons.append("out_of_bounds")

    for obstacle in scene.obstacles:
        obstacle_polygon = _polygon_from_coords(obstacle.footprint_xz)
        buffered_obstacle = obstacle_polygon.buffer(clearance_m, join_style=2) if clearance_m > 0 else obstacle_polygon
        if inflated_footprint.intersects(buffered_obstacle):
            reasons.append(f"collides_obstacle:{obstacle.id}")

    return CheckFitResponse(ok=len(reasons) == 0, reasons=sorted(reasons))


def find_free_spaces(
    scene_graph: SceneGraphModel | dict[str, Any],
    size_m: tuple[float, float, float],
    clearance_m: float = 0.6,
    yaw_steps: int = 4,
    grid_step_m: float = 0.2,
    max_results: int = 5,
) -> FindFreeSpacesResponse:
    if yaw_steps <= 0:
        raise ValueError("yaw_steps must be > 0")
    if grid_step_m <= 0:
        raise ValueError("grid_step_m must be > 0")
    if max_results <= 0:
        raise ValueError("max_results must be > 0")

    scene = _coerce_scene_graph(scene_graph)
    floor_polygon = _polygon_from_coords(scene.room.floor_polygon_xz)
    centroid = floor_polygon.centroid
    min_x, min_z, max_x, max_z = floor_polygon.bounds
    yaws = [float(yaw) for yaw in np.linspace(0.0, 2.0 * math.pi, yaw_steps, endpoint=False)]

    xs = np.arange(min_x, max_x + (grid_step_m * 0.5), grid_step_m)
    zs = np.arange(min_z, max_z + (grid_step_m * 0.5), grid_step_m)
    candidates: list[FreeSpaceCandidate] = []

    for x in xs:
        for z in zs:
            if not floor_polygon.contains(Point(float(x), float(z))):
                continue
            for yaw in yaws:
                y = _floor_y(
                    plane_normal=scene.room.floor_plane.normal,
                    plane_d=scene.room.floor_plane.d,
                    x=float(x),
                    z=float(z),
                ) + (size_m[2] * 0.5)
                pose = PoseModel(pos=(float(x), y, float(z)), yaw_rad=yaw)
                fit = check_fit(scene_graph=scene, size_m=size_m, pose=pose, clearance_m=clearance_m)
                if not fit.ok:
                    continue

                placed = _rect_polygon_xz(size_m=size_m, x=pose.pos[0], z=pose.pos[2], yaw_rad=pose.yaw_rad)
                wall_distance = float(placed.distance(floor_polygon.boundary))
                center_distance = float(placed.centroid.distance(centroid))
                score = center_distance - wall_distance
                notes = [
                    f"wall_distance_m={wall_distance:.3f}",
                    f"center_distance_m={center_distance:.3f}",
                ]
                candidates.append(
                    FreeSpaceCandidate(
                        pos=pose.pos,
                        yaw_rad=pose.yaw_rad,
                        score=float(score),
                        notes=notes,
                    )
                )

    candidates.sort(key=lambda item: (-item.score, item.pos[0], item.pos[2], item.yaw_rad))
    return FindFreeSpacesResponse(candidates=candidates[:max_results])
