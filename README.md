# EmDash GitHub Content

Import Markdown files from GitHub and turn them into editable EmDash Portable Text.

## Current features

- GitHub repository, branch and Markdown path selection
- GitHub token support for private repositories
- Preview before import
- Create and update an EmDash entry from the same GitHub source
- GitHub SHA tracking to avoid unnecessary rewrites
- Markdown to Portable Text conversion for:
  - paragraphs and headings
  - bold, italic, strikethrough and inline code
  - links
  - ordered and unordered lists
  - blockquotes
  - fenced code blocks
  - GFM tables
  - horizontal rules
  - raw HTML blocks
  - Markdown images
  - GitHub-style alerts such as `> [!NOTE]`
- frontmatter values are copied automatically when a field with the same slug exists in the target Collection
- publication is controlled by frontmatter `visible: true | false`

## Frontmatter

```md
---
title: Capability Security
slug: capability-security
description: How mochiOS limits damage from compromised software.
visible: true
category: Security
---

# Capability Security

...
```

`visible: true` publishes the imported entry.

`visible: false` keeps a new entry as a draft. If a previously synchronized entry is already published, synchronizing it again with `visible: false` unpublishes it.

For compatibility, the misspelling `visiable` is also accepted, but `visible` is the canonical key.

Any other frontmatter field is copied into the destination entry when the selected EmDash Collection contains a field with the same slug.

## Install locally

Build this package:

```sh
npm install
npm run build
```

Install it from your EmDash site:

```sh
npm install ../EmDash-Github-Content
```

Then register it in the site's EmDash/Astro configuration:

```ts
import { githubContentPlugin } from "emdash-github-content";

export default defineConfig({
  plugins: [
    githubContentPlugin(),
  ],
});
```

The plugin requires these EmDash capabilities:

- `network:request` — read Markdown from `api.github.com`
- `schema:read` — inspect target Collections and fields
- `content:write` — create/update synchronized entries
- `content:publish` — implement `visible: true | false`

## Image behavior

Relative Markdown image paths are resolved to `raw.githubusercontent.com` URLs and stored as the plugin's `githubImage` Portable Text block.

This works directly for public repositories. Private-repository image mirroring into the EmDash Media Library is not implemented yet.

## Sync identity

The source identity is:

```text
owner/repository@branch:path/to/file.md
```

The plugin stores the GitHub blob SHA and the destination EmDash entry ID. Re-importing the same source updates the existing entry rather than creating another one.
