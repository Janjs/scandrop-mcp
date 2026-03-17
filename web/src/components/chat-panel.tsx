"use client";

import { useEffect, useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Brain, CheckCircle2, ChevronDown, Loader2, MessageSquarePlus, Wrench, XCircle } from "lucide-react";

import {
  Conversation,
  ConversationContent,
  ConversationScrollButton
} from "@/components/ai-elements/conversation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PlacementCandidate } from "@/lib/types";

type ChatPanelProps = {
  sceneId: string | null;
  chatResetToken?: number;
  onFindFreeSpacesCandidates?: (candidates: PlacementCandidate[] | null) => void;
};

const DEFAULT_PROMPTS = [
  "Where is the best place to put a TV?",
  "Where do I fit a bedside table by this bed?",
  "Where can I fit a 1.2x0.7x0.8m desk with 0.2m clearance?",
  "Can you check if a 2x1.5m rug fits in the room?"
];

type ToolLikePart = {
  type: string;
  state?: string;
  output?: unknown;
  errorText?: string;
  toolName?: string;
  input?: unknown;
  toolCallId?: string;
  text?: string;
};

function isFindFreeSpacesToolPart(part: ToolLikePart): boolean {
  return part.type === "tool-find_free_spaces" || (part.type === "dynamic-tool" && part.toolName === "find_free_spaces");
}

function extractSizeFromFindFreeSpacesInput(input: unknown): [number, number, number] | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const obj = input as Record<string, unknown>;

  const size = obj.size_m;
  if (
    Array.isArray(size) &&
    size.length === 3 &&
    typeof size[0] === "number" &&
    typeof size[1] === "number" &&
    typeof size[2] === "number"
  ) {
    return [size[0], size[1], size[2]];
  }

  const width = typeof obj.width === "number" ? obj.width : undefined;
  const depth = typeof obj.depth === "number" ? obj.depth : undefined;
  const length = typeof obj.length === "number" ? obj.length : undefined;
  const height = typeof obj.height === "number" ? obj.height : undefined;
  if (width !== undefined && (depth !== undefined || length !== undefined) && height !== undefined) {
    return [width, depth ?? length!, height];
  }

  const bbx = typeof obj.bounding_box_x === "number" ? obj.bounding_box_x : undefined;
  const bby = typeof obj.bounding_box_y === "number" ? obj.bounding_box_y : undefined;
  const bbz = typeof obj.bounding_box_z === "number" ? obj.bounding_box_z : undefined;
  if (bbx !== undefined && bby !== undefined && bbz !== undefined) {
    return [bbx, bby, bbz];
  }

  const bbw = typeof obj.bounding_box_width === "number" ? obj.bounding_box_width : undefined;
  const bbd = typeof obj.bounding_box_depth === "number" ? obj.bounding_box_depth : undefined;
  const bbl = typeof obj.bounding_box_length === "number" ? obj.bounding_box_length : undefined;
  const bbh = typeof obj.bounding_box_height === "number" ? obj.bounding_box_height : undefined;
  if ((bbw !== undefined || bbd !== undefined || bbl !== undefined) && bbh !== undefined) {
    return [bbw ?? bbd ?? bbl!, bbd ?? bbl ?? bbw!, bbh];
  }

  return undefined;
}

function extractClearanceFromFindFreeSpacesInput(input: unknown): number | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj.clearance_m === "number") return obj.clearance_m;
  if (typeof obj.clearance === "number") return obj.clearance;
  if (typeof obj.clearance_dist === "number") return obj.clearance_dist;
  if (typeof obj.clearance_distance === "number") return obj.clearance_distance;
  return undefined;
}

function inferPlacementRenderModeFromRecentUserText(messages: Array<{ role: string; parts?: ToolLikePart[]; content?: string }>, assistantIndex: number): "box" | "plane" {
  for (let i = assistantIndex - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg.role !== "user") {
      continue;
    }
    const text = getTextOnlyFromMessage(msg as { content?: string; parts?: Array<{ type: string; text?: string }> }).toLowerCase();
    if (!text) {
      break;
    }
    if (/(rug|carpet|mat)\b/.test(text)) {
      return "plane";
    }
    break;
  }
  return "box";
}

function extractFindFreeSpacesCandidates(messages: Array<{ role: string; parts?: ToolLikePart[] }>): PlacementCandidate[] | null | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant" || !Array.isArray(message.parts)) {
      continue;
    }
    for (let j = message.parts.length - 1; j >= 0; j -= 1) {
      const part = message.parts[j];
      if (!isFindFreeSpacesToolPart(part)) {
        continue;
      }
      if (part.state === "output-error") {
        return null;
      }
      if (part.state !== "output-available" || !part.output || typeof part.output !== "object") {
        continue;
      }
      const render_mode = inferPlacementRenderModeFromRecentUserText(
        messages as Array<{ role: string; parts?: ToolLikePart[]; content?: string }>,
        i
      );
      const size_m = extractSizeFromFindFreeSpacesInput(part.input);
      const clearance_m = extractClearanceFromFindFreeSpacesInput(part.input);
      const candidatesRaw = (part.output as { candidates?: unknown }).candidates;
      if (!Array.isArray(candidatesRaw)) {
        continue;
      }
      const parsed = candidatesRaw
        .map((candidate): PlacementCandidate | null => {
          if (!candidate || typeof candidate !== "object") {
            return null;
          }
          const c = candidate as { pos?: unknown; yaw_rad?: unknown; score?: unknown; notes?: unknown };
          if (!Array.isArray(c.pos) || c.pos.length !== 3 || typeof c.yaw_rad !== "number") {
            return null;
          }
          const [x, y, z] = c.pos;
          if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") {
            return null;
          }
          return {
            pos: [x, y, z],
            yaw_rad: c.yaw_rad,
            score: typeof c.score === "number" ? c.score : undefined,
            notes: Array.isArray(c.notes) ? c.notes.filter((note): note is string => typeof note === "string") : undefined,
            size_m,
            clearance_m,
            render_mode
          };
        })
        .filter((candidate): candidate is PlacementCandidate => candidate !== null);
      return parsed.length > 0 ? parsed : null;
    }
  }
  return undefined;
}

function getTextOnlyFromMessage(message: {
  content?: string;
  parts?: Array<{
    type: string;
    text?: string;
  }>;
}): string {
  if (Array.isArray(message.parts) && message.parts.length > 0) {
    return message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("")
      .trim();
  }
  return message.content?.trim() || "";
}

/** Derive a human-readable label from a tool part */
function getToolDisplayName(part: ToolLikePart): string {
  if (part.type === "dynamic-tool") {
    return part.toolName?.replace(/_/g, " ") ?? "tool";
  }
  return part.type.replace(/^tool-/, "").replace(/_/g, " ");
}

/** Collapsible reasoning / thinking block */
function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="rounded-md border border-border/50 bg-muted/30 text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <Brain className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium">Thinking</span>
        <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="border-t border-border/50 px-3 py-2 whitespace-pre-wrap text-muted-foreground italic">
          {text}
        </div>
      )}
    </div>
  );
}

function formatToolPayload(value: unknown): string {
  if (value === undefined || value === null) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Inline tool invocation indicator with expandable input/output */
function ToolInvocationBlock({ part }: { part: ToolLikePart }) {
  const [open, setOpen] = useState(false);
  const name = getToolDisplayName(part);
  const isLoading = part.state === "input-streaming" || part.state === "input-available";
  const hasError = part.state === "output-error" || !!part.errorText;
  const isDone = part.state === "output-available" && !hasError;
  const hasInput = part.input !== undefined && part.input !== null;
  const hasOutput = part.output !== undefined && part.output !== null;
  const canExpand = hasInput || hasOutput || !!part.errorText;

  return (
    <div
      className={cn(
        "rounded-md border text-xs",
        hasError
          ? "border-red-500/30 bg-red-500/5 text-red-600 dark:text-red-400"
          : isDone
            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400"
            : "border-border/50 bg-muted/30 text-muted-foreground"
      )}
    >
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors",
          canExpand && "hover:text-foreground cursor-pointer"
        )}
        onClick={() => canExpand && setOpen((v) => !v)}
        disabled={!canExpand}
      >
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
        {isDone && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
        {hasError && <XCircle className="h-3.5 w-3.5 shrink-0" />}
        {!isLoading && !isDone && !hasError && <Wrench className="h-3.5 w-3.5 shrink-0" />}
        <span className="font-medium capitalize">{name}</span>
        {isLoading && <span className="text-muted-foreground/70">running…</span>}
        {hasError && part.errorText && (
          <span className="truncate max-w-[200px]" title={part.errorText}>
            — {part.errorText}
          </span>
        )}
        {canExpand && (
          <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        )}
      </button>
      {open && canExpand && (
        <div className="border-t border-border/50 space-y-2 px-3 py-2">
          {hasInput && (
            <div>
              <p className="font-medium text-muted-foreground mb-1">Input</p>
              <pre className="overflow-x-auto rounded bg-muted/50 px-2 py-1.5 text-[11px] whitespace-pre-wrap break-words">
                {formatToolPayload(part.input)}
              </pre>
            </div>
          )}
          {(hasOutput || part.errorText) && (
            <div>
              <p className="font-medium text-muted-foreground mb-1">Output</p>
              <pre
                className={cn(
                  "overflow-x-auto rounded px-2 py-1.5 text-[11px] whitespace-pre-wrap break-words",
                  hasError ? "bg-red-500/10" : "bg-muted/50"
                )}
              >
                {part.errorText ?? formatToolPayload(part.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Check if a part looks like a tool invocation */
function isToolPart(part: ToolLikePart): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

export function ChatPanel({ sceneId, chatResetToken = 0, onFindFreeSpacesCandidates }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat"
      }),
    []
  );

  const { messages, sendMessage, status, stop, setMessages, error } = useChat({
    id: `spatial-assistant-${chatResetToken}`,
    transport
  });
  const lastMessage = messages.at(-1);
  const lastAssistantMessage = lastMessage?.role === "assistant" ? lastMessage : undefined;

  useEffect(() => {
    if (!onFindFreeSpacesCandidates) {
      return;
    }
    const extracted = extractFindFreeSpacesCandidates(messages as Array<{ role: string; parts?: ToolLikePart[] }>);
    if (extracted !== undefined) {
      onFindFreeSpacesCandidates(extracted);
    }
  }, [messages, onFindFreeSpacesCandidates]);

  return (
    <div className="flex h-full min-h-0 flex-col border-l">
      <header className="flex h-16 items-center justify-between border-b px-4">
        <div>
          <p className="text-base font-semibold">Spatial Assistant</p>
          <p className="text-sm text-muted-foreground">Ask about your room layout</p>
        </div>
        <Badge variant={sceneId ? "default" : "secondary"}>{sceneId ? "Connected" : "No Scene"}</Badge>
      </header>

      <div className="relative min-h-0 flex-1">
        <Conversation className="min-h-0 h-full">
          <ConversationContent className={messages.length === 0 ? "h-full justify-end" : undefined}>
            {messages.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center">
                <div>
                  <div className="mb-3">
                    <p className="font-semibold text-base">No messages yet</p>
                    <p className="text-muted-foreground text-sm">Try one of the suggestions below to start.</p>
                  </div>
                  <Suggestions>
                    {DEFAULT_PROMPTS.map((prompt) => (
                      <Suggestion
                        key={prompt}
                        disabled={!sceneId}
                        onClick={(suggestion) => {
                          if (!sceneId) return;
                          void sendMessage(
                            { text: suggestion },
                            {
                              body: {
                                sceneId
                              }
                            }
                          );
                        }}
                        suggestion={prompt}
                      />
                    ))}
                  </Suggestions>
                </div>
              </div>
            ) : null}

            {messages.map((message) => {
              if (message.role === "user") {
                const text = getTextOnlyFromMessage(message);
                if (!text) return null;
                return (
                  <Message from="user" key={message.id}>
                    <MessageContent>{text}</MessageContent>
                  </Message>
                );
              }

              // Assistant messages: render parts
              const parts = Array.isArray(message.parts) ? message.parts : [];
              const hasAnyContent = parts.some(
                (p) =>
                  (p.type === "text" && (p as { text?: string }).text?.trim()) ||
                  p.type === "reasoning" ||
                  isToolPart(p as ToolLikePart)
              );
              if (!hasAnyContent) return null;

              return (
                <Message from="assistant" key={message.id}>
                  {parts.map((part, index) => {
                    // Reasoning / thinking tokens
                    if (part.type === "reasoning") {
                      const reasoningText = (part as { text?: string }).text ?? "";
                      if (!reasoningText) return null;
                      return <ReasoningBlock key={`reasoning-${index}`} text={reasoningText} />;
                    }

                    // Tool invocations
                    if (isToolPart(part as ToolLikePart)) {
                      return (
                        <ToolInvocationBlock
                          key={(part as ToolLikePart).toolCallId ?? `tool-${index}`}
                          part={part as ToolLikePart}
                        />
                      );
                    }

                    // Text content
                    if (part.type === "text") {
                      const text = (part as { text?: string }).text?.trim();
                      if (!text) return null;
                      return (
                        <MessageContent key={`text-${index}`}>{text}</MessageContent>
                      );
                    }

                    return null;
                  })}
                </Message>
              );
            })}

            {(status === "submitted" || (status === "streaming" && !lastAssistantMessage?.parts?.some(
              (p) => (p.type === "text" && (p as { text?: string }).text?.trim()) || p.type === "reasoning" || isToolPart(p as ToolLikePart)
            ))) && (
                <Message from="assistant" key="assistant-loading">
                  <MessageContent className="flex flex-row items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{status === "submitted" ? "Thinking..." : "Responding..."}</span>
                  </MessageContent>
                </Message>
              )}

            {status === "error" && error && (
              <Message from="assistant" key="assistant-error">
                <MessageContent className="text-red-700">
                  {error.message || "Chat request failed."}
                </MessageContent>
              </Message>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        {messages.length > 0 && (
          <TooltipProvider delayDuration={0}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="outline"
                  className="absolute bottom-3 right-3 z-10"
                  onClick={() => {
                    setMessages([]);
                    setDraft("");
                    onFindFreeSpacesCandidates?.(null);
                  }}
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  <span className="sr-only">New Chat</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>New Chat</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className="border-t p-3">
        <PromptInput
          onSubmit={({ text }) => {
            if (!sceneId) return;
            const content = text.trim();
            if (!content) return;
            void sendMessage(
              { text: content },
              {
                body: {
                  sceneId
                }
              }
            );
            setDraft("");
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              disabled={!sceneId}
              onChange={(event) => setDraft(event.currentTarget.value)}
              placeholder={sceneId ? "Ask about your space..." : "Load a scene to ask..."}
              value={draft}
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputSubmit disabled={!sceneId} onStop={stop} status={status} />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
