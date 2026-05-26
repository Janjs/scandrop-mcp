import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { google, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { z } from "zod";

import { callMcpTool } from "@/lib/mcp";

export const runtime = "nodejs";

type ChatRequestBody = {
  messages?: UIMessage[];
  sceneId?: string;
};

type FindFreeSpacesArgs =
  | {
    scene_id?: string;
    size_m?: [number, number, number];
    clearance_m?: number;
    yaw_steps?: number;
    grid_step_m?: number;
    max_results?: number;
    width?: number;
    depth?: number;
    length?: number;
    height?: number;
    clearance?: number;
    clearance_dist?: number;
    clearance_distance?: number;
    dimensions?: {
      width?: number;
      depth?: number;
      length?: number;
      height?: number;
    };
    bbox?: {
      x?: number;
      y?: number;
      z?: number;
    };
    bounding_box_width?: number;
    bounding_box_depth?: number;
    bounding_box_length?: number;
    bounding_box_height?: number;
  }
  | Record<string, unknown>;

function normalizeFindFreeSpacesArgs(args: FindFreeSpacesArgs, activeSceneId?: string): Record<string, unknown> {
  const objectArgs = (args ?? {}) as Record<string, unknown>;
  const scene_id =
    (typeof objectArgs.scene_id === "string" && objectArgs.scene_id.trim()) ||
    (typeof activeSceneId === "string" && activeSceneId.trim()) ||
    undefined;

  const width = typeof objectArgs.width === "number" ? objectArgs.width : undefined;
  const depthCandidate = typeof objectArgs.depth === "number" ? objectArgs.depth : undefined;
  const lengthCandidate = typeof objectArgs.length === "number" ? objectArgs.length : undefined;
  const height = typeof objectArgs.height === "number" ? objectArgs.height : undefined;
  const dimensions =
    typeof objectArgs.dimensions === "object" && objectArgs.dimensions !== null
      ? (objectArgs.dimensions as Record<string, unknown>)
      : undefined;
  const dimensionsWidth = typeof dimensions?.width === "number" ? dimensions.width : undefined;
  const dimensionsDepth = typeof dimensions?.depth === "number" ? dimensions.depth : undefined;
  const dimensionsLength = typeof dimensions?.length === "number" ? dimensions.length : undefined;
  const dimensionsHeight = typeof dimensions?.height === "number" ? dimensions.height : undefined;
  const bboxX = typeof objectArgs.bounding_box_x === "number" ? objectArgs.bounding_box_x : undefined;
  const bboxY = typeof objectArgs.bounding_box_y === "number" ? objectArgs.bounding_box_y : undefined;
  const bboxZ = typeof objectArgs.bounding_box_z === "number" ? objectArgs.bounding_box_z : undefined;
  const bboxWidth = typeof objectArgs.bounding_box_width === "number" ? objectArgs.bounding_box_width : undefined;
  const bboxDepth = typeof objectArgs.bounding_box_depth === "number" ? objectArgs.bounding_box_depth : undefined;
  const bboxLength = typeof objectArgs.bounding_box_length === "number" ? objectArgs.bounding_box_length : undefined;
  const bboxHeight = typeof objectArgs.bounding_box_height === "number" ? objectArgs.bounding_box_height : undefined;
  const bbox =
    typeof objectArgs.bbox === "object" && objectArgs.bbox !== null ? (objectArgs.bbox as Record<string, unknown>) : undefined;
  const bboxObjX = typeof bbox?.x === "number" ? bbox.x : undefined;
  const bboxObjY = typeof bbox?.y === "number" ? bbox.y : undefined;
  const bboxObjZ = typeof bbox?.z === "number" ? bbox.z : undefined;
  const naturalWidth = width ?? dimensionsWidth;
  const naturalDepth = depthCandidate ?? lengthCandidate ?? dimensionsDepth ?? dimensionsLength;
  const naturalHeight = height ?? dimensionsHeight;
  const sizeFromNatural =
    naturalWidth !== undefined && naturalHeight !== undefined && naturalDepth !== undefined
      ? ([naturalWidth, naturalDepth, naturalHeight] as [number, number, number])
      : undefined;
  const sizeFromBoundingBox =
    (bboxX ?? bboxObjX) !== undefined && (bboxY ?? bboxObjY) !== undefined && (bboxZ ?? bboxObjZ) !== undefined
      ? ([bboxX ?? bboxObjX!, bboxY ?? bboxObjY!, bboxZ ?? bboxObjZ!] as [number, number, number])
      : undefined;
  const sizeFromBoundingBoxNamed =
    (bboxWidth !== undefined || bboxLength !== undefined || bboxDepth !== undefined) && bboxHeight !== undefined
      ? ([bboxWidth ?? bboxLength ?? bboxDepth!, bboxDepth ?? bboxLength ?? bboxWidth!, bboxHeight] as [number, number, number])
      : undefined;

  const size_m =
    Array.isArray(objectArgs.size_m) && objectArgs.size_m.length === 3
      ? objectArgs.size_m
      : sizeFromNatural ?? sizeFromBoundingBox ?? sizeFromBoundingBoxNamed;
  const clearance_m =
    typeof objectArgs.clearance_m === "number"
      ? objectArgs.clearance_m
      : typeof objectArgs.clearance === "number"
        ? objectArgs.clearance
        : typeof objectArgs.clearance_dist === "number"
          ? objectArgs.clearance_dist
          : typeof objectArgs.clearance_distance === "number"
            ? objectArgs.clearance_distance
            : undefined;
  const max_results = typeof objectArgs.max_results === "number" ? objectArgs.max_results : 1;

  return {
    ...objectArgs,
    scene_id,
    size_m,
    clearance_m,
    max_results
  };
}

export async function POST(request: Request): Promise<Response> {
  const payload = (await request.json()) as ChatRequestBody;
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const sceneId = payload.sceneId;

    const result = streamText({
      model: google("gemini-2.5-flash"),
      system: `You are Scandrop, a helpful AI spatial assistant. You help users analyze 3D rooms and test out furniture placements. Try to answer concisely and natively without outputting raw JSON data when possible. Keep formatting simple.
Never mention internal tool names, connector names, or implementation details in user-facing responses. Just explain outcomes.
If the user provides a local .glb/.gltf path and asks to load/import/onboard a scene, call the one-step onboarding tool immediately.
When a user asks about placing common furniture (e.g. bedside table, desk, TV stand, bookshelf, sofa, rug, coffee table etc.) without specifying exact dimensions, estimate typical real-world dimensions in meters from your training data and proceed to call the relevant tool immediately. Do NOT ask the user for dimensions of common furniture items — just use reasonable defaults and mention the assumed dimensions in your response.
When answering placement/fit questions using tool results, return only the single best placement by default (even if multiple exist), with exact location (x, y, z) and rotation/yaw in radians rounded to 2 decimals. Then ask if the user wants more placement options.
Only provide multiple placements when the user explicitly asks for more than one option.
${sceneId ? `The user is currently viewing the scene with ID: ${sceneId}` : "No active scene is currently selected."}`,
      messages: await convertToModelMessages(messages),
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingBudget: 4096,
            includeThoughts: true,
          },
        } satisfies GoogleLanguageModelOptions,
      },
      stopWhen: stepCountIs(5),
      tools: {
        onboard_scene: tool({
          description: "Onboard a scene from a local .glb/.gltf path and return scene_id, version, processing status, and summary.",
          parameters: z.object({
            path: z.string().describe("Absolute local path to a .glb or .gltf file")
          }),
          // @ts-expect-error tool typing mismatch
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          execute: async (args: any) => {
            return await callMcpTool("onboard_scene", args);
          }
        }),
        list_scenes: tool({
          description: "List all available scanned scenes in the workspace.",
          parameters: z.object({}),
          // @ts-expect-error tool typing mismatch
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          execute: async (args: any) => {
            return await callMcpTool("list_scenes", args);
          }
        }),
        get_scene_summary: tool({
          description: "Get summary metrics for a specific scene, like floor area and obstacle count.",
          parameters: z.object({
            scene_id: z.string().describe("The ID of the scene")
          }),
          // @ts-expect-error tool typing mismatch
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          execute: async (args: any) => {
            return await callMcpTool("get_scene_summary", args);
          }
        }),
        get_processing_status: tool({
          description: "Get the background processing status for a specific scene.",
          parameters: z.object({
            scene_id: z.string().describe("The ID of the scene")
          }),
          // @ts-expect-error tool typing mismatch
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          execute: async (args: any) => {
            return await callMcpTool("get_processing_status", args);
          }
        }),
        find_free_spaces: tool({
          description: "Find candidate free spaces in the room where a bounding box of a specific size can fit without colliding with obstacles.",
          parameters: z.object({
            scene_id: z.string().optional().describe("The ID of the scene. If omitted, use the currently active scene."),
            size_m: z.tuple([z.number(), z.number(), z.number()]).optional().describe("The width, depth, and height in meters of the item to place"),
            width: z.number().optional().describe("Optional alias for size_m[0]"),
            depth: z.number().optional().describe("Optional alias for size_m[1]"),
            length: z.number().optional().describe("Optional alias for depth"),
            height: z.number().optional().describe("Optional alias for size_m[2]"),
            bounding_box_x: z.number().optional().describe("Optional alias for size_m[0]"),
            bounding_box_y: z.number().optional().describe("Optional alias for size_m[1]"),
            bounding_box_z: z.number().optional().describe("Optional alias for size_m[2]"),
            bounding_box_width: z.number().optional().describe("Optional alias for size_m[0]"),
            bounding_box_depth: z.number().optional().describe("Optional alias for size_m[1]"),
            bounding_box_length: z.number().optional().describe("Optional alias for size_m[1]"),
            bounding_box_height: z.number().optional().describe("Optional alias for size_m[2]"),
            clearance_m: z.number().optional().default(0.6).describe("Additional empty space required around the item in meters. Typical value is 0.6"),
            clearance: z.number().optional().describe("Optional alias for clearance_m"),
            clearance_dist: z.number().optional().describe("Optional alias for clearance_m"),
            clearance_distance: z.number().optional().describe("Optional alias for clearance_m"),
            dimensions: z
              .object({
                width: z.number().optional(),
                depth: z.number().optional(),
                length: z.number().optional(),
                height: z.number().optional()
              })
              .optional()
              .describe("Optional nested dimensions object"),
            bbox: z
              .object({
                x: z.number().optional(),
                y: z.number().optional(),
                z: z.number().optional()
              })
              .optional()
              .describe("Optional nested bounding-box object"),
            yaw_steps: z.number().optional().default(4).describe("Number of rotations to search. Typical value is 4 (every 90 degrees)"),
            grid_step_m: z.number().optional().default(0.2).describe("Grid step size in meters for search. Typical is 0.2"),
            max_results: z.number().optional().default(5).describe("Maximum number of locations to return")
          }).passthrough(),
          // @ts-expect-error tool typing mismatch
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          execute: async (args: any) => {
            return await callMcpTool("find_free_spaces", normalizeFindFreeSpacesArgs(args, sceneId));
          }
        }),
        check_fit: tool({
          description: "Check if a specific bounding box can fit at an exact 3D position and rotation in the room.",
          parameters: z.object({
            scene_id: z.string().describe("The ID of the scene"),
            size_m: z.tuple([z.number(), z.number(), z.number()]).describe("The width, depth, and height of the box in meters"),
            pose: z.object({
              pos: z.tuple([z.number(), z.number(), z.number()]).describe("The exact x, y, and z position coordinate"),
              yaw_rad: z.number().describe("The rotation around the Up axis in radians")
            }),
            clearance_m: z.number().optional().default(0).describe("Clearance buffer required in meters")
          }),
          // @ts-expect-error tool typing mismatch
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          execute: async (args: any) => {
            return await callMcpTool("check_fit", args);
          }
        })
      }
    });

  return result.toUIMessageStreamResponse({ sendReasoning: true });
}
