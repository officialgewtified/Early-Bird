/* Early Bird's autopilot, with practice money only. Runs on GitHub every few minutes, around the clock:
   checks the coins it holds and sells on the coach's calls (2x, 5x, get out, a day passed), and every other run
   scans Hot and Fresh and buys $25 of each new buy signal. Fees and price impact are taken off every trade so the
   result is honest. Nothing here touches real money or a wallet. Writes autopilot.json.
   usage: node autopilot.js */
"use strict";
const fs=require("fs"),path=require("path"),EB=require("./eb-core.js");
const FILE=path.join(__dirname,"autopilot.json"),START=1000,STAKE=25,MAX=8,SCAN_EVERY=9*60e3;
const GT="https://api.geckoterminal.com/api/v2",JUP="https://lite-api.jup.ag/tokens/v2";
const r2=x=>Math.round(x*100)/100;
(async()=>{
 let A=null;try{A=JSON.parse(fs.readFileSync(FILE,"utf8"))}catch(e){}
 if(!A||!A.v)A={v:1,started:Date.now(),start:START,cash:START,pos:{},hist:[],log:[],eq:[],runs:0,bought:[],lastScan:0};
 const get=EB.makeGet(globalThis.fetch),now=Date.now(),note=(a,o)=>A.log.unshift(Object.assign({t:now,a},o));
 function sell(m,f,why,c,gone){const p=A.pos[m];if(!p)return;const px=gone?0:c.price;if(px==null)return;
  const qty=p.qty*f,out=qty*px*(1-EB.fillCost(qty*px,c.liq,c.curve)),cin=p.cost*f;
  A.cash+=out;A.hist.unshift({m,s:p.s,n:p.n,in:r2(cin),out:r2(out),t0:p.t,t1:now,why});
  note(f>=.999?"sell":"half",{m,s:p.s,usd:r2(out),pl:r2(out-cin),why});
  if(f>=.999)delete A.pos[m];else{p.qty-=qty;p.cost-=cin;p.half=true}}

 // 1. what it holds: live price, stats and trades, then the coach's call
 const ms=Object.keys(A.pos);let Q={},failed=0;const J={};
 if(ms.length){try{const r=await EB.quotes(get,ms,0);Q=r.q;failed=r.failed}catch(e){failed=ms.length}
  try{const d=await get(`${JUP}/search?query=${ms.join(",")}`,0);for(const j of d||[])J[j.id]=j}catch(e){}}
 for(const m of ms){const p=A.pos[m],q=Q[m],j=J[m];
  const c={mint:m,price:(q&&q.price)||(j&&+j.usdPrice)||null,liq:q?q.liq:null,curve:q?q.curve:false,ch:q?q.ch:{},organic:j&&j.organicScore!=null?+j.organicScore:null,
   st:j?{m5:j.stats5m||null,h1:j.stats1h||null,h6:j.stats6h||null,h24:j.stats24h||null}:null};
  let trades=null;   // the last few hundred trades, to catch the creator or big wallets dumping
  try{if(p.pool===undefined){const d=await get(`${GT}/networks/solana/tokens/${m}/pools?page=1`,0);
    const P=(d.data||[]).map(x=>({a:(x.attributes||{}).address,r:+((x.attributes||{}).reserve_in_usd)||0})).filter(x=>x.a).sort((a,b)=>b.r-a.r);p.pool=P.length?P[0].a:null}
   if(p.pool){const d=await get(`${GT}/networks/solana/pools/${p.pool}/trades?trade_volume_in_usd_greater_than=2&token=${m}`,0);
    trades=(d.data||[]).map(x=>{const a=x.attributes||{};return{t:Date.parse(a.block_timestamp),kind:a.kind,usd:+a.volume_in_usd||0,w:a.tx_from_address||""}}).filter(x=>x.t&&x.usd)}}catch(e){}
  if(!p.dev&&j&&j.dev)p.dev=j.dev;
  const gone=!q&&!j&&!c.price&&!failed;   // no pool anywhere and the lookups worked: it's been pulled
  const f=EB.flowNet(c,trades,p.dev,now),x=c.price&&p.p0?c.price/p.p0:null;
  const d=EB.exitCall({x,liq:c.liq,lq0:p.lq0,curve:c.curve,net:f.net,creatorSold:f.creatorSold,half:p.half,ageH:(now-p.t)/36e5,fade:f.fade,gone});
  p.last={px:c.price,x:x!=null?Math.round(x*1000)/1000:null,k:d.k,r:d.r,net:f.net,liq:c.liq,at:now};
  if(d.k==="out")sell(m,1,d.r,c,gone);
  else if(d.k==="tp"&&d.r==="5x")sell(m,1,"Sold at 5x",c);
  else if(d.k==="tp"&&!p.half)sell(m,.5,d.r==="2x"?"Took half at 2x":"Took half, sellers taking over",c);
  else if((now-p.t)/36e5>24)sell(m,1,"A day passed",c)}

 // 2. new buys: a full scan of Hot and Fresh every other run
 let scanned=0,sigs=0,bought=0;
 if(now-(A.lastScan||0)>=SCAN_EVERY){A.lastScan=now;const seen=new Set(),L=[];
  for(const mode of ["hot","fresh"]){try{const r=await EB.scan(get,mode,{now});
   for(const c of r.coins){if(seen.has(c.mint))continue;seen.add(c.mint);scanned++;const sg=EB.buySignal(c);if(sg.lvl)L.push({c,sg})}}catch(e){}}
  sigs=L.length;L.sort((a,b)=>b.sg.lvl-a.sg.lvl||b.c.score-a.c.score);
  for(const{c,sg}of L){if(Object.keys(A.pos).length>=MAX||A.cash<STAKE)break;if(A.bought.includes(c.mint)||A.pos[c.mint]||!c.price)continue;
   const qty=STAKE*(1-EB.fillCost(STAKE,c.liq,c.curve))/c.price;
   // p0 is what it really paid per coin after fees, so its calls judge the trade honestly
   A.pos[c.mint]={m:c.mint,s:String(c.sym||"").slice(0,16),n:String(c.name||"").slice(0,40),icon:c.icon||null,qty,cost:STAKE,p0:STAKE/qty,t:now,lq0:c.liq||null,sig:sg.lvl,why:sg.why.slice(0,3),dev:c.dev||undefined,half:false};
   A.cash-=STAKE;A.bought=[c.mint,...A.bought].slice(0,500);bought++;
   note("buy",{m:c.mint,s:A.pos[c.mint].s,usd:STAKE,why:`${sg.lvl===2?"Strong":"Okay"} signal: ${sg.why[0]}`})}}

 // 3. what it's worth now (what it would get selling everything, after fees), and keep the files small
 let val=A.cash;for(const m in A.pos){const p=A.pos[m],px=(p.last&&p.last.px)||p.p0;val+=p.qty*px*(1-EB.fillCost(p.qty*px,p.last&&p.last.liq,false))}
 A.cash=r2(A.cash);A.value=r2(val);A.eq.push([now,A.value]);A.eq=A.eq.slice(-2500);A.log=A.log.slice(0,200);A.hist=A.hist.slice(0,400);
 A.runs++;A.updated=now;A.lastRun={scanned,sigs,bought,held:Object.keys(A.pos).length};
 fs.writeFileSync(FILE,JSON.stringify(A));
 console.log(`Autopilot: worth $${A.value} (cash $${A.cash}), holding ${A.lastRun.held}, ${scanned?`scanned ${scanned} coins, ${sigs} signals, bought ${bought}`:"no scan this run"}, ${A.hist.length} sales so far.`);
})().catch(e=>{console.error(e);process.exit(1)});
