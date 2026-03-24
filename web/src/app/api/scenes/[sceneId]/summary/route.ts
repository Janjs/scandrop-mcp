import { NextResponse } from "next/server";

import { callMcpTool } from "@/lib/mcp";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ sceneId: string }> }): Promise<NextResponse> {
  try {
    const { sceneId } = await context.params;
    const data = await callMcpTool("get_scene_summary", { scene_id: sceneId });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load summary";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
