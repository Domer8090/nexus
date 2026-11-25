/** Checks before a hackathon submission. Each says only what Nexus can see on this Mac. */
export type ReadyItem = { id: string; label: string; ok: boolean; fix: string };

/** Spoken words in a demo script: no headings, stage directions, tables or code. About 150 a minute. */
export function spokenWords(md: string) {
  return (
    md
      .replace(/```[\s\S]*?```/g, " ")
      .split("\n")
      .filter((l) => !/^\s*(#|\||\[|>?\s*\*\*YOU)/.test(l))
      .join(" ")
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .match(/[\p{L}\p{N}'’]+/gu)?.length ?? 0
  );
}

export const youLines = (...docs: (string | null)[]) => docs.reduce((n, t) => n + ((t ?? "").match(/^\W*YOU:/gm)?.length ?? 0), 0);

/** A link a judge could open: not localhost, not a placeholder. */
export const hasVideo = (t: string) => /https?:\/\/(?:www\.)?(?:youtu\.be\/[\w-]{6,}|youtube\.com\/(?:watch\?v=|shorts\/)[\w-]{6,}|vimeo\.com\/\d{5,}|loom\.com\/share\/\w{8,})/i.test(t);
