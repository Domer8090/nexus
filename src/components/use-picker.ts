"use client";

import { useEffect, useRef, useState } from "react";
import { PICK_EVENT, type PickedElement } from "./composer";

const str = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** Lets the person click something inside a preview frame. Only that frame, at its own address, is heard. */
export function usePicker(url: string | null, scope: (string | null | undefined)[]) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [on, setOn] = useState(false);
  const ids = scope.filter(Boolean).join(",");
  useEffect(() => {
    if (!url) return;
    const origin = new URL(url).origin;
    const post = (v: boolean) => frame.current?.contentWindow?.postMessage({ nexus: "pick", on: v }, origin);
    post(on);
    const msg = (e: MessageEvent) => {
      if (e.origin !== origin || e.source !== frame.current?.contentWindow || typeof e.data !== "object" || !e.data) return;
      if (e.data.nexus === "ready") return post(on);
      if (e.data.nexus === "cancel") return setOn(false);
      // A page could post this by itself, so it counts only while the person is picking.
      if (e.data.nexus !== "picked" || !on) return;
      const d = e.data as Record<string, unknown>;
      const element: PickedElement = { selector: str(d.selector, 300), tag: str(d.tag, 30), text: str(d.text, 160), html: str(d.html, 500), page: str(d.page, 200) };
      setOn(false);
      window.dispatchEvent(new CustomEvent(PICK_EVENT, { detail: { scope: ids.split(","), element } }));
    };
    const point = (e: Event) => ids.split(",").includes((e as CustomEvent<string>).detail) && setOn(true);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOn(false);
    window.addEventListener("message", msg);
    window.addEventListener("nexus:point", point);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("message", msg);
      window.removeEventListener("nexus:point", point);
      window.removeEventListener("keydown", esc);
    };
  }, [url, on, ids]);
  return { frame, on, setOn };
}
