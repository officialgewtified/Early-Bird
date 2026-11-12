/* Early Bird's autopilot, with practice money only. Runs on GitHub every few minutes, around the clock.
   Four fake-money players, each with its own $1,000 (up to 25 coins at once), so the coach gets as much practice as
   possible and something honest to be measured against:
     coach   buys the coach's buy signals                                  $10 a coin
     passed  buys every coin that passes the scam checks, signal or not    $10 a coin
     random  buys random coins off the lists, for comparison: what luck alone does    $10 a coin
     holder  buys and holds: coins that already lasted 6 hours to 3 weeks and are still growing (the Survivors list),
             at most one an hour and six a day, $40 a coin, held up to 30 days
   The first three sell on the same quick calls (half at 2x, the rest at 5x, out on a Get out call or after a day).
   The holder sells only if a coin halves, its pool is pulled or the creator dumps, or, once a coin has hit 3x, if it
   falls 40% from its best. Fees and price impact come off every trade, and a sale can never pay more than the pool
   holds. Nothing here touches real money or a wallet. Writes autopilot.json.
   usage: node autopilot.js */
"use strict";
const fs=require("fs"),path=require("path"),EB=require("./eb-core.js");
const FILE=path.join(__dirname,"autopilot.json"),START=1000,STAKE=10,MAX=25,TRADES_PER_RUN=8,RANDOM_PER_RUN=2;
const HOLD_STAKE=40,HOLD_PER_DAY=6,SURV_EVERY=55*60e3;   // the holder: bigger stakes, few buys, a Survivors scan about once an hour
const STRATS=[["coach","Coach's buy signals"],["passed","Every coin that passes the checks"],["random","Random coins (for comparison)"],["holder","Holds coins that survived, up to 30 days"]];
const GT="https://api.geckoterminal.com/api/v2",JUP="https://lite-api.jup.ag/tokens/v2";
const r2=x=>Math.round(x*100)/100;
const fresh=(name,start)=>({name,start:start||START,cash:start||START,pos:{},hist:[],log:[],eq:[],bought:[],value:start||START});
(async()=>{
 let A=null;try{A=JSON.parse(fs.readFileSync(FILE,"utf8"))}catch(e){}
 if(!A||!A.v)A={v:2,started:Date.now(),runs:0,strats:{},pools:{},tradeAt:{}};
 if(A.v===1){const o=A;A={v:2,started:o.started,runs:o.runs||0,strats:{coach:Object.assign(fresh(STRATS[0][1],o.start),{cash:o.cash,pos:o.pos||{},hist:o.hist||[],log:o.log||[],eq:o.eq||[],bought:o.bought||[],value:o.value})},pools:{},tradeAt:{}}}
 for(const[k,n]of STRATS)if(!A.strats[k])A.strats[k]=fresh(n);
 A.pools=A.pools||{};A.tradeAt=A.tradeAt||{};
 // one-time repair: before sales were capped by the pool's size, drained pools' bad prices "sold" $15 of coins for $9M.
 // A sale that paid over 1,000x is that glitch, not a trade: count it as getting the stake back, so the totals are honest.
 if(!A.fix1){for(const S of Object.values(A.strats))for(const h of S.hist)if(h.in>0&&h.out>h.in*1000&&!h.voided){const g=h.out-h.in;
   S.cash=r2(S.cash-g);S.eq=S.eq.map(([t,v])=>[t,t>=h.t1?r2(v-g):v]);
   for(const l of S.log)if(l.m===h.m&&l.a!=="buy"&&l.t===h.t1){l.usd=r2(h.in);l.pl=0;l.why=(l.why||"")+" (voided: bad price data)"}
   h.out=h.in;h.voided=true;h.why+=" (voided: bad price data)";console.log(`Voided a glitched sale of ${h.s}: it claimed $${r2(h.in+g)}`)}
  A.fix1=Date.now()}
 const get=EB.makeGet(globalThis.fetch),now=Date.now();
 const note=(S,a,o)=>S.log.unshift(Object.assign({t:now,a},o));
 function sell(S,m,f,why,c,gone){const p=S.pos[m];if(!p)return;const px=gone?0:c.price;if(px==null)return;
  const qty=p.qty*f,out=EB.sellOut(qty*px,c.liq,c.curve),cin=p.cost*f;
  S.cash+=out;S.hist.unshift({m,s:p.s,n:p.n,in:r2(cin),out:r2(out),t0:p.t,t1:now,why});
  note(S,f>=.999?"sell":"half",{m,s:p.s,usd:r2(out),pl:r2(out-cin),why});
  if(f>=.999)delete S.pos[m];else{p.qty-=qty;p.cost-=cin;p.half=true}}

 // 1. everything any of them holds: live price and stats for all, recent trades for a few each run (oldest first)
 const held=[...new Set(Object.values(A.strats).flatMap(S=>Object.keys(S.pos)))];let Q={},failed=0;const J={},TR={};
 if(held.length){try{const r=await EB.quotes(get,held,0);Q=r.q;failed=r.failed}catch(e){failed=held.length}
  for(let i=0;i<held.length;i+=50){try{const d=await get(`${JUP}/search?query=${held.slice(i,i+50).join(",")}`,0);for(const j of d||[])J[j.id]=j}catch(e){}}
  for(const m of held.slice().sort((a,b)=>(A.tradeAt[a]||0)-(A.tradeAt[b]||0)).slice(0,TRADES_PER_RUN)){
   try{if(A.pools[m]===undefined){const d=await get(`${GT}/networks/solana/tokens/${m}/pools?page=1`,0);
     const P=(d.data||[]).map(x=>({a:(x.attributes||{}).address,r:+((x.attributes||{}).reserve_in_usd)||0})).filter(x=>x.a).sort((a,b)=>b.r-a.r);A.pools[m]=P.length?P[0].a:null}
    if(A.pools[m]){const d=await get(`${GT}/networks/solana/pools/${A.pools[m]}/trades?trade_volume_in_usd_greater_than=2&token=${m}`,0);
     TR[m]=(d.data||[]).map(x=>{const a=x.attributes||{};return{t:Date.parse(a.block_timestamp),kind:a.kind,usd:+a.volume_in_usd||0,w:a.tx_from_address||""}}).filter(x=>x.t&&x.usd)}
    A.tradeAt[m]=now}catch(e){}}}
 const C={};for(const m of held){const q=Q[m],j=J[m];
  C[m]={mint:m,price:(q&&q.price)||(j&&+j.usdPrice)||null,liq:q?q.liq:null,curve:q?q.curve:false,ch:q?q.ch:{},organic:j&&j.organicScore!=null?+j.organicScore:null,
   st:j?{m5:j.stats5m||null,h1:j.stats1h||null,h6:j.stats6h||null,h24:j.stats24h||null}:null,dev:j&&j.dev,gone:!q&&!j&&!failed}}
 for(const[k,S]of Object.entries(A.strats))for(const m of Object.keys(S.pos)){const p=S.pos[m],c=C[m];if(!c)continue;
  if(!p.dev&&c.dev)p.dev=c.dev;
  const f=EB.flowNet(c,TR[m]||null,p.dev,now),x=c.price&&p.p0?c.price/p.p0:null;
  if(k==="holder"){
   // its best multiple so far, not counting a reading taken while the pool was being drained (those prices are junk)
   if(x!=null&&!c.gone&&(c.curve||!p.lq0||c.liq==null||c.liq>=p.lq0*.5))p.peak=Math.max(p.peak||1,x);
   const d=EB.exitHold({x,peak:p.peak||1,liq:c.liq,lq0:p.lq0,curve:c.curve,creatorSold:f.creatorSold,ageH:(now-p.t)/36e5,gone:c.gone&&!c.price});
   p.last={px:c.price,x:x!=null?Math.round(x*1000)/1000:null,k:d.k,r:d.r,net:f.net,liq:c.liq,curve:!!c.curve,at:now};
   if(d.k==="out")sell(S,m,1,d.r,c,c.gone&&!c.price);
   continue}
  const d=EB.exitCall({x,liq:c.liq,lq0:p.lq0,curve:c.curve,net:f.net,creatorSold:f.creatorSold,half:p.half,ageH:(now-p.t)/36e5,fade:f.fade,gone:c.gone&&!c.price});
  p.last={px:c.price,x:x!=null?Math.round(x*1000)/1000:null,k:d.k,r:d.r,net:f.net,liq:c.liq,curve:!!c.curve,at:now};
  if(d.k==="out")sell(S,m,1,d.r,c,c.gone&&!c.price);
  else if(d.k==="tp"&&d.r==="5x")sell(S,m,1,"Sold at 5x",c);
  else if(d.k==="tp"&&!p.half)sell(S,m,.5,d.r==="2x"?"Took half at 2x":"Took half, sellers taking over",c);
  else if((now-p.t)/36e5>24)sell(S,m,1,"A day passed",c)}

 // 2. new buys: scan Hot and Fresh every run
 const coins=[],seen=new Set();
 for(const mode of ["hot","fresh"]){try{const r=await EB.scan(get,mode,{now});for(const c of r.coins){if(seen.has(c.mint)||!c.price)continue;seen.add(c.mint);coins.push(c)}}catch(e){}}
 const buy=(k,c,why,sig,stake)=>{const S=A.strats[k],st=stake||STAKE;if(Object.keys(S.pos).length>=MAX||S.cash<st||S.bought.includes(c.mint)||S.pos[c.mint])return false;
  const qty=st*(1-EB.fillCost(st,c.liq,c.curve))/c.price;
  // p0 is what it really paid per coin after fees, so its calls judge the trade honestly
  S.pos[c.mint]={m:c.mint,s:String(c.sym||"").slice(0,16),n:String(c.name||"").slice(0,40),icon:c.icon||null,qty,cost:st,p0:st/qty,t:now,lq0:c.liq||null,sig:sig||0,v:c.verdict,dev:c.dev||undefined,half:false};
  S.cash-=st;S.bought=[c.mint,...S.bought].slice(0,1500);note(S,"buy",{m:c.mint,s:S.pos[c.mint].s,usd:st,why});return true};
 const sigs=coins.map(c=>({c,sg:EB.buySignal(c)})).filter(x=>x.sg.lvl).sort((a,b)=>b.sg.lvl-a.sg.lvl||b.c.score-a.c.score);
 let nb={coach:0,passed:0,random:0,holder:0};
 for(const{c,sg}of sigs)if(buy("coach",c,`${sg.lvl===2?"Strong":"Okay"} signal: ${sg.why[0]}`,sg.lvl))nb.coach++;
 for(const c of coins.filter(c=>c.verdict==="passed").sort((a,b)=>b.score-a.score))if(buy("passed",c,`Passed the checks, Early score ${c.score}`))nb.passed++;
 const pool=coins.filter(c=>!A.strats.random.bought.includes(c.mint));for(let i=0;i<RANDOM_PER_RUN&&pool.length;i++){const c=pool.splice(Math.floor(Math.random()*pool.length),1)[0];if(buy("random",c,`Picked at random (${c.verdict})`))nb.random++}
 // the holder: about once an hour, look at the Survivors list and buy the strongest one it hasn't owned (six a day at most)
 const H=A.strats.holder,boughtToday=H.log.filter(x=>x.a==="buy"&&now-x.t<864e5).length;let surv=null;
 if(now-(A.survAt||0)>=SURV_EVERY&&boughtToday<HOLD_PER_DAY&&Object.keys(H.pos).length<MAX&&H.cash>=HOLD_STAKE){
  try{const r=await EB.scan(get,"survivors",{now});A.survAt=now;surv={n:r.coins.length,sig:0,fails:r.fails};
   const P=r.coins.filter(c=>c.price&&c.surv&&c.surv.lvl);surv.sig=P.length;
   for(const c of P)if(buy("holder",c,`${c.surv.lvl===2?"Strong":"Okay"} survivor: ${c.surv.why.slice(0,2).join(", ").toLowerCase()}`,c.surv.lvl,HOLD_STAKE)){nb.holder++;break}}catch(e){}}

 // 3. what each is worth now (what it would get selling everything, after fees), and keep the file small
 for(const S of Object.values(A.strats)){let val=S.cash;for(const m in S.pos){const p=S.pos[m],px=(p.last&&p.last.px)||p.p0;val+=EB.sellOut(p.qty*px,p.last&&p.last.liq,p.last&&p.last.curve)}
  S.cash=r2(S.cash);S.value=r2(val);S.eq.push([now,S.value]);S.eq=S.eq.slice(-2000);S.log=S.log.slice(0,150);S.hist=S.hist.slice(0,1500)}
 const keep=new Set(Object.values(A.strats).flatMap(S=>Object.keys(S.pos)));for(const m of Object.keys(A.pools))if(!keep.has(m))delete A.pools[m];for(const m of Object.keys(A.tradeAt))if(!keep.has(m))delete A.tradeAt[m];
 A.runs++;A.updated=now;A.lastRun={scanned:coins.length,sigs:sigs.length,bought:nb,surv};
 fs.writeFileSync(FILE,JSON.stringify(A));
 console.log(`Autopilot run ${A.runs}: scanned ${coins.length} coins, ${sigs.length} signals. `+STRATS.map(([k])=>{const S=A.strats[k];return `${k} $${S.value} (${Object.keys(S.pos).length} held, ${S.hist.length} sales, +${nb[k]})`}).join("; "));
})().catch(e=>{console.error(e);process.exit(1)});
