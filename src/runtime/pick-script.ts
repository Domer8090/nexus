/**
 * Added to pages the preview server shows inside Nexus. Idle until Nexus asks; then it outlines what
 * is under the pointer, and one click reports that element to the window that holds the frame.
 */
export const PICK_SCRIPT = `<script>(function(){
if(window.parent===window)return;
var on=false,box=null,parentOrigin=null;
function sel(el){var out=[];for(var n=el;n&&n.nodeType===1&&out.length<5;n=n.parentElement){
var s=n.tagName.toLowerCase();if(n.id){out.unshift(s+"#"+CSS.escape(n.id));break}
var c=[].slice.call(n.classList,0,2).map(function(x){return"."+CSS.escape(x)}).join("");s+=c;
var p=n.parentElement;if(p){var same=[].filter.call(p.children,function(k){return k.tagName===n.tagName});if(same.length>1)s+=":nth-of-type("+(same.indexOf(n)+1)+")"}
out.unshift(s)}return out.join(" > ")}
function bare(el){var c=el.cloneNode(true);[].forEach.call(c.querySelectorAll("script,style"),function(x){x.remove()});return c.outerHTML.slice(0,500)}
function set(v){on=v;document.documentElement.style.cursor=v?"crosshair":"";if(!v&&box){box.remove();box=null}}
function move(e){if(!on)return;var r=e.target.getBoundingClientRect();if(!box){box=document.createElement("div");box.style.cssText="position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #ff3b30;background:rgba(255,59,48,.12);border-radius:3px";document.documentElement.appendChild(box)}
box.style.left=r.left-2+"px";box.style.top=r.top-2+"px";box.style.width=r.width+"px";box.style.height=r.height+"px"}
function stop(e){if(on){e.preventDefault();e.stopImmediatePropagation()}}
function click(e){if(!on)return;stop(e);var el=e.target;window.parent.postMessage({nexus:"picked",selector:sel(el),tag:el.tagName.toLowerCase(),text:(el.innerText||el.alt||el.value||"").slice(0,160),html:bare(el),page:location.pathname.split("/").slice(3).join("/")},parentOrigin);set(false)}
addEventListener("message",function(e){if(e.source!==window.parent||!e.data||e.data.nexus!=="pick")return;if(!/^http:\\/\\/(127\\.0\\.0\\.1|localhost)(:\\d+)?$/.test(e.origin))return;parentOrigin=e.origin;set(!!e.data.on)});
addEventListener("mousemove",move,true);["mousedown","mouseup","pointerdown","pointerup"].forEach(function(t){addEventListener(t,stop,true)});addEventListener("click",click,true);
addEventListener("keydown",function(e){if(on&&e.key==="Escape"){stop(e);window.parent.postMessage({nexus:"cancel"},parentOrigin);set(false)}},true);
window.parent.postMessage({nexus:"ready"},"*");
})();</script>`;
