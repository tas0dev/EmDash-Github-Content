import matter from "gray-matter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { resolveGitHubAssetUrl } from "./github.js";
import type {
  GitHubSource,
  ParsedMarkdown,
  PortableTextBlock,
  PortableTextSpan,
} from "./types.js";

type MdNode = {
  type: string;
  value?: string;
  depth?: number;
  lang?: string | null;
  meta?: string | null;
  url?: string;
  alt?: string;
  title?: string | null;
  ordered?: boolean;
  start?: number | null;
  children?: MdNode[];
  align?: Array<"left" | "right" | "center" | null>;
};

class KeyFactory {
  private value = 0;
  next(prefix = "k"): string {
    this.value += 1;
    return `${prefix}${this.value.toString(36)}`;
  }
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return null;
}

function inlineToSpans(
  nodes: MdNode[],
  keys: KeyFactory,
  inheritedMarks: string[] = [],
): { children: PortableTextSpan[]; markDefs: Array<Record<string, unknown>> } {
  const children: PortableTextSpan[] = [];
  const markDefs: Array<Record<string, unknown>> = [];

  const visit = (node: MdNode, marks: string[]) => {
    switch (node.type) {
      case "text":
        children.push({
          _type: "span",
          _key: keys.next("s"),
          text: node.value ?? "",
          ...(marks.length ? { marks } : {}),
        });
        break;
      case "strong":
        for (const child of node.children ?? []) visit(child, [...marks, "strong"]);
        break;
      case "emphasis":
        for (const child of node.children ?? []) visit(child, [...marks, "em"]);
        break;
      case "delete":
        for (const child of node.children ?? []) visit(child, [...marks, "strike-through"]);
        break;
      case "inlineCode":
        children.push({
          _type: "span",
          _key: keys.next("s"),
          text: node.value ?? "",
          marks: [...marks, "code"],
        });
        break;
      case "break":
        children.push({
          _type: "span",
          _key: keys.next("s"),
          text: "\n",
          ...(marks.length ? { marks } : {}),
        });
        break;
      case "link": {
        const key = keys.next("m");
        markDefs.push({
          _type: "link",
          _key: key,
          href: node.url ?? "",
          blank: /^https?:\/\//i.test(node.url ?? ""),
        });
        for (const child of node.children ?? []) visit(child, [...marks, key]);
        break;
      }
      default:
        for (const child of node.children ?? []) visit(child, marks);
    }
  };

  for (const node of nodes) visit(node, inheritedMarks);

  if (children.length === 0) {
    children.push({ _type: "span", _key: keys.next("s"), text: "" });
  }

  return { children, markDefs };
}

function textBlock(
  node: MdNode,
  keys: KeyFactory,
  style: string,
  extra: Record<string, unknown> = {},
): PortableTextBlock {
  const inline = inlineToSpans(node.children ?? [], keys);
  return {
    _type: "block",
    _key: keys.next("b"),
    style,
    children: inline.children,
    ...(inline.markDefs.length ? { markDefs: inline.markDefs } : {}),
    ...extra,
  };
}

function plainText(node: MdNode): string {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(plainText).join("");
}

function imageBlock(node: MdNode, source: GitHubSource, keys: KeyFactory): PortableTextBlock {
  return {
    _type: "githubImage",
    _key: keys.next("i"),
    url: resolveGitHubAssetUrl(source, node.url ?? ""),
    alt: node.alt ?? "",
    caption: node.title ?? "",
  };
}

function tableBlock(node: MdNode, keys: KeyFactory): PortableTextBlock {
  const rows = (node.children ?? []).map((row, rowIndex) => ({
    _type: "tableRow",
    _key: keys.next("r"),
    cells: (row.children ?? []).map((cell, cellIndex) => {
      const inline = inlineToSpans(cell.children ?? [], keys);
      return {
        _type: "tableCell",
        _key: keys.next("c"),
        content: inline.children,
        ...(inline.markDefs.length ? { markDefs: inline.markDefs } : {}),
        ...(rowIndex === 0 ? { isHeader: true } : {}),
        ...(node.align?.[cellIndex] ? { textAlign: node.align[cellIndex] } : {}),
      };
    }),
  }));

  return {
    _type: "table",
    _key: keys.next("t"),
    rows,
    hasHeaderRow: rows.length > 0,
  };
}

function calloutFromBlockquote(
  node: MdNode,
  keys: KeyFactory,
): PortableTextBlock | null {
  const text = plainText(node).trim();
  const match = text.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*([\s\S]*)$/i);
  if (!match) return null;

  return {
    _type: "githubCallout",
    _key: keys.next("a"),
    tone: match[1]!.toLowerCase(),
    text: match[2]!.trim(),
  };
}

function convertNodes(nodes: MdNode[], source: GitHubSource, keys: KeyFactory): PortableTextBlock[] {
  const output: PortableTextBlock[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "heading":
        output.push(textBlock(node, keys, `h${Math.min(6, Math.max(1, node.depth ?? 2))}`));
        break;

      case "paragraph": {
        const children = node.children ?? [];
        if (children.length === 1 && children[0]?.type === "image") {
          output.push(imageBlock(children[0], source, keys));
        } else {
          output.push(textBlock(node, keys, "normal"));
        }
        break;
      }

      case "blockquote": {
        const callout = calloutFromBlockquote(node, keys);
        if (callout) {
          output.push(callout);
          break;
        }
        const firstParagraph = (node.children ?? []).find((child) => child.type === "paragraph");
        if (firstParagraph) output.push(textBlock(firstParagraph, keys, "blockquote"));
        break;
      }

      case "list": {
        const listItem = node.ordered ? "number" : "bullet";
        let index = node.start ?? 1;
        for (const item of node.children ?? []) {
          for (const child of item.children ?? []) {
            if (child.type !== "paragraph") continue;
            output.push(
              textBlock(child, keys, "normal", {
                listItem,
                level: 1,
                ...(node.ordered ? { listStart: index } : {}),
              }),
            );
            index += 1;
          }
        }
        break;
      }

      case "code": {
        let filename: string | undefined;
        const filenameMatch = node.meta?.match(/(?:title|filename)=["']([^"']+)["']/);
        if (filenameMatch) filename = filenameMatch[1];

        output.push({
          _type: "code",
          _key: keys.next("d"),
          code: node.value ?? "",
          ...(node.lang ? { language: node.lang } : {}),
          ...(filename ? { filename } : {}),
        });
        break;
      }

      case "table":
        output.push(tableBlock(node, keys));
        break;

      case "thematicBreak":
        output.push({ _type: "horizontalRule", _key: keys.next("h") });
        break;

      case "html":
        output.push({ _type: "htmlBlock", _key: keys.next("x"), html: node.value ?? "" });
        break;

      default:
        if (node.children?.length) output.push(...convertNodes(node.children, source, keys));
    }
  }

  return output;
}

export function parseMarkdown(markdown: string, source: GitHubSource): ParsedMarkdown {
  const parsed = matter(markdown);
  const tree = unified().use(remarkParse).use(remarkGfm).parse(parsed.content) as MdNode;
  const keys = new KeyFactory();

  const canonicalVisible = asBoolean(parsed.data.visible);
  const compatibilityVisible = asBoolean(parsed.data.visiable);
  const visible = canonicalVisible ?? compatibilityVisible ?? false;

  return {
    frontmatter: parsed.data as Record<string, unknown>,
    title: asString(parsed.data.title),
    slug: asString(parsed.data.slug),
    description: asString(parsed.data.description),
    visible,
    body: convertNodes(tree.children ?? [], source, keys),
  };
}
