import type { PluginDescriptor, ResolvedPlugin, RouteContext, StorageCollection } from "emdash";
import { definePlugin, PluginRouteError } from "emdash";
import { z } from "astro/zod";

import { fetchGitHubMarkdown } from "./github.js";
import { parseMarkdown } from "./markdown.js";
import type { GitHubSource, ImportTarget, SourceRecord } from "./types.js";

const version = "0.1.0";
const packageName = "emdash-github-content";

const sourceSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  branch: z.string().min(1).default("main"),
  path: z.string().min(1),
});

const previewSchema = z.object({
  source: sourceSchema,
});

const importSchema = z.object({
  source: sourceSchema,
  target: z.object({
    collection: z.string().min(1),
    bodyField: z.string().min(1),
    titleField: z.string().optional(),
    slugField: z.string().optional(),
    descriptionField: z.string().optional(),
  }),
});

type SourcesCollection = StorageCollection<SourceRecord>;

function sources(ctx: RouteContext): SourcesCollection {
  return ctx.storage.sources as SourcesCollection;
}

function sourceId(source: GitHubSource): string {
  return `${source.owner}/${source.repo}@${source.branch}:${source.path}`;
}

function cleanFrontmatter(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const omitted = new Set([
    "visible",
    "visiable",
    "title",
    "slug",
    "description",
  ]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key)));
}

async function buildEntryData(
  ctx: RouteContext,
  parsed: ReturnType<typeof parseMarkdown>,
  target: ImportTarget,
): Promise<Record<string, unknown>> {
  if (!ctx.schema) throw new Error("Schema access is unavailable");

  const collection = await ctx.schema.getCollection(target.collection);
  if (!collection) throw PluginRouteError.notFound(`Collection "${target.collection}" was not found`);

  const fields = new Map(collection.fields.map((field) => [field.slug, field]));
  const bodyField = fields.get(target.bodyField);
  if (!bodyField || bodyField.type !== "portableText") {
    throw PluginRouteError.badRequest(
      `Field "${target.bodyField}" must exist and use the portableText type`,
    );
  }

  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(cleanFrontmatter(parsed.frontmatter))) {
    if (fields.has(key)) data[key] = value;
  }

  data[target.bodyField] = parsed.body;

  const titleField = target.titleField || collection.titleField || undefined;
  if (titleField && parsed.title && fields.has(titleField)) data[titleField] = parsed.title;

  if (target.slugField && parsed.slug && fields.has(target.slugField)) {
    data[target.slugField] = parsed.slug;
  }

  if (target.descriptionField && parsed.description && fields.has(target.descriptionField)) {
    data[target.descriptionField] = parsed.description;
  }

  return data;
}

async function applyVisibility(
  ctx: RouteContext,
  collection: string,
  entryId: string,
  visible: boolean,
): Promise<void> {
  if (!ctx.content?.getVersioned || !ctx.content.publish || !ctx.content.unpublish) {
    throw new Error("Content publication access is unavailable");
  }

  const current = await ctx.content.getVersioned(collection, entryId);
  if (!current) throw PluginRouteError.notFound("Imported content disappeared before publication");

  if (visible && current.item.status !== "published") {
    await ctx.content.publish(collection, entryId, { _rev: current._rev });
  }

  if (!visible && current.item.status === "published") {
    await ctx.content.unpublish(collection, entryId, { _rev: current._rev });
  }
}

export interface GitHubContentPluginOptions {}

export function githubContentPlugin(
  options: GitHubContentPluginOptions = {},
): PluginDescriptor<GitHubContentPluginOptions> {
  return {
    id: "github-content",
    version,
    format: "native",
    entrypoint: packageName,
    adminEntry: `${packageName}/admin`,
    componentsEntry: `${packageName}/astro`,
    options,
    capabilities: ["network:request", "schema:read", "content:write", "content:publish"],
    allowedHosts: ["api.github.com"],
    adminPages: [{ path: "/", label: "GitHub Content", icon: "github-logo" }],
    storage: {
      sources: {
        indexes: ["updatedAt", "visible"],
      },
    },
  };
}

export function createPlugin(_options: GitHubContentPluginOptions = {}): ResolvedPlugin {
  return definePlugin({
    id: "github-content",
    version,
    capabilities: ["network:request", "schema:read", "content:write", "content:publish"],
    allowedHosts: ["api.github.com"],

    storage: {
      sources: {
        indexes: ["updatedAt", "visible"],
      },
    },

    routes: {
      collections: {
        handler: async (ctx) => {
          if (!ctx.schema) throw new Error("Schema access is unavailable");
          const collections = await ctx.schema.listCollections();
          return {
            collections: collections.map((collection) => ({
              slug: collection.slug,
              label: collection.label,
              titleField: collection.titleField,
              fields: collection.fields.map((field) => ({
                slug: field.slug,
                label: field.label,
                type: field.type,
              })),
            })),
          };
        },
      },

      preview: {
        input: previewSchema,
        handler: async (ctx) => {
          const source = ctx.input.source;
          const file = await fetchGitHubMarkdown(ctx, source);
          const parsed = parseMarkdown(file.markdown, source);

          return {
            sha: file.sha,
            frontmatter: parsed.frontmatter,
            title: parsed.title,
            slug: parsed.slug,
            description: parsed.description,
            visible: parsed.visible,
            blockCount: parsed.body.length,
            body: parsed.body,
          };
        },
      },

      import: {
        input: importSchema,
        handler: async (ctx) => {
          if (!ctx.content?.create || !ctx.content.update) {
            throw new Error("Content write access is unavailable");
          }

          const source = ctx.input.source;
          const target = ctx.input.target;
          const file = await fetchGitHubMarkdown(ctx, source);
          const parsed = parseMarkdown(file.markdown, source);
          const data = await buildEntryData(ctx, parsed, target);
          const id = sourceId(source);
          const existing = await sources(ctx).get(id);

          let entryId: string;
          let action: "created" | "updated" | "unchanged";

          if (existing && existing.sha === file.sha && existing.target.collection === target.collection) {
            entryId = existing.entryId;
            action = "unchanged";
          } else if (existing && existing.target.collection === target.collection) {
            const updated = await ctx.content.update(target.collection, existing.entryId, data);
            entryId = updated.id;
            action = "updated";
          } else {
            const created = await ctx.content.create(target.collection, data);
            entryId = created.id;
            action = "created";
          }

          await applyVisibility(ctx, target.collection, entryId, parsed.visible);

          const record: SourceRecord = {
            source,
            target,
            entryId,
            sha: file.sha,
            visible: parsed.visible,
            updatedAt: new Date().toISOString(),
          };
          await sources(ctx).put(id, record);

          return {
            action,
            entryId,
            sha: file.sha,
            visible: parsed.visible,
            title: parsed.title,
          };
        },
      },

      sources: {
        handler: async (ctx) => {
          const result = await sources(ctx).query({
            orderBy: { updatedAt: "desc" },
            limit: 100,
          });
          return {
            items: result.items.map(({ id, data }) => ({ id, ...data })),
          };
        },
      },
    },

    admin: {
      entry: `${packageName}/admin`,
      settingsSchema: {
        githubToken: {
          type: "secret",
          label: "GitHub token",
          description:
            "Optional. Required for private repositories and useful for higher GitHub API rate limits.",
        },
      },
      pages: [{ path: "/", label: "GitHub Content", icon: "github-logo" }],
      portableTextBlocks: [
        {
          type: "githubImage",
          label: "GitHub image",
          icon: "image",
          description: "Image resolved from a Markdown file in a GitHub repository.",
          fields: [
            { type: "text_input", action_id: "url", label: "Image URL" },
            { type: "text_input", action_id: "alt", label: "Alt text" },
            { type: "text_input", action_id: "caption", label: "Caption" },
          ],
        },
        {
          type: "githubCallout",
          label: "GitHub callout",
          icon: "info",
          description: "GitHub-style Markdown alert such as NOTE or WARNING.",
          fields: [
            {
              type: "select",
              action_id: "tone",
              label: "Tone",
              options: [
                { label: "Note", value: "note" },
                { label: "Tip", value: "tip" },
                { label: "Important", value: "important" },
                { label: "Warning", value: "warning" },
                { label: "Caution", value: "caution" },
              ],
            },
            { type: "text_input", action_id: "text", label: "Text", multiline: true },
          ],
        },
      ],
    },
  });
}

export default createPlugin;
