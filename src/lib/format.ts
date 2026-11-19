/** Client-safe path shortener: /Users/name/... becomes ~/... */
export function tidyPath(p: string) {
  return p.replace(/^\/(Users|home)\/[^/]+/, "~");
}
