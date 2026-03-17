import { NextResponse } from "next/server";
import { z } from "zod";

import { callMcpTool } from "@/lib/mcp";

export const runtime = "nodejs";

const requestSchema = z.object({
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()).optional()
});

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const payload = requestSchema.parse(await request.json());
    const data = await callMcpTool(payload.tool, payload.args ?? {});
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown MCP error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
