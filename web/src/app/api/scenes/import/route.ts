import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { callMcpTool } from "@/lib/mcp";

export const runtime = "nodejs";

const jsonRequestSchema = z.object({
  path: z.string().min(1)
});

function getRepoRoot(): string {
  return process.env.SCANDROP_REPO_ROOT ?? path.resolve(process.cwd(), "..");
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function assertSupportedExtension(fileName: string): void {
  const ext = path.extname(fileName).toLowerCase();
  if (ext !== ".glb" && ext !== ".gltf") {
    throw new Error("Only .glb and .gltf files are supported.");
  }
}

async function saveUpload(file: File): Promise<string> {
  const repoRoot = getRepoRoot();
  const uploadDir = path.join(repoRoot, "data", "uploads");
  await fs.mkdir(uploadDir, { recursive: true });

  const safeName = sanitizeFileName(file.name || "upload.glb");
  assertSupportedExtension(safeName);
  const stampedName = `${Date.now()}-${safeName}`;
  const destinationPath = path.join(uploadDir, stampedName);

  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(destinationPath, bytes);
  return destinationPath;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "Missing uploaded file." }, { status: 400 });
      }

      const savedPath = await saveUpload(file);
      const data = (await callMcpTool("scandrop.create_scene_from_gltf", { path: savedPath })) as Record<string, unknown>;
      return NextResponse.json({
        ...data,
        model_path: savedPath,
        original_file_name: file.name
      });
    }

    const payload = jsonRequestSchema.parse(await request.json());
    const data = await callMcpTool("scandrop.create_scene_from_gltf", { path: payload.path });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to import scene";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
