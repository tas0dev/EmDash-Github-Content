export interface GitHubSource {
  owner: string;
  repo: string;
  branch: string;
  path: string;
}

export interface ImportTarget {
  collection: string;
  titleField?: string;
  bodyField: string;
  slugField?: string;
  descriptionField?: string;
}

export interface SourceRecord {
  source: GitHubSource;
  target: ImportTarget;
  entryId: string;
  sha: string;
  visible: boolean;
  updatedAt: string;
}

export interface PortableTextSpan {
  _type: "span";
  _key: string;
  text: string;
  marks?: string[];
}

export interface PortableTextBlock {
  _type: string;
  _key: string;
  [key: string]: unknown;
}

export interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  title: string | null;
  slug: string | null;
  description: string | null;
  visible: boolean;
  body: PortableTextBlock[];
}
