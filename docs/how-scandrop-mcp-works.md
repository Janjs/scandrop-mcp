# How the Scandrop MCP Server Works

This document explains the server flow end-to-end, with extra focus on how a `.glb/.gltf` model becomes JSON.

## 1) Entry Points

The MCP server is started from `scandrop/main.py`, which runs `FastMCP` from `scandrop/mcp_tools.py`.

Main ingestion tools:

- `create_scene_from_gltf(path)`
- `onboard_scene(path)` (same ingestion, plus status + summary in one response)

Both call:

- `create_scene_from_gltf(...)` in `scandrop/pipeline/import_gltf.py`

## 2) What “GLB to JSON” Means Here

Scandrop does **not** convert the full raw mesh (all vertices/faces/materials) directly into JSON.

Instead, it:

1. Loads and merges geometry from the GLB/GLTF into a single mesh.
2. Runs geometry analysis to derive a compact spatial representation.
3. Saves that derived representation as `scene_graph.json`.

So the output JSON is a **derived scene graph** (room boundary, floor plane, obstacles), not a full glTF dump.

## 3) Step-by-Step Conversion Pipeline

### Step A: Load and merge mesh

`load_merged_mesh(path)` in `scandrop/pipeline/import_gltf.py`:

- Validates file exists and extension is `.glb` or `.gltf`
- Loads with `trimesh.load(..., force="scene")`
- If input is a scene: concatenates geometry into one `Trimesh`
- Removes unreferenced vertices
- Fails early on empty/invalid geometry

### Step B: Derive scene graph from mesh

`derive_scene_graph(mesh, params)` in `scandrop/pipeline/stage_b.py` turns one merged mesh into `SceneGraphModel`: floor plane, floor outline in XZ, obstacle boxes and labels, and room AABB.

**End-to-end flow (what happens, in order).** The mesh becomes a large set of points on its outer surface. Those points are thinned. An infinite **floor plane** is estimated with RANSAC. Points that sit in a thin band around that plane define the **walkable floor region** in top view (polygon). Points clearly above the floor and inside a slightly shrunken version of that region are grouped into **clusters**; each cluster becomes one obstacle with a 3D box and a simple tag. Finally, the **original mesh bounding box** is copied through as `bounds_aabb` (whole model extent, not just the floor).

Each subsection below uses the same pattern: **purpose** (why the step exists), **how** (what the code actually does), **output / next step** (what downstream logic consumes).

#### B0 — Fix randomness (`open3d.utility.random.seed`)

- **Purpose:** Same mesh and `StageBParams` should yield the same scene graph; Open3D uses randomness inside plane RANSAC.
- **How:** `open3d.utility.random.seed(params.random_seed)` before other Open3D work. Surface sampling uses a separate NumPy RNG with the same seed.
- **Output / next:** Reproducible behavior for all randomized Open3D calls in this pipeline.

#### B1 — Surface sampling (`_sample_surface_points`, trimesh + NumPy)

- **Purpose:** Later stages reason over a **point cloud**, not triangle indices. Sampling caps cost (`sample_points_n`, default 250k) while still covering the surface.
- **How:** Triangle areas define a probability distribution (big faces get more samples). For each sample, pick a triangle at random from that distribution, then pick a random point **inside** that triangle with uniform barycentric sampling (two random numbers → weights on the three vertices).
- **Output / next:** An `N×3` array of world-space points on the mesh surface → voxel downsampling.

#### B2 — Wrap points for Open3D (`_to_pcd`)

- **Purpose:** Open3D algorithms expect `open3d.geometry.PointCloud`, not a raw NumPy array.
- **How:** `PointCloud()` plus `pcd.points = open3d.utility.Vector3dVector(points)`.
- **Output / next:** A point cloud object used by `voxel_down_sample`, `segment_plane`, `cluster_dbscan`, and OBB helpers.

#### B3 — Voxel downsampling (`voxel_down_sample`)

- **Purpose:** Speed and stability: far fewer points, roughly preserving empty vs occupied space.
- **How:** Partition space into cubes of edge length `voxel_size_m`. All points falling in the same cube collapse to one representative point. If the result were empty, the implementation keeps the input cloud.
- **Output / next:** A smaller point set used for floor detection, floor polygon support, and obstacles.

#### B4 — Floor plane (`_find_floor_plane`, `segment_plane` + RANSAC)

- **Purpose:** Define “height relative to floor” and separate floor-aligned geometry from vertical walls and objects. Persisted as `room.floor_plane` (`normal`, `d` with unit normal).
- **How:**

  1. Build a `PointCloud` from points not yet assigned to a found plane.
  2. `segment_plane(distance_threshold, ransac_n=3, num_iterations)` implements **RANSAC** (Random Sample Consensus): repeat many times — pick 3 random points, fit the plane through them, count **inliers** (points within `distance_threshold` perpendicular distance). Keep the plane with the most inliers this round.
  3. Remove those inliers from the working set and run again (up to `max_ransac_planes`) so secondary planes (e.g. walls) can be peeled away.
  4. Keep planes whose normal is nearly world-up (`floor_min_up_dot` vs +Y). Among those, pick the **lowest** floor by median height of inliers; prefer more inliers if heights tie.
  5. If no valid plane, fall back: horizontal plane at a low Y percentile, inliers = points close to that plane.

  Open3D returns `[a,b,c,d]` for \(a x + b y + c z + d = 0\). The code normalizes \((a,b,c)\) to length 1 and adjusts \(d\) so `PlaneModel` always stores a unit normal.

- **Output / next:** `PlaneModel` + inlier indices; signed distance `points @ normal + d` for every downsampled point drives floor support masking and obstacle height filters.

#### B5 — Floor support band and polygon (`derive_scene_graph` + `_build_floor_polygon`)

- **Purpose:** The plane is infinite; tools need a **finite floor outline** in XZ (`floor_polygon_xz`).
- **How:** Mark downsampled points whose signed distance to the plane lies between slightly below the plane (within `2 * floor_ransac_distance_m`) and `floor_support_max_height_m` above — that band captures the floor slab and low furniture tops without grabbing the ceiling. If too few points, reuse RANSAC floor inliers. Take \((x,z)\) of those points.

  `_build_floor_polygon`: try **alpha shape** on those 2D points (can follow concave room outlines). On failure, use Shapely `MultiPoint.convex_hull`. Optional `simplify`, `buffer(0)` repair, `orient` for consistent winding.

- **Output / next:** One Shapely `Polygon` for the room floor in XZ → obstacle filtering (must sit on floor) and footprint clipping.

#### B6 — Obstacle candidate points (`_extract_obstacles` filtering)

- **Purpose:** Restrict to points that look like **upright objects** (not floor, not ceiling), and ignore the outer strip near walls if configured.
- **How:** Keep points with signed height above the plane in `(obstacle_height_threshold_m, obstacle_max_height_m]`. Build an **inner** floor region: floor polygon eroded by `obstacle_wall_clearance_m`. Keep points whose \((x,z)\) lies in that region (`shapely.contains_xy`). Require enough points to matter (`obstacle_min_cluster_points`).
- **Output / next:** Subset of the downsampled cloud → DBSCAN.

#### B7 — Clustering (`cluster_dbscan`)

- **Purpose:** Split mixed obstacle points into **one cluster per object** (approximately).
- **How:** **DBSCAN**: points within `eps` meters are neighbors; a cluster grows by chaining neighbors; a point needs at least `min_points` neighbors to be **core** and seed a cluster. Noise gets label `-1` and is skipped. Implemented as `PointCloud.cluster_dbscan` in Open3D.
- **Output / next:** Integer label per point; each label ≥ 0 is one obstacle candidate.

#### B8 — Boxes and footprints (OBB + Shapely)

- **Purpose:** JSON stores a tight 3D box per obstacle (`obb`) and a 2D floor footprint for placement checks.
- **How:** For each cluster, `get_oriented_bounding_box()` → center, `extent`, rotation `R`. Degenerate clusters may throw; then `get_axis_aligned_bounding_box()` and identity rotation. Corners from `get_box_points()` projected to XZ; convex hull = rough footprint. Intersect footprint with the **full** floor polygon; drop tiny polygons or ones covering too much of the floor (`max_obstacle_floor_coverage`).
- **Output / next:** Geometry for each obstacle row before labeling.

#### B9 — Semantic labels (`_classify_obstacle`)

- **Purpose:** Cheap, interpretable tags (`bed`, `table`, …) without training a model.
- **How:** Fixed thresholds on footprint area, major/minor axis lengths (from minimum rotated rectangle), cluster height spread, distance from footprint to floor boundary.
- **Output / next:** `ObstacleSemanticModel` per obstacle.

#### B10 — IDs and room AABB

- **Purpose:** Stable `obs_001`, `obs_002`, … and a global extent for the scene.
- **How:** Sort obstacles by footprint centroid \((x,z)\) before assigning IDs. `bounds_aabb` is `mesh.bounds` from the **original** trimesh (full model), not from the point cloud.
- **Output / next:** Final `SceneGraphModel` for persistence.

**Quick reference — Open3D APIs touched in Step B**

| Step | Open3D (or helper) |
|------|----------------------|
| B2–B3 | `PointCloud`, `Vector3dVector`, `voxel_down_sample` |
| B4 | `segment_plane` (RANSAC plane) |
| B7 | `cluster_dbscan` |
| B8 | `get_oriented_bounding_box`, `get_axis_aligned_bounding_box`, `get_box_points` |

### Step C: Persist as JSON artifacts

`FileSceneStore.save_scene_graph(...)` in `scandrop/store.py` writes:

- `data/scenes/{scene_id}/v{version}/scene_graph.json`
- `data/scenes/{scene_id}/v{version}/params.json`

It also updates `manifest.json` status to `ready` (or `error` if pipeline failed).

## 4) JSON Shape Produced

`scene_graph.json` follows `SceneGraphModel` in `scandrop/schemas.py`:

```json
{
  "units": "meters",
  "room": {
    "floor_plane": { "normal": [0, 1, 0], "d": -0.02 },
    "floor_polygon_xz": [[x, z], [x, z], [x, z]],
    "bounds_aabb": {
      "min": [x, y, z],
      "max": [x, y, z]
    }
  },
  "obstacles": [
    {
      "id": "obs_001",
      "footprint_xz": [[x, z], [x, z], [x, z]],
      "obb": {
        "center": [x, y, z],
        "extent": [x, y, z],
        "rotation": [[r11, r12, r13], [r21, r22, r23], [r31, r32, r33]]
      },
      "semantic": { "label": "bed", "confidence": 0.8 }
    }
  ]
}
```

## 5) Why This Design

The MCP tools (`check_fit`, `find_free_spaces`) need fast, deterministic spatial reasoning.  
Using a compact derived graph is much faster and more stable than reasoning over the full raw mesh every time.

Determinism is reinforced by:

- fixed random seed (`StageBParams.random_seed`, default `42`)
- deterministic obstacle sorting before ID assignment (`obs_001`, `obs_002`, ...)

## 6) Quick Trace of a Typical Request

`onboard_scene("/path/to/model.glb")`:

1. MCP tool validates request.
2. `import_gltf.create_scene_from_gltf` creates new scene/version in store.
3. Mesh is loaded/merged from GLB.
4. `stage_b.derive_scene_graph` computes floor + obstacles.
5. JSON artifacts are written to disk.
6. Tool returns `{ scene_id, version, status, summary }`.
