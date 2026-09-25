import type { PluginAdminExports } from "emdash";
import { apiFetch, parseApiResponse } from "emdash/plugin-utils";
import * as React from "react";

type Field = { slug: string; label: string; type: string };
type Collection = {
  slug: string;
  label: string;
  titleField: string | null;
  fields: Field[];
};

type Preview = {
  sha: string;
  title: string | null;
  slug: string | null;
  description: string | null;
  visible: boolean;
  blockCount: number;
  frontmatter: Record<string, unknown>;
};

async function pluginPost<T>(route: string, body?: unknown): Promise<T> {
  const response = await apiFetch(`/_emdash/api/plugins/github-content/${route}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  return parseApiResponse<T>(response, "GitHub Content request failed");
}

function GitHubContentPage() {
  const [collections, setCollections] = React.useState<Collection[]>([]);
  const [owner, setOwner] = React.useState("");
  const [repo, setRepo] = React.useState("");
  const [branch, setBranch] = React.useState("main");
  const [path, setPath] = React.useState("README.md");
  const [collectionSlug, setCollectionSlug] = React.useState("");
  const [bodyField, setBodyField] = React.useState("");
  const [titleField, setTitleField] = React.useState("");
  const [slugField, setSlugField] = React.useState("");
  const [descriptionField, setDescriptionField] = React.useState("");
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [message, setMessage] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    void pluginPost<{ collections: Collection[] }>("collections")
      .then((result) => {
        setCollections(result.collections);
        const first = result.collections.find((item) =>
          item.fields.some((field) => field.type === "portableText"),
        );
        if (first) {
          setCollectionSlug(first.slug);
          const portable = first.fields.find((field) => field.type === "portableText");
          setBodyField(portable?.slug ?? "");
          setTitleField(first.titleField ?? "");
        }
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  const selectedCollection = collections.find((item) => item.slug === collectionSlug);
  const source = { owner, repo, branch, path };

  const selectCollection = (value: string) => {
    setCollectionSlug(value);
    const collection = collections.find((item) => item.slug === value);
    if (!collection) return;
    setBodyField(collection.fields.find((field) => field.type === "portableText")?.slug ?? "");
    setTitleField(collection.titleField ?? "");
    setSlugField(collection.fields.some((field) => field.slug === "slug") ? "slug" : "");
    setDescriptionField(
      collection.fields.some((field) => field.slug === "description") ? "description" : "",
    );
  };

  const runPreview = async () => {
    setLoading(true);
    setMessage("");
    try {
      const result = await pluginPost<Preview>("preview", { source });
      setPreview(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const runImport = async () => {
    setLoading(true);
    setMessage("");
    try {
      const result = await pluginPost<{
        action: string;
        entryId: string;
        visible: boolean;
        title: string | null;
      }>("import", {
        source,
        target: {
          collection: collectionSlug,
          bodyField,
          ...(titleField ? { titleField } : {}),
          ...(slugField ? { slugField } : {}),
          ...(descriptionField ? { descriptionField } : {}),
        },
      });
      setMessage(
        `${result.action}: ${result.title ?? result.entryId} · visible=${String(result.visible)}`,
      );
      await runPreview();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950";
  const labelClass = "grid gap-1 text-sm font-medium";

  return (
    <section className="mx-auto max-w-5xl space-y-6 p-1">
      <div>
        <h1 className="text-2xl font-semibold">GitHub Content</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Import Markdown from GitHub as editable EmDash Portable Text.
        </p>
      </div>

      <div className="grid gap-4 rounded-xl border border-neutral-200 p-5 md:grid-cols-2">
        <label className={labelClass}>
          Owner
          <input className={inputClass} value={owner} onChange={(e) => setOwner(e.target.value)} />
        </label>
        <label className={labelClass}>
          Repository
          <input className={inputClass} value={repo} onChange={(e) => setRepo(e.target.value)} />
        </label>
        <label className={labelClass}>
          Branch
          <input className={inputClass} value={branch} onChange={(e) => setBranch(e.target.value)} />
        </label>
        <label className={labelClass}>
          Markdown path
          <input className={inputClass} value={path} onChange={(e) => setPath(e.target.value)} />
        </label>
      </div>

      <div className="grid gap-4 rounded-xl border border-neutral-200 p-5 md:grid-cols-2">
        <label className={labelClass}>
          Collection
          <select
            className={inputClass}
            value={collectionSlug}
            onChange={(e) => selectCollection(e.target.value)}
          >
            {collections.map((collection) => (
              <option key={collection.slug} value={collection.slug}>
                {collection.label} ({collection.slug})
              </option>
            ))}
          </select>
        </label>

        <label className={labelClass}>
          Portable Text field
          <select className={inputClass} value={bodyField} onChange={(e) => setBodyField(e.target.value)}>
            {(selectedCollection?.fields ?? [])
              .filter((field) => field.type === "portableText")
              .map((field) => (
                <option key={field.slug} value={field.slug}>
                  {field.label} ({field.slug})
                </option>
              ))}
          </select>
        </label>

        <FieldSelect
          label="Title field"
          fields={selectedCollection?.fields ?? []}
          value={titleField}
          onChange={setTitleField}
        />
        <FieldSelect
          label="Slug field"
          fields={selectedCollection?.fields ?? []}
          value={slugField}
          onChange={setSlugField}
        />
        <FieldSelect
          label="Description field"
          fields={selectedCollection?.fields ?? []}
          value={descriptionField}
          onChange={setDescriptionField}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={loading || !owner || !repo || !path}
          onClick={() => void runPreview()}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Preview
        </button>
        <button
          type="button"
          disabled={loading || !owner || !repo || !path || !collectionSlug || !bodyField}
          onClick={() => void runImport()}
          className="rounded-md bg-neutral-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Import / Sync
        </button>
      </div>

      {message ? <p role="status" className="text-sm">{message}</p> : null}

      {preview ? (
        <div className="space-y-3 rounded-xl border border-neutral-200 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">{preview.title ?? "Untitled"}</h2>
            <span className="rounded-full border px-2 py-0.5 text-xs">
              visible: {String(preview.visible)}
            </span>
            <span className="text-xs text-neutral-500">{preview.blockCount} blocks</span>
          </div>
          {preview.description ? <p className="text-sm text-neutral-600">{preview.description}</p> : null}
          <pre className="overflow-auto rounded-lg bg-neutral-950 p-4 text-xs text-neutral-100">
            {JSON.stringify(preview.frontmatter, null, 2)}
          </pre>
        </div>
      ) : null}
    </section>
  );
}

function FieldSelect({
  label,
  fields,
  value,
  onChange,
}: {
  label: string;
  fields: Field[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <select
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-950"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Do not map</option>
        {fields.map((field) => (
          <option key={field.slug} value={field.slug}>
            {field.label} ({field.slug})
          </option>
        ))}
      </select>
    </label>
  );
}

export const pages: PluginAdminExports["pages"] = {
  "/": GitHubContentPage,
};
