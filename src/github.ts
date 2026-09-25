import type { RouteContext } from "emdash";

import type { GitHubSource } from "./types.js";

interface GitHubFileResponse {
  type: string;
  encoding?: string;
  content?: string;
  sha: string;
  download_url?: string | null;
}

function decodeBase64Utf8(input: string): string {
  const clean = input.replace(/\n/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export async function fetchGitHubMarkdown(
  ctx: RouteContext,
  source: GitHubSource,
): Promise<{ markdown: string; sha: string }> {
  if (!ctx.http) throw new Error("Network access is unavailable");

  const token = await ctx.settings.get<string>("githubToken");
  const url = new URL(
    `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/contents/${source.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
  );
  url.searchParams.set("ref", source.branch);

  const headers = new Headers({
    Accept: "application/vnd.github+json",
    "User-Agent": "emdash-github-content",
    "X-GitHub-Api-Version": "2022-11-28",
  });
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await ctx.http.fetch(url.toString(), { headers });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GitHub returned ${response.status}: ${detail.slice(0, 300)}`);
  }

  const file = (await response.json()) as GitHubFileResponse;
  if (file.type !== "file" || file.encoding !== "base64" || !file.content) {
    throw new Error("The selected GitHub path is not a readable file");
  }

  return {
    markdown: decodeBase64Utf8(file.content),
    sha: file.sha,
  };
}

export function resolveGitHubAssetUrl(source: GitHubSource, assetPath: string): string {
  if (/^https?:\/\//i.test(assetPath)) return assetPath;

  const baseParts = source.path.split("/");
  baseParts.pop();

  for (const part of assetPath.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }

  const encodedPath = baseParts.map(encodeURIComponent).join("/");
  return `https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(
    source.repo,
  )}/${encodeURIComponent(source.branch)}/${encodedPath}`;
}
