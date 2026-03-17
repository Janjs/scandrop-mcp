import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getRepoRoot(): string {
  return process.env.SCANDROP_REPO_ROOT ?? path.resolve(process.cwd(), "..");
}

function ensurePathAllowed(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  const repoRoot = getRepoRoot();
  if (!absolutePath.startsWith(repoRoot)) {
    throw new Error("Model path must be inside the repository.");
  }
  return absolutePath;
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const requestedPath = searchParams.get("path");
    if (!requestedPath) {
      return NextResponse.json({ error: "Missing path query parameter." }, { status: 400 });
    }

    const absolutePath = ensurePathAllowed(requestedPath);
    const fileBuffer = await fs.readFile(absolutePath);
    const contentType = absolutePath.toLowerCase().endsWith(".gltf") ? "model/gltf+json" : "model/gltf-binary";

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to stream model.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
