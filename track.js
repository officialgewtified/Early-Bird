/* Early Bird's report card, kept honestly: every hour this records the coins the Fresh list shows (Passed, Caution and
   Sketchy alike), with the verdict, Early score and coach's buy signal they had when first seen. It then re-checks each one 1, 3, 6, 12 and 24
   hours later, so the site can show how each kind of coin really did. Runs in GitHub Actions; writes history.json.
   usage: node track.js */
"use strict";
const fs=require("fs"),path=require("path"),EB=require("./eb-core.js");
const FILE=path.join(__dirname,"history.json"),KEEP_DAYS=8,PER_RUN=30,CHECKS=[1,3,6,12,24];
const r3=x=>x==null||!isFinite(x)?null:Math.round(x*1000)/1000,r0=x=>x==null||!isFinite(x)?null:Math.round(x);
(async()=>{
 let h={v:1,rows:[],runs:0};try{h=JSON.parse(fs.readFileSync(FILE,"utf8"))}catch(e){}
 const get=EB.makeGet(globalThis.fetch),now=Date.now();
 // 1. what the Fresh list shows right now, with the site's default settings
 const scan=await EB.scan(get,"fresh",{now});
 const seen=new Set(h.rows.map(x=>x.m));let added=0;
 for(const c of scan.coins.slice(0,PER_RUN)){if(seen.has(c.mint)||!c.price)continue;
  h.rows.push({m:c.mint,s:String(c.sym||"").slice(0,16),t:now,v:c.verdict,sc:c.score,p:c.price,mc:r0(c.mcap),lq:r0(c.liq),a:r3(c.ageH),bs:EB.buySignal(c).lvl,
   f:c.checks.filter(f=>f.level==="bad"||f.level==="warn").map(f=>f.k)});added++}
 // the coach's buy signals on the Hot list too (marked h:1 and kept out of the Fresh list's report card), so its record isn't only fresh coins
 let hotSig=0;try{const hot=await EB.scan(get,"hot",{now});const seen2=new Set(h.rows.map(x=>x.m));
  for(const c of hot.coins){const bs=EB.buySignal(c).lvl;if(!bs||seen2.has(c.mint)||!c.price)continue;
   h.rows.push({m:c.mint,s:String(c.sym||"").slice(0,16),t:now,v:c.verdict,sc:c.score,p:c.price,mc:r0(c.mcap),lq:r0(c.liq),a:r3(c.ageH),bs,h:1,f:[]});hotSig++}}catch(e){}
 // 2. re-check coins that are due (1, 3, 6, 12 and 24 hours after they were first seen)
 const due=h.rows.filter(x=>CHECKS.some(k=>x["c"+k]===undefined&&now-x.t>=k*36e5));
 let checked=0;
 if(due.length){const{q,failed}=await EB.quotes(get,due.map(x=>x.m),0);
  for(const x of due){const n=q[x.m];if(!n&&failed)continue;     // a failed lookup isn't a dead coin; try again next hour
   for(const k of CHECKS){if(x["c"+k]!==undefined||now-x.t<k*36e5)continue;
    if(now-x.t>k*36e5*1.5+36e5){x["c"+k]=null;continue}   // too late to count as that checkpoint (e.g. a check added after the coin was first seen)
    // [price change since first seen, pool size now vs then]; no pool found at all counts as gone
    x["c"+k]=n&&n.price?[r3(n.price/x.p-1),x.lq?r3(n.liq/x.lq):null]:[-1,0];checked++}}}
 // 3. keep about a week
 h.rows=h.rows.filter(x=>now-x.t<KEEP_DAYS*864e5);
 h.updated=now;h.runs=(h.runs||0)+1;h.last={coins:scan.coins.length,added,checked,fails:scan.fails};
 fs.writeFileSync(FILE,JSON.stringify(h));
 console.log(`Fresh list: ${scan.coins.length} coins, ${added} new recorded, ${hotSig} Hot buy signals, ${checked} re-checks, sources down: ${scan.fails.join(", ")||"none"}. ${h.rows.length} coins on record.`);
})().catch(e=>{console.error(e);process.exit(1)});
