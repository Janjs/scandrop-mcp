export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export type PlacementCandidate = {
  pos: Vec3;
  yaw_rad: number;
  score?: number;
  notes?: string[];
  size_m?: Vec3;
  clearance_m?: number;
  render_mode?: "box" | "plane";
};

export type SceneGraph = {
  units: "meters";
  room: {
    floor_plane: {
      normal: Vec3;
      d: number;
    };
    floor_polygon_xz: Vec2[];
    bounds_aabb: {
      min: Vec3;
      max: Vec3;
    };
  };
  obstacles: Array<{
    id: string;
    footprint_xz: Vec2[];
    obb: {
      center: Vec3;
      extent: Vec3;
      rotation: [Vec3, Vec3, Vec3];
    };
    semantic?: {
      label: string;
      confidence: number;
    } | null;
  }>;
};

export type SceneSummary = {
  bounds_aabb: {
    min: Vec3;
    max: Vec3;
  };
  floor_area_m2: number;
  obstacle_count: number;
};
