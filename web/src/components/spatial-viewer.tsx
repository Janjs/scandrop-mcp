"use client";

import { useMemo } from "react";
import { Shape, Vector2 } from "three";
import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls, Text } from "@react-three/drei";

import { cn } from "@/lib/utils";

import type { SceneGraph } from "@/lib/types";

type SpatialViewerProps = {
  sceneGraph: SceneGraph | null;
  className?: string;
};

function polygonToShape(points: Array<[number, number]>, centerX: number, centerZ: number): Shape {
  // ShapeGeometry sits in XY then is rotated into XZ; invert Z here so fill aligns with line paths.
  const vectors = points.map(([x, z]) => new Vector2(x - centerX, -(z - centerZ)));
  vectors.reverse();
  const shape = new Shape(vectors);
  shape.autoClose = true;
  return shape;
}

function semanticColor(label?: string): string {
  switch (label) {
    case "bed":
      return "#93c5fd";
    case "kitchen":
      return "#fca5a5";
    case "table":
      return "#86efac";
    case "storage":
      return "#c4b5fd";
    default:
      return "#d1d5db";
  }
}

function semanticDisplayLabel(label?: string): string {
  if (!label) {
    return "unknown";
  }
  return label.replace(/_/g, " ");
}

export function SpatialViewer({ sceneGraph, className }: SpatialViewerProps) {
  const geometry = useMemo(() => {
    if (!sceneGraph) {
      return null;
    }
    const floor = sceneGraph.room.floor_polygon_xz;
    const centerX = floor.reduce((sum, [x]) => sum + x, 0) / floor.length;
    const centerZ = floor.reduce((sum, [, z]) => sum + z, 0) / floor.length;
    const minX = Math.min(...floor.map(([x]) => x));
    const maxX = Math.max(...floor.map(([x]) => x));
    const minZ = Math.min(...floor.map(([, z]) => z));
    const maxZ = Math.max(...floor.map(([, z]) => z));
    const span = Math.max(maxX - minX, maxZ - minZ);
    const gridSize = Math.max(8, Math.ceil(span + 2));
    const semanticCounts = sceneGraph.obstacles.reduce<Record<string, number>>((acc, obstacle) => {
      const label = semanticDisplayLabel(obstacle.semantic?.label);
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {});
    return {
      centerX,
      centerZ,
      gridSize,
      semanticCounts,
      floorPath: floor.map(([x, z]) => [x - centerX, 0, z - centerZ] as [number, number, number]),
      floorShape: polygonToShape(floor, centerX, centerZ),
      obstacleShapes: sceneGraph.obstacles.map((obstacle) => ({
        id: obstacle.id,
        semanticLabel: semanticDisplayLabel(obstacle.semantic?.label),
        color: semanticColor(obstacle.semantic?.label),
        shape: polygonToShape(obstacle.footprint_xz, centerX, centerZ),
        path: obstacle.footprint_xz.map(([x, z]) => [x - centerX, 0.04, z - centerZ] as [number, number, number]),
        labelAnchor: obstacle.footprint_xz.reduce(
          (acc, [x, z]) => [acc[0] + (x - centerX), acc[1] + (z - centerZ)] as [number, number],
          [0, 0] as [number, number]
        ).map((value) => value / obstacle.footprint_xz.length) as [number, number]
      }))
    };
  }, [sceneGraph]);

  if (!geometry) {
    return (
      <div
        className={cn(
          "flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed bg-white text-sm text-muted-foreground",
          className
        )}
      >
        Spatial geometry appears after scene import.
      </div>
    );
  }

  return (
    <div className={cn("relative flex min-h-0 flex-1 overflow-hidden rounded-lg border", className)}>
      <Canvas camera={{ position: [0, 10, 0.01], fov: 48 }} style={{ height: "100%", width: "100%" }}>
        <color attach="background" args={["#ffffff"]} />
        <ambientLight intensity={0.9} />
        <directionalLight position={[4, 10, 8]} intensity={1.5} />

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <shapeGeometry args={[geometry.floorShape]} />
          <meshStandardMaterial color="#e5e7eb" transparent opacity={0.7} />
        </mesh>
        <Line points={[...geometry.floorPath, geometry.floorPath[0]]} color="#9ca3af" lineWidth={1.5} />

        {geometry.obstacleShapes.map((obstacle, idx) => (
          <group key={obstacle.id}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03 + idx * 0.001, 0]}>
              <shapeGeometry args={[obstacle.shape]} />
              <meshStandardMaterial color={obstacle.color} transparent opacity={0.9} />
            </mesh>
            <Line points={[...obstacle.path, obstacle.path[0]]} color="#4b5563" lineWidth={1.2} />
            <Text
              position={[obstacle.labelAnchor[0], 0.09, obstacle.labelAnchor[1]]}
              fontSize={0.18}
              color="#111827"
              rotation={[-Math.PI / 2, 0, 0]}
              anchorX="center"
              anchorY="middle"
            >
              {obstacle.semanticLabel}
            </Text>
          </group>
        ))}

        <gridHelper args={[geometry.gridSize, geometry.gridSize * 2, "#e5e7eb", "#f3f4f6"]} />
        <OrbitControls makeDefault enableRotate={false} maxPolarAngle={0.001} minPolarAngle={0.001} />
      </Canvas>
      <div className="pointer-events-none absolute left-3 top-3 rounded-md border bg-white/85 px-3 py-2 text-xs shadow-sm backdrop-blur">
        <div className="font-medium text-foreground">Detected semantics</div>
        <div className="mt-1 space-y-0.5 text-muted-foreground">
          {Object.entries(geometry.semanticCounts).length === 0 ? (
            <div>none</div>
          ) : (
            Object.entries(geometry.semanticCounts)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([label, count]) => (
                <div key={label}>
                  {label}: {count}
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}
