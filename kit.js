/* Kit: backup and restore for all the sites, pull to refresh, and the win celebration. Shared by Gridline, Baseline, Crossover and Early Bird. */
window.Kit=(function(){
"use strict";
const KEEP=/^(pb_|bl_|cx_|eb_|arena_)/;      // everything the sites save on this phone (they share it), Early Bird included
const RM=matchMedia("(prefers-reduced-motion: reduce)");
/* pull down from the top to refresh, on the home-screen version (in Safari, Safari already does this itself) */
(function(){
 let standalone=false;try{standalone=navigator.standalone===true||matchMedia("(display-mode: standalone)").matches}catch(e){}
 if(!standalone||!("ontouchstart" in window))return;
 const GO=80;let el=null,svg=null,x0=0,y0=0,on=false,live=false,d=0,busy=false;
 function ind(){if(el)return el;el=document.createElement("div");el.className="kit-ptr";el.setAttribute("aria-hidden","true");
  el.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M19.5 3.8v5h-5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  document.body.appendChild(el);svg=el.firstChild;return el}
 function show(){const e=ind(),k=Math.min(1,d/GO);e.classList.add("pull");e.classList.toggle("ready",d>=GO);
  e.style.transform=`translateY(${Math.min(d*.6,96).toFixed(1)}px)`;e.style.opacity=Math.min(1,d/36).toFixed(2);svg.style.transform=`rotate(${(k*300).toFixed(0)}deg)`}
 function hide(){if(!el)return;el.classList.remove("pull","ready");el.style.transform="";el.style.opacity=""}
 const skip=t=>busy||window.scrollY>0||document.querySelector("dialog[open]")||(document.activeElement&&document.activeElement.matches("input,textarea,select"))||(t&&t.closest&&t.closest("#slip.open,.kit-cheer"));
 addEventListener("touchstart",e=>{on=false;live=false;d=0;if(e.touches.length!==1||skip(e.target))return;on=true;x0=e.touches[0].clientX;y0=e.touches[0].clientY},{passive:true});
 addEventListener("touchmove",e=>{if(!on)return;const dx=e.touches[0].clientX-x0,dy=e.touches[0].clientY-y0;
  if(!live){if(Math.abs(dx)<8&&Math.abs(dy)<8)return;if(dy<=0||Math.abs(dx)>dy){on=false;return}live=true}   // only a pull straight down counts
  d=Math.max(0,dy);show()},{passive:true});
 addEventListener("touchend",()=>{if(!on||!live){on=false;return}on=false;live=false;
  if(d>=GO){busy=true;const e=ind();e.classList.remove("pull");e.classList.add("spin");e.style.transform="translateY(56px)";e.style.opacity="1";setTimeout(()=>location.reload(),220)}
  else hide()},{passive:true});
 addEventListener("touchcancel",()=>{on=false;live=false;hide()},{passive:true});
})();
function snapshot(){const data={};try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(KEEP.test(k))data[k]=localStorage.getItem(k)}}catch(e){}return data}
return{
 /* save a backup file: on a phone the share menu offers Save to Files; elsewhere it downloads */
 backup(btn){const data=snapshot(),n=Object.keys(data).length,day=new Date().toLocaleDateString("en-CA");
  const blob=new Blob([JSON.stringify({app:"RepoBoard",v:1,at:new Date().toISOString(),data},null,1)],{type:"application/json"});
  const name=`picks-backup-${day}.json`,file=new File([blob],name,{type:"application/json"});
  let can=false;try{can=!!(navigator.canShare&&navigator.canShare({files:[file]}))}catch(e){}
  if(can){navigator.share({files:[file],title:"Picks backup"}).catch(()=>{});}
  else{const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},3000)}
  if(btn){const t=btn.textContent;btn.textContent=`Saved ${n} items`;setTimeout(()=>{btn.textContent=t},2200)}},
 /* read a backup file back in, after asking; replaces what's on this phone */
 restore(){const inp=document.createElement("input");inp.type="file";inp.accept=".json,application/json";
  inp.onchange=()=>{const f=inp.files&&inp.files[0];if(!f)return;const rd=new FileReader();
   rd.onload=()=>{let j;try{j=JSON.parse(rd.result)}catch(e){alert("That file isn't a picks backup.");return}
    if(!j||j.app!=="RepoBoard"||!j.data||typeof j.data!=="object"){alert("That file isn't a picks backup.");return}
    const keys=Object.keys(j.data).filter(k=>KEEP.test(k));if(!keys.length){alert("That backup is empty.");return}
    const when=j.at?new Date(j.at).toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}):"an earlier day";
    if(!confirm(`Restore your tickets, slips and settings from ${when}? This replaces what's saved on this phone for all three sites.`))return;
    try{const old=[];for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(KEEP.test(k))old.push(k)}old.forEach(k=>localStorage.removeItem(k));
     keys.forEach(k=>localStorage.setItem(k,String(j.data[k])))}catch(e){alert("Couldn't restore: this phone's storage is full or blocked.");return}
    location.reload()};
   rd.readAsText(f)};
  inp.click()},
 /* confetti in the site's colors and a banner, once per win */
 cheer(text,sub){const doc=document.documentElement,css=getComputedStyle(doc),led=css.getPropertyValue("--led").trim()||"#ffb420",go=css.getPropertyValue("--go").trim()||"#35e2a0";
  if(navigator.vibrate&&(!navigator.userActivation||navigator.userActivation.hasBeenActive)){try{navigator.vibrate([18,50,18,50,40])}catch(e){}}
  const wrap=document.createElement("div");wrap.className="kit-cheer";wrap.setAttribute("role","status");
  wrap.innerHTML=`<div class="kit-ban"><b>${text}</b>${sub?`<small>${sub}</small>`:""}</div>`;
  if(!RM.matches){const cols=[led,go,"#ffffff",led,"#ffe08a"];for(let i=0;i<90;i++){const p=document.createElement("i"),w=6+Math.random()*7;
   p.style.cssText=`left:${Math.random()*100}vw;width:${w}px;height:${w*(.4+Math.random()*.9)}px;background:${cols[i%cols.length]};--x:${(Math.random()*2-1)*120}px;--r:${Math.random()*900-450}deg;animation-delay:${Math.random()*.35}s;animation-duration:${1.6+Math.random()*1.2}s`;
   wrap.appendChild(p)}}
  document.body.appendChild(wrap);wrap.addEventListener("click",()=>wrap.remove());setTimeout(()=>wrap.remove(),3600)}
}})();
