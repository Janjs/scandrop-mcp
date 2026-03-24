from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import alphashape
import numpy as np
import open3d as o3d
import trimesh
from shapely import contains_xy
from shapely.geometry import GeometryCollection, MultiPoint, MultiPolygon, Polygon
from shapely.geometry.polygon import orient

from scandrop.schemas import (
    AABBModel,
    OBBModel,
    ObstacleModel,
    ObstacleSemanticModel,
    PlaneModel,
    RoomModel,
    SceneGraphModel,
    StageBParams,
)


def _to_pcd(points: np.ndarray) -> o3d.geometry.PointCloud:
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(points)
    return pcd


def _as_float_tuple(values: Sequence[float], size: int) -> tuple[float, ...]:
    if len(values) != size:
        raise ValueError(f"Expected {size} values, got {len(values)}")
    return tuple(float(v) for v in values)


def _sample_surface_points(mesh: trimesh.Trimesh, count: int, seed: int) -> np.ndarray:
    triangles = mesh.triangles  # shape: (F, 3, 3)
    if triangles.shape[0] == 0:
        raise ValueError("Mesh has no triangles")

    cross = np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0])
    areas = np.linalg.norm(cross, axis=1) * 0.5
    if not np.isfinite(areas).all() or np.sum(areas) <= 0:
        raise ValueError("Invalid mesh triangle areas")
    probabilities = areas / np.sum(areas)

    rng = np.random.default_rng(seed)
    face_indices = rng.choice(triangles.shape[0], size=count, p=probabilities)
    sampled_triangles = triangles[face_indices]

    r1 = np.sqrt(rng.random(count))
    r2 = rng.random(count)
    a = sampled_triangles[:, 0]
    b = sampled_triangles[:, 1]
    c = sampled_triangles[:, 2]
    points = ((1.0 - r1)[:, None] * a) + ((r1 * (1.0 - r2))[:, None] * b) + ((r1 * r2)[:, None] * c)
    return points


def _voxel_downsample(points: np.ndarray, voxel_size_m: float) -> np.ndarray:
    pcd = _to_pcd(points)
    downsampled = pcd.voxel_down_sample(voxel_size=voxel_size_m)
    down_points = np.asarray(downsampled.points)
    if down_points.shape[0] == 0:
        return points
    return down_points


def _pick_polygon(geometry: Any) -> Polygon | None:
    if geometry is None:
        return None
    if isinstance(geometry, Polygon):
        return geometry
    if isinstance(geometry, MultiPolygon):
        polygons = [poly for poly in geometry.geoms if poly.area > 0]
        if not polygons:
            return None
        return max(polygons, key=lambda poly: poly.area)
    if isinstance(geometry, GeometryCollection):
        polygons = [geom for geom in geometry.geoms if isinstance(geom, Polygon) and geom.area > 0]
        if not polygons:
            return None
        return max(polygons, key=lambda poly: poly.area)
    return None


def _find_floor_plane(points: np.ndarray, params: StageBParams) -> tuple[PlaneModel, np.ndarray]:
    remaining_points = points.copy()
    remaining_indices = np.arange(points.shape[0], dtype=int)
    candidates: list[tuple[float, int, np.ndarray, float, np.ndarray]] = []

    for _ in range(params.max_ransac_planes):
        if remaining_points.shape[0] < params.ransac_min_inliers:
            break
        pcd = _to_pcd(remaining_points)
        model, inliers = pcd.segment_plane(
            distance_threshold=params.floor_ransac_distance_m,
            ransac_n=3,
            num_iterations=params.ransac_iterations,
        )
        if len(inliers) < params.ransac_min_inliers:
            break

        inlier_idx = np.asarray(inliers, dtype=int)
        model_array = np.asarray(model, dtype=float)
        normal = model_array[:3]
        norm = np.linalg.norm(normal)
        if norm < 1e-8:
            break
        normal = normal / norm
        d = float(model_array[3] / norm)
        plane_points = remaining_points[inlier_idx]

        if abs(float(normal[1])) >= params.floor_min_up_dot:
            if normal[1] < 0:
                normal = -normal
                d = -d
            floor_y = float(np.median(plane_points[:, 1]))
            global_inliers = remaining_indices[inlier_idx]
            candidates.append((floor_y, -len(global_inliers), normal, d, global_inliers))

        mask = np.ones(remaining_points.shape[0], dtype=bool)
        mask[inlier_idx] = False
        remaining_points = remaining_points[mask]
        remaining_indices = remaining_indices[mask]

    if not candidates:
        approx_floor_y = float(np.percentile(points[:, 1], 5.0))
        normal = np.array([0.0, 1.0, 0.0])
        d = -approx_floor_y
        distances = np.abs(points @ normal + d)
        inliers = np.where(distances <= (params.floor_ransac_distance_m * 2.0))[0]
        if inliers.shape[0] < 3:
            raise ValueError("Unable to detect floor plane")
        return (
            PlaneModel(normal=_as_float_tuple(normal.tolist(), 3), d=float(d)),
            inliers,
        )

    candidates.sort(key=lambda item: (item[0], item[1]))
    _, _, normal, d, inliers = candidates[0]
    return PlaneModel(normal=_as_float_tuple(normal.tolist(), 3), d=float(d)), inliers


def _build_floor_polygon(points_xz: np.ndarray, params: StageBParams) -> Polygon:
    if points_xz.shape[0] < 3:
        raise ValueError("Not enough floor inliers to build floor polygon")

    alpha_geometry = None
    try:
        alpha_geometry = alphashape.alphashape(points_xz, params.floor_alpha)
    except Exception:
        alpha_geometry = None

    polygon = _pick_polygon(alpha_geometry)
    if polygon is None or not polygon.is_valid or polygon.area <= 0:
        polygon = _pick_polygon(MultiPoint(points_xz).convex_hull)

    if polygon is None or polygon.area <= 0:
        raise ValueError("Failed to build floor polygon")

    if params.floor_polygon_simplify_m > 0:
        simplified = _pick_polygon(polygon.simplify(params.floor_polygon_simplify_m, preserve_topology=True))
        if simplified is not None and simplified.area > 0:
            polygon = simplified

    cleaned = _pick_polygon(polygon.buffer(0))
    if cleaned is not None and cleaned.area > 0:
        polygon = cleaned

    return orient(polygon, sign=1.0)


def _polygon_coords_xz(polygon: Polygon) -> list[tuple[float, float]]:
    coords = [(float(x), float(z)) for x, z in list(polygon.exterior.coords)[:-1]]
    if len(coords) < 3:
        raise ValueError("Polygon must have at least three vertices")
    return coords


def _obstacle_search_region(floor_polygon: Polygon, wall_clearance_m: float) -> Polygon:
    if wall_clearance_m <= 0:
        return floor_polygon
    interior = _pick_polygon(floor_polygon.buffer(-wall_clearance_m, join_style=2))
    if interior is None or interior.area <= 0:
        return floor_polygon
    return interior


def _footprint_major_minor(footprint: Polygon) -> tuple[float, float]:
    rectangle = footprint.minimum_rotated_rectangle
    coordinates = list(rectangle.exterior.coords)
    if len(coordinates) < 5:
        return 0.0, 0.0

    edge_lengths = []
    for idx in range(4):
        x1, y1 = coordinates[idx]
        x2, y2 = coordinates[idx + 1]
        edge_lengths.append(float(np.hypot(x2 - x1, y2 - y1)))
    edge_lengths = [length for length in edge_lengths if length > 1e-6]
    if not edge_lengths:
        return 0.0, 0.0
    return max(edge_lengths), min(edge_lengths)


def _classify_obstacle(footprint: Polygon, floor_polygon: Polygon, height_m: float) -> ObstacleSemanticModel:
    area_m2 = float(footprint.area)
    major_m, minor_m = _footprint_major_minor(footprint)
    wall_distance_m = float(footprint.distance(floor_polygon.boundary))
    aspect_ratio = major_m / max(minor_m, 1e-3)

    if major_m >= 1.7 and minor_m >= 0.75 and area_m2 >= 1.1 and aspect_ratio <= 3.5 and height_m <= 1.2:
        return ObstacleSemanticModel(label="bed", confidence=0.8)
    if wall_distance_m <= 0.45 and major_m >= 1.0 and minor_m >= 0.35 and area_m2 >= 0.35 and height_m <= 1.4:
        return ObstacleSemanticModel(label="kitchen", confidence=0.68)
    if major_m >= 1.1 and minor_m >= 0.5 and area_m2 >= 0.45 and height_m <= 1.3:
        return ObstacleSemanticModel(label="table", confidence=0.56)
    if wall_distance_m <= 0.35 and major_m >= 0.6 and area_m2 >= 0.18:
        return ObstacleSemanticModel(label="storage", confidence=0.5)
    return ObstacleSemanticModel(label="unknown", confidence=0.3)


def _extract_obstacles(
    points: np.ndarray,
    floor_plane: PlaneModel,
    floor_polygon: Polygon,
    params: StageBParams,
) -> list[ObstacleModel]:
    floor_area = float(floor_polygon.area)
    normal = np.asarray(floor_plane.normal, dtype=float)
    d = float(floor_plane.d)
    signed_distance = points @ normal + d
    height_mask = (signed_distance > params.obstacle_height_threshold_m) & (signed_distance <= params.obstacle_max_height_m)
    candidate_points = points[height_mask]
    candidate_heights = signed_distance[height_mask]
    if candidate_points.shape[0] < params.obstacle_min_cluster_points:
        return []

    obstacle_region = _obstacle_search_region(
        floor_polygon=floor_polygon,
        wall_clearance_m=params.obstacle_wall_clearance_m,
    )
    interior_mask = contains_xy(obstacle_region, candidate_points[:, 0], candidate_points[:, 2])
    candidate_points = candidate_points[interior_mask]
    candidate_heights = candidate_heights[interior_mask]
    if candidate_points.shape[0] < params.obstacle_min_cluster_points:
        return []

    clustered_pcd = _to_pcd(candidate_points)
    labels = np.asarray(
        clustered_pcd.cluster_dbscan(
            eps=params.dbscan_eps_m,
            min_points=params.dbscan_min_points,
            print_progress=False,
        ),
        dtype=int,
    )
    if labels.size == 0:
        return []

    obstacle_rows: list[dict[str, Any]] = []
    for label in sorted(np.unique(labels)):
        if label < 0:
            continue
        cluster_mask = labels == label
        cluster = candidate_points[cluster_mask]
        cluster_heights = candidate_heights[cluster_mask]
        if cluster.shape[0] < params.obstacle_min_cluster_points:
            continue

        cluster_pcd = _to_pcd(cluster)
        try:
            obb = cluster_pcd.get_oriented_bounding_box()
            obb_center = _as_float_tuple(obb.center.tolist(), 3)
            obb_extent = _as_float_tuple(obb.extent.tolist(), 3)
            obb_rotation = tuple(_as_float_tuple(row.tolist(), 3) for row in obb.R)
        except RuntimeError:
            # Degenerate (near-coplanar) clusters can fail OBB fitting in qhull; use AABB fallback.
            aabb = cluster_pcd.get_axis_aligned_bounding_box()
            obb = aabb.get_oriented_bounding_box()
            obb_center = _as_float_tuple(aabb.get_center().tolist(), 3)
            obb_extent = _as_float_tuple(aabb.get_extent().tolist(), 3)
            obb_rotation = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
        obb_points = np.asarray(obb.get_box_points())
        footprint = _pick_polygon(MultiPoint(obb_points[:, [0, 2]]).convex_hull)
        if footprint is None or footprint.area <= params.min_obstacle_area_m2:
            continue
        if not floor_polygon.intersects(footprint):
            continue

        clipped = footprint.intersection(floor_polygon)
        clipped_polygon = _pick_polygon(clipped)
        if clipped_polygon is None or clipped_polygon.area <= params.min_obstacle_area_m2:
            continue
        if floor_area > 0 and (clipped_polygon.area / floor_area) > params.max_obstacle_floor_coverage:
            continue

        clipped_polygon = orient(clipped_polygon, sign=1.0)
        centroid = clipped_polygon.centroid
        height_m = float(np.percentile(cluster_heights, 95.0) - np.percentile(cluster_heights, 5.0))
        semantic = _classify_obstacle(
            footprint=clipped_polygon,
            floor_polygon=floor_polygon,
            height_m=max(height_m, 0.0),
        )
        obstacle_rows.append(
            {
                "centroid": (float(centroid.x), float(centroid.y)),
                "footprint_xz": _polygon_coords_xz(clipped_polygon),
                "obb_center": obb_center,
                "obb_extent": obb_extent,
                "obb_rotation": obb_rotation,
                "semantic": semantic,
            }
        )

    obstacle_rows.sort(key=lambda row: (row["centroid"][0], row["centroid"][1]))
    obstacles: list[ObstacleModel] = []
    for idx, row in enumerate(obstacle_rows, start=1):
        obstacles.append(
            ObstacleModel(
                id=f"obs_{idx:03d}",
                footprint_xz=row["footprint_xz"],
                obb=OBBModel(
                    center=row["obb_center"],
                    extent=row["obb_extent"],
                    rotation=row["obb_rotation"],  # type: ignore[arg-type]
                ),
                semantic=row["semantic"],
            )
        )
    return obstacles


def derive_scene_graph(mesh: trimesh.Trimesh, params: StageBParams | None = None) -> SceneGraphModel:
    if params is None:
        params = StageBParams()
    try:
        o3d.utility.random.seed(params.random_seed)
    except Exception:
        pass

    sampled_points = _sample_surface_points(mesh=mesh, count=params.sample_points_n, seed=params.random_seed)
    downsampled_points = _voxel_downsample(points=sampled_points, voxel_size_m=params.voxel_size_m)

    floor_plane, floor_inliers = _find_floor_plane(points=downsampled_points, params=params)
    normal = np.asarray(floor_plane.normal, dtype=float)
    d = float(floor_plane.d)
    signed_distance = downsampled_points @ normal + d
    support_mask = (signed_distance >= -(params.floor_ransac_distance_m * 2.0)) & (
        signed_distance <= params.floor_support_max_height_m
    )
    floor_support_points = downsampled_points[support_mask]
    if floor_support_points.shape[0] < 3:
        floor_support_points = downsampled_points[floor_inliers]
    floor_polygon = _build_floor_polygon(points_xz=floor_support_points[:, [0, 2]], params=params)
    obstacles = _extract_obstacles(
        points=downsampled_points,
        floor_plane=floor_plane,
        floor_polygon=floor_polygon,
        params=params,
    )

    bounds_min = _as_float_tuple(mesh.bounds[0].tolist(), 3)
    bounds_max = _as_float_tuple(mesh.bounds[1].tolist(), 3)
    room = RoomModel(
        floor_plane=floor_plane,
        floor_polygon_xz=_polygon_coords_xz(floor_polygon),
        bounds_aabb=AABBModel(min=bounds_min, max=bounds_max),
    )
    return SceneGraphModel(units="meters", room=room, obstacles=obstacles)
