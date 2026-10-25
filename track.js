/* Early Bird's report card, kept honestly: every hour this records the coins the Fresh list shows (Passed, Caution and
   Sketchy alike), with the verdict, Early score and coach's buy signal they had when first seen. It then re-checks each one 1, 3, 6, 12 and 24
   hours later, so the site can show how each kind of coin really did. Runs in GitHub Actions; writes history.json.
   usage: node track.js */
"use strict";
const fs=require("fs"),path=require("path"),EB=require("./eb-core.js");
const FILE=path.join(__dirname,"history.json"),KEEP_DAYS=8,PER_RUN=30,CHECKS=[1,3,6,12,24];
// finished coins (every check done) also go into archive.json for 60 days, and insights.json sums up what predicted a dead coin
const AFILE=path.join(__dirname,"archive.json"),IFILE=path.join(__dirname,"insights.json"),ARCH_DAYS=60;
const r2=x=>x==null||!isFinite(x)?null:Math.round(x*100)/100;
const extra=c=>({top:r0(c.top10),dp:r2(c.devPct),og:r0(c.organic),ho:r0(c.holders),
 f:(c.checks||[]).filter(f=>f.level==="bad"||f.level==="warn").map(f=>f.level==="bad"?f.k+"!":f.k)});   // "k!" is the serious version of a flag
const r3=x=>x==null||!isFinite(x)?null:Math.round(x*1000)/1000,r0=x=>x==null||!isFinite(x)?null:Math.round(x);
(async()=>{
 let h={v:1,rows:[],runs:0};try{h=JSON.parse(fs.readFileSync(FILE,"utf8"))}catch(e){}
 // early records saved "no pool size reported" as an empty pool; a coin whose price is still there wasn't drained, so make those unknown
 for(const x of h.rows)for(const k of CHECKS){const v=x["c"+k];if(Array.isArray(v)&&v[1]===0&&v[0]>-1)v[1]=null}
 const get=EB.makeGet(globalThis.fetch),now=Date.now();
 // 1. what the Fresh list shows right now, with the site's default settings
 const scan=await EB.scan(get,"fresh",{now});
 const seen=new Set(h.rows.map(x=>x.m));let added=0;
 for(const c of scan.coins.slice(0,PER_RUN)){if(seen.has(c.mint)||!c.price)continue;
  h.rows.push(Object.assign({m:c.mint,s:String(c.sym||"").slice(0,16),t:now,v:c.verdict,sc:c.score,p:c.price,mc:r0(c.mcap),lq:r0(c.liq),a:r3(c.ageH),bs:EB.buySignal(c).lvl},extra(c)));added++}
 // the coach's buy signals on the Hot list too (marked h:1 and kept out of the Fresh list's report card), so its record isn't only fresh coins
 let hotSig=0;try{const hot=await EB.scan(get,"hot",{now});const seen2=new Set(h.rows.map(x=>x.m));
  for(const c of hot.coins){const bs=EB.buySignal(c).lvl;if(!bs||seen2.has(c.mint)||!c.price)continue;
   h.rows.push(Object.assign({m:c.mint,s:String(c.sym||"").slice(0,16),t:now,v:c.verdict,sc:c.score,p:c.price,mc:r0(c.mcap),lq:r0(c.liq),a:r3(c.ageH),bs,h:1},extra(c)));hotSig++}}catch(e){}
 // 2. re-check coins that are due (1, 3, 6, 12 and 24 hours after they were first seen)
 const due=h.rows.filter(x=>CHECKS.some(k=>x["c"+k]===undefined&&now-x.t>=k*36e5));
 let checked=0;
 if(due.length){const{q,failed}=await EB.quotes(get,due.map(x=>x.m),0);
  for(const x of due){const n=q[x.m];if(!n&&failed)continue;     // a failed lookup isn't a dead coin; try again next hour
   for(const k of CHECKS){if(x["c"+k]!==undefined||now-x.t<k*36e5)continue;
    if(now-x.t>k*36e5*1.5+36e5){x["c"+k]=null;continue}   // too late to count as that checkpoint (e.g. a check added after the coin was first seen)
    // [price change since first seen, pool size now vs then]; no pool found at all counts as gone
    // pool size isn't reported for coins still on a launch curve, so that's unknown (null), not an empty pool
    x["c"+k]=n&&n.price?[r3(n.price/x.p-1),x.lq&&n.liq&&!n.curve?r3(n.liq/x.lq):null]:[-1,0];checked++}}}
 // 3. keep about a week
 // 3b. archive the finished ones before they age out, and work out what predicted a dead coin
 let arch=[];try{arch=JSON.parse(fs.readFileSync(AFILE,"utf8")).rows||[]}catch(e){}
 const id=x=>x.m+"|"+x.t,inA=new Set(arch.map(id)),done=x=>CHECKS.every(k=>x["c"+k]!==undefined);
 for(const x of h.rows)if(done(x)&&!inA.has(id(x))){arch.push(x);inA.add(id(x))}
 arch=arch.filter(x=>now-x.t<ARCH_DAYS*864e5).sort((a,b)=>a.t-b.t);
 fs.writeFileSync(AFILE,'{"v":1,"rows":[\n'+arch.map(x=>JSON.stringify(x)).join(",\n")+"\n]}\n");   // one coin per line, so each hour's change is small
 fs.writeFileSync(IFILE,JSON.stringify(insights([...arch,...h.rows.filter(x=>!inA.has(id(x)))],now)));
 h.rows=h.rows.filter(x=>now-x.t<KEEP_DAYS*864e5);
 h.updated=now;h.runs=(h.runs||0)+1;h.last={coins:scan.coins.length,added,checked,fails:scan.fails};
 fs.writeFileSync(FILE,JSON.stringify(h));
 console.log(`Fresh list: ${scan.coins.length} coins, ${added} new recorded, ${hotSig} Hot buy signals, ${checked} re-checks, sources down: ${scan.fails.join(", ")||"none"}. ${h.rows.length} coins on record.`);
})().catch(e=>{console.error(e);process.exit(1)});

/* what the record says so far: how each warning flag, verdict and kind of coin did, and whether the coach's buy signals beat the rest */
function insights(rows,now){
 const dead=(x,k)=>x[k][0]<=-.9||(x[k][1]!=null&&x[k][1]<.2);
 const n24=rows.filter(x=>x.c24).length,n6=rows.filter(x=>x.c6).length,K=n24>=150?"c24":n6>=150?"c6":"c1";
 const sum=(X,k=K)=>{X=X.filter(x=>x[k]);const n=X.length;if(!n)return{n:0};const xs=X.map(x=>x[k][0]).sort((a,b)=>a-b);
  return{n,dead:r2(X.filter(x=>dead(x,k)).length/n),up:r2(X.filter(x=>x[k][0]>0).length/n),dbl:r2(X.filter(x=>x[k][0]>=1).length/n),med:r3(xs[Math.floor((n-1)/2)])}};
 const R=rows.filter(x=>x[K]&&!x.h);   // the Fresh list only
 const has=(x,f)=>(x.f||[]).includes(f);
 const flags=[...new Set(R.flatMap(x=>x.f||[]))].map(f=>({f,with:sum(R.filter(x=>has(x,f))),without:sum(R.filter(x=>!has(x,f)))})).filter(x=>x.with.n>=5)
  .sort((a,b)=>(b.with.dead-b.without.dead)-(a.with.dead-a.without.dead));
 const verdicts={};for(const v of ["passed","caution","sketchy"])verdicts[v]=sum(R.filter(x=>x.v===v));
 const bucket=(get,edges,labels)=>labels.map((l,i)=>Object.assign({l},sum(R.filter(x=>{const v=get(x);return v!=null&&v>=edges[i]&&v<edges[i+1]}))));
 const buckets={
  pool:bucket(x=>x.lq,[0,1e4,3e4,1e5,Infinity],["Under $10K","$10K to $30K","$30K to $100K","$100K or more"]),
  mcap:bucket(x=>x.mc,[0,5e4,2e5,1e6,Infinity],["Under $50K","$50K to $200K","$200K to $1M","$1M or more"]),
  age:bucket(x=>x.a,[0,1,6,24,Infinity],["Under 1 hour","1 to 6 hours","6 to 24 hours","Over a day"]),
  top10:bucket(x=>x.top,[0,20,35,50,101],["Under 20%","20% to 35%","35% to 50%","Over 50%"]),
  score:bucket(x=>x.sc,[0,30,50,70,100],["Under 30","30 to 49","50 to 69","70 or more"])};
 const coach={};for(const k of ["c1","c6","c24"]){const X=rows.filter(x=>x[k]&&x.bs!=null);coach[k]={sig:sum(X.filter(x=>x.bs>0),k),rest:sum(X.filter(x=>x.bs===0&&!x.h),k)}}
 return{updated:now,k:K,base:sum(R),verdicts,flags,buckets,coach}}
