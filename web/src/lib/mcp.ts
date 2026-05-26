import fs from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

type ToolArgs = Record<string, unknown>;

function getRepoRoot(): string {
  return process.env.SCANDROP_REPO_ROOT ?? path.resolve(process.cwd(), "..");
}

function getPythonBin(): string {
  return process.env.SCANDROP_PYTHON ?? path.join(getRepoRoot(), ".venv", "bin", "python");
}

function getMcpLaunchSpec(): { command: string; args: string[] } {
  const repoRoot = getRepoRoot();
  const entrypoint = path.join(repoRoot, ".venv", "bin", "scandrop-mcp");

  if (fs.existsSync(entrypoint)) {
    return { command: entrypoint, args: [] };
  }

  return {
    command: getPythonBin(),
    args: ["-m", "scandrop.main"]
  };
}

function parseToolResult(result: unknown): unknown {
  if (typeof result !== "object" || result === null) {
    return result;
  }
  const typedResult = result as { structuredContent?: unknown; content?: Array<{ type?: string; text?: string }> };
  if (typedResult.structuredContent !== undefined) {
    return typedResult.structuredContent;
  }
  if (Array.isArray(typedResult.content)) {
    const textChunks = typedResult.content
      .filter((item) => item?.type === "text" && typeof item.text === "string")
      .map((item) => item.text as string);
    if (textChunks.length === 1) {
      try {
        return JSON.parse(textChunks[0]);
      } catch {
        return textChunks[0];
      }
    }
    if (textChunks.length > 1) {
      return textChunks;
    }
  }
  return typedResult;
}

export async function callMcpTool(toolName: string, args: ToolArgs = {}): Promise<unknown> {
  const client = new Client(
    {
      name: "scandrop-web",
      version: "0.1.0"
    },
    {
      capabilities: {}
    }
  );

  const repoRoot = getRepoRoot();
  const launchSpec = getMcpLaunchSpec();

  const transport = new StdioClientTransport({
    command: launchSpec.command,
    args: launchSpec.args,
    cwd: repoRoot,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: "1",
      PYTHONPATH: repoRoot,
      SCANDROP_REPO_ROOT: repoRoot
    }
  });

  await client.connect(transport);
  try {
    const toolResult = await client.callTool({
      name: toolName,
      arguments: args
    });
    return parseToolResult(toolResult);
  } finally {
    await client.close();
  }
}
