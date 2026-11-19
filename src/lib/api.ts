/** Small helpers shared by route handlers. */
export function bad(message: string, status = 400, code = "invalid") {
  return Response.json({ error: { code, message } }, { status });
}

export async function body<T = Record<string, unknown>>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}
