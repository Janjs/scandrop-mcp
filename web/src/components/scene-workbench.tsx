"use client";

import { useEffect, useMemo, useState } from "react";
import { Braces, Loader2, Plus, RefreshCcw, UploadCloud } from "lucide-react";

import type { PlacementCandidate, SceneGraph, SceneSummary } from "@/lib/types";
import { ChatPanel } from "@/components/chat-panel";
import { ModelViewer } from "@/components/model-viewer";
import { SpatialViewer } from "@/components/spatial-viewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type ImportResponse = {
  scene_id: string;
  version: number;
  model_path?: string;
};

type ProcessingStage = "idle" | "uploading" | "processing" | "loading_scene" | "ready" | "error";

function isSupportedModelFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  return lowerName.endsWith(".glb") || lowerName.endsWith(".gltf");
}

export function SceneWorkbench() {
  const [chatResetToken, setChatResetToken] = useState(0);
  const [sceneId, setSceneId] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [uploadedModelPath, setUploadedModelPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<SceneSummary | null>(null);
  const [sceneGraph, setSceneGraph] = useState<SceneGraph | null>(null);
  const [placementCandidates, setPlacementCandidates] = useState<PlacementCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [processingStage, setProcessingStage] = useState<ProcessingStage>("idle");
  const [viewMode, setViewMode] = useState<"model" | "spatial">("model");
  const [jsonOpen, setJsonOpen] = useState(false);

  useEffect(() => {
    // try formatting string
    fetch("/test.glb")
      .then(async (res) => {
        if (!res.ok) return;
        const blob = await res.blob();
        const file = new File([blob], "test.glb", { type: "model/gltf-binary" });
        setFile(file);
      })
      .catch((err) => console.error("Failed to default model on load", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const modelUrl = useMemo(() => {
    if (!uploadedModelPath) {
      return undefined;
    }
    return `/api/model?path=${encodeURIComponent(uploadedModelPath)}`;
  }, [uploadedModelPath]);

  const hasUploadedScene = Boolean(sceneId && uploadedModelPath && sceneGraph && processingStage === "ready");

  function setFile(file: File | null): void {
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (!isSupportedModelFile(file)) {
      setError("Unsupported file type. Upload a .glb or .gltf file.");
      return;
    }
    setError(null);
    setSelectedFile(file);
    void uploadSceneFile(file);
  }

  function resetScene(): void {
    setChatResetToken((value) => value + 1);
    setPlacementCandidates(null);
    setSceneId(null);
    setVersion(null);
    setUploadedModelPath(null);
    setSelectedFile(null);
    setSummary(null);
    setSceneGraph(null);
    setBusy(false);
    setError(null);
    setDragActive(false);
    setProcessingStage("idle");
  }

  async function loadScene(sceneIdToLoad: string): Promise<void> {
    const [summaryResponse, graphResponse] = await Promise.all([
      fetch(`/api/scenes/${sceneIdToLoad}/summary`, { cache: "no-store" }),
      fetch(`/api/scenes/${sceneIdToLoad}/graph`, { cache: "no-store" })
    ]);
    if (!summaryResponse.ok || !graphResponse.ok) {
      throw new Error("Failed to load scene context.");
    }
    const summaryJson = (await summaryResponse.json()) as SceneSummary;
    const graphJson = (await graphResponse.json()) as SceneGraph;
    setSummary(summaryJson);
    setSceneGraph(graphJson);
  }

  async function uploadSceneFile(fileArg?: File): Promise<void> {
    const file = fileArg ?? selectedFile;
    if (!file) {
      setError("Choose a GLB/GLTF file first.");
      return;
    }

    setBusy(true);
    setError(null);
    setProcessingStage("uploading");
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/scenes/import", {
        method: "POST",
        body: formData
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Scene upload failed.");
      }
      setProcessingStage("processing");
      const payload = (await response.json()) as ImportResponse;
      setSceneId(payload.scene_id);
      setPlacementCandidates(null);
      setVersion(payload.version);
      setUploadedModelPath(payload.model_path ?? null);
      setProcessingStage("loading_scene");
      await loadScene(payload.scene_id);
      setProcessingStage("ready");
    } catch (err) {
      setProcessingStage("error");
      setError(err instanceof Error ? err.message : "Unknown upload error");
    } finally {
      setBusy(false);
    }
  }

  async function refreshScene(): Promise<void> {
    if (!sceneId) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setProcessingStage("loading_scene");
      await loadScene(sceneId);
      setProcessingStage("ready");
    } catch (err) {
      setProcessingStage("error");
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  const stageItems: Array<{ id: ProcessingStage; label: string }> = [
    { id: "uploading", label: "Uploading file" },
    { id: "processing", label: "Processing geometry" },
    { id: "loading_scene", label: "Loading scene data" }
  ];

  function isStageDone(stage: ProcessingStage): boolean {
    const order: ProcessingStage[] = ["idle", "uploading", "processing", "loading_scene", "ready", "error"];
    return order.indexOf(processingStage) > order.indexOf(stage);
  }

  return (
    <main className="h-dvh overflow-hidden bg-muted/30">
      <div className="grid h-full overflow-hidden border bg-background lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="flex min-h-0 flex-col border-r">
          <header className="flex h-16 items-center justify-between border-b px-4 md:px-6">
            <div className="flex items-center gap-3">
              <div className="text-lg font-semibold">Scandrop</div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{summary ? `Scan v${version ?? 1} · ${summary.floor_area_m2.toFixed(1)} m²` : "No scan imported"}</span>
                {sceneId ? <Badge variant="secondary">scene {sceneId}</Badge> : null}
                {version ? <Badge variant="outline">v{version}</Badge> : null}
                {summary ? <Badge variant="outline">{summary.obstacle_count} obstacles</Badge> : null}
              </div>
            </div>
            {hasUploadedScene ? (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={resetScene}>
                  <Plus className="h-4 w-4" />
                  New Scene
                </Button>
                <Button size="sm" variant="outline" disabled={busy || !sceneId} onClick={() => void refreshScene()}>
                  <RefreshCcw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>
            ) : null}
          </header>

          <div className="flex min-h-0 flex-1">
            {!hasUploadedScene ? (
              <Card className="flex min-h-0 flex-1 flex-col rounded-none border-0 shadow-none">
                <CardContent className="flex min-h-0 flex-1 flex-col justify-center space-y-6 p-6">
                  <div
                    className={`relative flex min-h-0 flex-1 flex-col items-center justify-center rounded-md border-2 border-dashed p-8 text-center ${dragActive ? "border-primary bg-accent/30" : "border-border bg-muted/30"}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragActive(false);
                      const dropped = event.dataTransfer.files?.[0];
                      if (dropped) {
                        setFile(dropped);
                      }
                    }}
                  >
                    <input
                      type="file"
                      accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                      className="absolute inset-0 cursor-pointer opacity-0"
                      onChange={(event) => {
                        setFile(event.target.files?.[0] ?? null);
                        event.currentTarget.value = "";
                      }}
                    />
                    <UploadCloud className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                    <p className="text-base font-medium">Drop a GLB/GLTF file here</p>
                    <p className="mt-1 text-sm text-muted-foreground">or click anywhere to choose one from your computer</p>
                    <p className="mt-3 text-sm text-muted-foreground">{selectedFile ? `Selected: ${selectedFile.name}` : "No file selected"}</p>

                    {busy || processingStage === "error" ? (
                      <div className="mt-6 w-full max-w-lg rounded-md border bg-background/90 p-4 text-left backdrop-blur">
                        <div className="mb-3 flex items-center gap-2 text-sm">
                          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          <span className="font-medium">{busy ? "Preparing scene..." : "Processing failed"}</span>
                        </div>
                        <div className="space-y-2">
                          {stageItems.map((item) => {
                            const active = processingStage === item.id;
                            const done = isStageDone(item.id);
                            return (
                              <div className="flex items-center gap-2 text-sm" key={item.id}>
                                <div
                                  className={`h-2.5 w-2.5 rounded-full ${active ? "bg-primary" : done ? "bg-foreground/70" : "bg-muted-foreground/30"
                                    }`}
                                />
                                <span className={active ? "font-medium text-foreground" : "text-muted-foreground"}>{item.label}</span>
                              </div>
                            );
                          })}
                        </div>
                        {error ? <div className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
                      </div>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="relative flex min-h-0 flex-1 flex-col rounded-none border-0 shadow-none">
                <CardContent className="relative flex min-h-0 flex-1 flex-col p-0">
                  {/* Active viewer */}
                  {viewMode === "model" ? (
                    <ModelViewer modelUrl={modelUrl} placements={placementCandidates} className="h-full w-full rounded-none border-0" />
                  ) : (
                    <SpatialViewer sceneGraph={sceneGraph} className="h-full w-full rounded-none border-0" />
                  )}

                  {/* Overlay toggle */}
                  <div className="absolute left-3 bottom-3 z-10 flex items-center gap-1 rounded-lg border bg-background/90 p-1 shadow-md backdrop-blur">
                    <button
                      onClick={() => setViewMode("model")}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "model"
                          ? "bg-foreground text-background shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                    >
                      3D Model
                    </button>
                    <button
                      onClick={() => setViewMode("spatial")}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === "spatial"
                          ? "bg-foreground text-background shadow-sm"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                    >
                      Floor Plan
                    </button>
                    <div className="mx-0.5 h-4 w-px bg-border" />
                    <button
                      onClick={() => setJsonOpen(true)}
                      className="rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      title="View JSON"
                    >
                      <Braces className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {/* JSON modal */}
                  <Dialog open={jsonOpen} onOpenChange={setJsonOpen}>
                    <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
                      <DialogHeader>
                        <DialogTitle>Scene Graph JSON</DialogTitle>
                        <DialogDescription>Raw scene graph data for the current scan.</DialogDescription>
                      </DialogHeader>
                      <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30 p-4">
                        <pre className="text-xs leading-5 text-foreground">{JSON.stringify(sceneGraph, null, 2)}</pre>
                      </div>
                    </DialogContent>
                  </Dialog>
                </CardContent>
              </Card>
            )}
          </div>
        </section>

        <section className="min-h-0">
          <ChatPanel
            sceneId={sceneId}
            chatResetToken={chatResetToken}
            onFindFreeSpacesCandidates={setPlacementCandidates}
          />
        </section>
      </div>
    </main>
  );
}
