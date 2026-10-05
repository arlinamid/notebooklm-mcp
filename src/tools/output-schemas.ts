/**
 * Output schemas for the read-only listing tools. Tool results are wrapped as
 * `{ success: true, data: … }` (see toCallToolResult in index.ts); the SDK
 * validates `structuredContent` against these schemas for successful calls,
 * and failures carry `isError` instead.
 */

type JsonSchema = Record<string, unknown>;

const ok = (data: JsonSchema): JsonSchema => ({
  type: "object",
  properties: { success: { type: "boolean" }, data },
  required: ["success", "data"],
});

const str = { type: "string" };

export const OUTPUT_SCHEMAS: Record<string, JsonSchema> = {
  list_sources: ok({
    type: "object",
    properties: {
      count: { type: "number" },
      sources: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: str,
            title: str,
            kind: {
              type: "string",
              description: "Source-type glyph, e.g. description, markdown, web.",
            },
            selected: { type: "boolean", description: "Used by the chat right now." },
            type: {
              type: "string",
              description: "web, youtube, pdf, text, markdown, google_doc …",
            },
            url: { type: ["string", "null"] },
            channel: { type: ["string", "null"], description: "YouTube channel." },
            words: { type: ["number", "null"] },
            characters: { type: ["number", "null"] },
            status: { type: "string", enum: ["ready", "processing", "failed"] },
            origin: { type: "string", enum: ["added", "research"] },
            addedAt: { type: ["string", "null"] },
          },
          required: ["id", "title", "kind", "selected"],
        },
      },
    },
    required: ["sources", "count"],
  }),
  list_studio_artifacts: ok({
    type: "object",
    properties: {
      artifacts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: str,
            type: str,
            title: str,
            details: str,
            status: { type: "string", enum: ["ready", "generating", "scheduled"] },
          },
          required: ["id", "type", "title", "details", "status"],
        },
      },
    },
    required: ["artifacts"],
  }),
  get_usage: ok({
    type: "object",
    properties: {
      usage: {
        type: "object",
        properties: {
          windows: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: str,
                percentUsed: { type: "number" },
                resets: { type: ["string", "null"] },
              },
              required: ["label", "percentUsed", "resets"],
            },
          },
          raw: str,
        },
        required: ["windows", "raw"],
      },
    },
    required: ["usage"],
  }),
  list_prompt_templates: ok({
    type: "object",
    properties: {
      total: { type: "number" },
      offset: { type: "number" },
      templates: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: str,
            title: str,
            target: str,
            pack: str,
            langs: { type: "array", items: str },
            description: str,
          },
          required: ["name", "title", "target", "pack", "langs", "description"],
        },
      },
    },
    required: ["total", "offset", "templates"],
  }),
};
