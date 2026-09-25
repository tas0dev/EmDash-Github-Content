import GitHubCallout from "./GitHubCallout.astro";
import GitHubImage from "./GitHubImage.astro";

export { GitHubCallout as githubCallout, GitHubImage as githubImage };

export const blockComponents = {
  githubCallout: GitHubCallout,
  githubImage: GitHubImage,
} as const;
