"use client";

import { Suspense, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Bounds, Edges, Line, OrbitControls, useGLTF } from "@react-three/drei";

import { cn } from "@/lib/utils";
import type { PlacementCandidate } from "@/lib/types";

type ModelViewerProps = {
  modelUrl?: string;
  placements?: PlacementCandidate[] | null;
  className?: string;
};

function Model({ url }: { url: string }) {
  const gltf = useGLTF(url);
  return <primitive object={gltf.scene} />;
}

function PlacementMarkers({ placements, highlighted }: { placements: PlacementCandidate[]; highlighted?: boolean }) {
  const baseColor = "#0ea5e9";
  const highlightColor = "#38bdf8";

  return (
    <group>
      {placements.slice(0, 1).map((candidate, index) => {
        const [x, y, z] = candidate.pos;
        const size = candidate.size_m ?? [0.6, 0.6, 0.6];
        const [width, depth, height] = size;
        const clearance = candidate.clearance_m ?? 0;
        const isFlatPlacement = candidate.render_mode === "plane" || height <= 0.08;
        const boxCenterY = y + height / 2;
        const clearanceWidth = width + clearance * 2;
        const clearanceDepth = depth + clearance * 2;
        const color = highlighted ? highlightColor : baseColor;
        const fillOpacity = highlighted ? 0.18 : 0.06;
        const edgeOpacity = highlighted ? 1.0 : 0.7;

        return (
          <group key={`${x}-${y}-${z}-${candidate.yaw_rad}-${index}`}>
            {/* Clearance zone (subtle fill) */}
            {clearance > 0 && (
              <mesh position={[x, isFlatPlacement ? y + 0.006 : boxCenterY, z]} rotation={[0, -candidate.yaw_rad, 0]}>
                <boxGeometry args={[clearanceWidth, isFlatPlacement ? 0.01 : Math.max(height, 0.02), clearanceDepth]} />
                <meshStandardMaterial color={color} transparent opacity={highlighted ? 0.08 : 0.03} depthWrite={false} />
              </mesh>
            )}

            {isFlatPlacement ? (
              <>
                {/* Flat plane fill */}
                <mesh position={[x, y + 0.012, z]} rotation={[-Math.PI / 2, 0, -candidate.yaw_rad]}>
                  <planeGeometry args={[width, depth]} />
                  <meshStandardMaterial color={color} transparent opacity={fillOpacity} side={2} depthWrite={false} />
                </mesh>
                {/* Flat plane wireframe outline */}
                <Line
                  points={[
                    [x - width / 2, y + 0.014, z - depth / 2],
                    [x + width / 2, y + 0.014, z - depth / 2],
                    [x + width / 2, y + 0.014, z + depth / 2],
                    [x - width / 2, y + 0.014, z + depth / 2],
                    [x - width / 2, y + 0.014, z - depth / 2]
                  ].map(([px, py, pz]) => {
                    const dx = px - x;
                    const dz = pz - z;
                    const cos = Math.cos(candidate.yaw_rad);
                    const sin = Math.sin(candidate.yaw_rad);
                    return [x + dx * cos - dz * sin, py, z + dx * sin + dz * cos] as [number, number, number];
                  })}
                  color={color}
                  lineWidth={highlighted ? 2.5 : 1.6}
                />
              </>
            ) : (
              <>
                {/* Box: subtle transparent fill + wireframe edges */}
                <mesh position={[x, boxCenterY, z]} rotation={[0, -candidate.yaw_rad, 0]}>
                  <boxGeometry args={[width, height, depth]} />
                  <meshStandardMaterial
                    color={color}
                    transparent
                    opacity={fillOpacity}
                    depthWrite={false}
                  />
                  <Edges
                    threshold={15}
                    color={color}
                    lineWidth={highlighted ? 2.5 : 1.5}
                    opacity={edgeOpacity}
                    transparent
                  />
                </mesh>
              </>
            )}
          </group>
        );
      })}
    </group>
  );
}

export function ModelViewer({ modelUrl, placements, className }: ModelViewerProps) {
  const [hovered, setHovered] = useState(false);

  if (!modelUrl) {
    return (
      <div className={cn("flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed bg-white text-sm text-muted-foreground", className)}>
        Provide a model path and import a scene.
      </div>
    );
  }

  return (
    <div className={cn("relative min-h-0 flex-1 overflow-hidden rounded-lg border", className)}>
      <Canvas className="h-full w-full" camera={{ position: [4, 3.5, 4], fov: 50 }}>
        <color attach="background" args={["#ffffff"]} />
        <ambientLight intensity={1.05} />
        <directionalLight position={[6, 8, 2]} intensity={1.6} />
        <Suspense fallback={null}>
          <Bounds fit clip observe margin={1.1}>
            <group key={modelUrl} scale={1}>
              <Model url={modelUrl} />
            </group>
          </Bounds>
        </Suspense>
        {placements && placements.length > 0 ? <PlacementMarkers placements={placements} highlighted={hovered} /> : null}
        <gridHelper args={[12, 24, "#e5e7eb", "#f3f4f6"]} />
        <OrbitControls makeDefault />
      </Canvas>
      {placements && placements.length > 0 ? (
        <div
          className={cn(
            "absolute left-3 top-3 cursor-pointer rounded-md border px-3 py-2 text-xs shadow-sm backdrop-blur transition-all",
            hovered
              ? "border-sky-400/60 bg-sky-50/95 shadow-md"
              : "border-border bg-white/90"
          )}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div className={cn("font-medium", hovered ? "text-sky-700" : "text-foreground")}>Placement preview</div>
          <div className={cn("mt-1", hovered ? "text-sky-600/80" : "text-muted-foreground")}>Showing best placement in 3D</div>
        </div>
      ) : null}
    </div>
  );
}
