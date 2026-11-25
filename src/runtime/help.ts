import { z } from "zod";
import type { HelpReply, HelpState, Explanation, Proof } from "@/lib/proof-types";
import { kvGet, kvSet } from "./db";
import { newId } from "./ids";

/**
 * Ask a friend: one HTML file a person can send to anyone. The friend opens it in a browser (no
 * account, no install, works offline), reads the change, leaves notes and sends back a reply.
 * Nothing is uploaded: the file travels however the two people already talk.
 */

const key = (sid: string) => `help:${sid}`;
export const getHelp = (sid: string) => kvGet<HelpState>(key(sid));

export function saveHelp(sid: string, patch: Partial<HelpState>): HelpState {
  const cur = getHelp(sid) ?? { id: newId("help"), ask: "", at: new Date().toISOString(), replies: [], explanation: null };
  const next = { ...cur, ...patch };
  kvSet(key(sid), next);
  return next;
}

const replySchema = z.object({
  format: z.literal("nexus-reply/v1"),
  id: z.string().max(80),
  from: z.string().trim().min(1).max(40),
  verdict: z.enum(["good", "changes", "question"]),
  overall: z.string().trim().max(2000),
  notes: z.array(z.object({ file: z.string().max(400), text: z.string().trim().min(1).max(1000) })).max(60),
});

export function parseReply(text: string, id: string): Omit<HelpReply, "at"> {
  let j: unknown;
  try {
    j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  } catch {
    throw new Error("That isn't a Nexus reply. Paste everything your friend copied.");
  }
  const p = replySchema.safeParse(j);
  if (!p.success) throw new Error("That reply is incomplete. Ask your friend to copy it again.");
  if (p.data.id !== id) throw new Error("That reply belongs to a different change.");
  const { from, verdict, overall, notes } = p.data;
  return { from, verdict, overall, notes };
}

export function addReply(sid: string, text: string): HelpState {
  const h = getHelp(sid);
  if (!h) throw new Error("Make a help file for this change first.");
  const r = parseReply(text, h.id);
  const same = (x: HelpReply) => JSON.stringify([x.from, x.verdict, x.overall, x.notes]) === JSON.stringify([r.from, r.verdict, r.overall, r.notes]);
  if (h.replies.some(same)) throw new Error("You already added this reply.");
  return saveHelp(sid, { replies: [...h.replies, { ...r, at: new Date().toISOString() }].slice(-20) });
}

export type PacketData = { id: string; project: string; task: string; ask: string; explanation: Explanation | null; proof: Pick<Proof, "items">; files: { path: string; status: string; additions: number; deletions: number; patch: string }[] };

/** JSON that is safe inside a <script> tag. */
export const scriptJson = (v: unknown) => JSON.stringify(v).replace(/[<>&\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** The page builds everything with textContent, and its CSP allows no network at all. */
export function buildPacket(d: PacketData): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Can you look at this? A Nexus help request</title><style>
:root{color-scheme:light dark;--bg:#fff;--ink:#111;--dim:#5c5c5c;--line:#d8d8d8;--soft:#f5f5f5;--add:#0a6b2d;--del:#a3241b}
@media(prefers-color-scheme:dark){:root{--bg:#0a0a0a;--ink:#f3f3f3;--dim:#a8a8a8;--line:#333;--soft:#161616;--add:#7ad39a;--del:#f3938b}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,sans-serif}main{max-width:780px;margin:auto;padding:32px 18px 80px}
h1{font-size:28px;line-height:1.2;margin:0 0 8px}h2{font-size:19px;margin:34px 0 8px}p{margin:6px 0}.dim{color:var(--dim);font-size:14px}.ask{border-left:3px solid var(--ink);padding:4px 14px;font-size:18px;margin:18px 0;white-space:pre-wrap}
details{border:1px solid var(--line);margin:8px 0}summary{padding:12px;cursor:pointer;min-height:44px;overflow-wrap:anywhere}.in{padding:0 12px 12px}
pre{overflow:auto;max-height:420px;background:var(--soft);padding:10px;font:12.5px/1.5 ui-monospace,monospace;margin:0 0 10px}.a{color:var(--add)}.d{color:var(--del)}
label{display:block;font-weight:600;margin-top:12px}input,textarea,select,button{font:inherit;color:inherit;background:var(--bg);border:1px solid var(--dim);padding:10px;width:100%;min-height:44px;border-radius:3px}textarea{min-height:84px;resize:vertical}
button{width:auto;background:var(--ink);color:var(--bg);border-color:var(--ink);padding:10px 18px;cursor:pointer;margin:14px 8px 0 0}button.two{background:none;color:var(--ink)}:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
</style></head><body><main id="m"></main><script>
"use strict";const D=${scriptJson(d)};
const m=document.getElementById("m");
const el=(t,o,p)=>{const e=document.createElement(t);Object.assign(e,o||{});(p||m).append(e);return e};
el("h1",{textContent:"Can you look at this change?"});
el("p",{className:"dim",textContent:"Someone made this change in "+D.project+" with a coding agent and would like a person's opinion. You don't need an account, an app or the code. Nothing you type leaves this page until you send it yourself."});
el("p",{className:"ask",textContent:D.ask});
el("h2",{textContent:"What changed"});
if(D.explanation){const x=D.explanation;el("p",{textContent:x.summary});const ol=el("ol");x.how.forEach(h=>el("li",{textContent:h},ol));
if(x.terms.length){const t=el("details");el("summary",{textContent:"Words that may be new"},t);const i=el("div",{className:"in"},t);x.terms.forEach(v=>{const p=el("p",{},i);el("strong",{textContent:v.term+": "},p);p.append(v.meaning)})}
el("p",{className:"dim",textContent:"Explained by "+x.engine+". It can be wrong; the changes below are the source."})}
else el("p",{textContent:"The request was: "+D.task});
if(D.proof.items.length){el("h2",{textContent:"Nexus noticed"});const u=el("ul");D.proof.items.slice(0,12).forEach(i=>el("li",{textContent:i.text+(i.file?" ("+i.file+(i.line?", line "+i.line:"")+")":"")},u))}
el("h2",{textContent:D.files.length+(D.files.length===1?" file":" files")+" to look at"});
const notes=[];D.files.forEach((f,n)=>{const d=el("details",{open:n===0});el("summary",{textContent:f.path+"  (+"+f.additions+" -"+f.deletions+")"},d);const i=el("div",{className:"in"},d);const pre=el("pre",{tabIndex:0},i);
let go=false;f.patch.split("\\n").forEach(l=>{if(l.startsWith("@@"))go=true;if(!go&&/^(diff|index|---|\\+\\+\\+|new file|deleted file)/.test(l))return;el("span",{className:l[0]==="+"?"a":l[0]==="-"?"d":"",textContent:l+"\\n"},pre)});
const id="n"+n;el("label",{htmlFor:id,textContent:"Your note on this file (optional)"},i);const t=el("textarea",{id,maxLength:1000},i);notes.push([f.path,t])});
el("h2",{textContent:"Your reply"});
el("label",{htmlFor:"from",textContent:"First name or nickname"});const from=el("input",{id:"from",maxLength:40,autocomplete:"off"});
el("label",{htmlFor:"v",textContent:"What do you think?"});const v=el("select",{id:"v"});[["good","Looks good to me"],["changes","I'd change something"],["question","I have a question"]].forEach(o=>el("option",{value:o[0],textContent:o[1]},v));
el("label",{htmlFor:"o",textContent:"Anything else, including what they did well"});const o=el("textarea",{id:"o",maxLength:2000});
const out=()=>{if(!from.value.trim()){say("Add a name first, so they know who helped.");from.focus();return null}return JSON.stringify({format:"nexus-reply/v1",id:D.id,from:from.value.trim(),verdict:v.value,overall:o.value.trim(),notes:notes.filter(n=>n[1].value.trim()).map(n=>({file:n[0],text:n[1].value.trim()}))},null,1)};
const copy=el("button",{textContent:"Copy reply"}),dl=el("button",{className:"two",textContent:"Save reply as a file"});const st=el("p",{className:"dim"});st.setAttribute("role","status");const say=t=>{st.textContent=t};
const box=el("textarea",{hidden:true,readOnly:true});box.setAttribute("aria-label","Your reply to copy");
copy.onclick=async()=>{const t=out();if(!t)return;try{await navigator.clipboard.writeText(t);say("Copied. Paste it into a message to them.")}catch{box.hidden=false;box.value=t;box.select();say("Copy the text in the box and send it to them.")}};
dl.onclick=()=>{const t=out();if(!t)return;const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([t],{type:"application/json"}));a.download="nexus-reply.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);say("Saved. Send nexus-reply.json to them.")};
</script></body></html>`;
}
