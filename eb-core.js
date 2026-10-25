/* Early Bird core: finds new Solana coins from free public sources, runs the scam checks and scores them.
   The site (on your phone) and the hourly tracker (GitHub Actions) both use this file, so they judge coins the same way.
   Every source here is free and needs no key: DEX Screener, Jupiter, RugCheck, GeckoTerminal and GoPlus. */
(function(root,factory){if(typeof module==="object"&&module.exports)module.exports=factory();else root.EB=factory()})(typeof self!=="undefined"?self:this,function(){
"use strict";
const DX="https://api.dexscreener.com",JUP="https://lite-api.jup.ag/tokens/v2",RC="https://api.rugcheck.xyz/v1",
 GT="https://api.geckoterminal.com/api/v2",GP="https://api.gopluslabs.io/api/v1/solana/token_security";
const TOKEN22="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const SKIP=new Set(["So11111111111111111111111111111111111111112","EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v","Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"]);  // SOL, USDC, USDT
const CURVES=new Set(["pumpfun","launchlab","meteoradbc","moonshot","boop","believe"]);   // launch curves: no pool to pull yet
const B58=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const num=x=>{if(x==null||x==="")return null;const n=typeof x==="number"?x:parseFloat(x);return isFinite(n)?n:null};
const chunk=(a,n)=>{const o=[];for(let i=0;i<a.length;i+=n)o.push(a.slice(i,i+n));return o};

/* ---------- fetching: a small cache, and staying under each source's speed limit ---------- */
function makeGet(fetchImpl){
 const cache=new Map(),inflight=new Map();
 const rate={"lite-api.jup.ag":{n:4,win:10500,ts:[]},"api.geckoterminal.com":{n:8,win:61000,ts:[]},"api.gopluslabs.io":{n:20,win:61000,ts:[]}};
 const conc={"api.rugcheck.xyz":{max:3,on:0,q:[]}};
 async function gate(h){const L=rate[h];if(!L)return;
  for(;;){const now=Date.now();L.ts=L.ts.filter(t=>now-t<L.win);if(L.ts.length<L.n){L.ts.push(now);return}await sleep(L.win-(now-L.ts[0])+60)}}
 async function slot(h){const C=conc[h];if(!C)return()=>{};if(C.on>=C.max)await new Promise(r=>C.q.push(r));C.on++;
  return()=>{C.on--;const n=C.q.shift();if(n)n()}}
 async function once(url){const h=new URL(url).host,done=await slot(h);
  try{for(let tries=0;;tries++){await gate(h);const r=await fetchImpl(url);
    if(r.status===429&&tries<2){await sleep(2500*(tries+1));continue}
    if(!r.ok)throw new Error(h+" "+r.status);return await r.json()}}
  finally{done()}}
 return function get(url,maxAge=30000){const c=cache.get(url);if(c&&Date.now()-c.t<maxAge)return Promise.resolve(c.d);
  if(inflight.has(url))return inflight.get(url);
  const p=once(url).then(d=>{cache.set(url,{t:Date.now(),d});if(cache.size>500)cache.delete(cache.keys().next().value);return d}).finally(()=>inflight.delete(url));
  inflight.set(url,p);return p}}

/* ---------- turning each source's answer into one coin ---------- */
function fromJup(j,c){if(!j||!j.id)return c;const a=j.audit||{};
 Object.assign(c,{mint:j.id,sym:j.symbol||c.sym,name:j.name||c.name,icon:j.icon||c.icon,
  created:Date.parse((j.firstPool&&j.firstPool.createdAt)||j.createdAt)||c.created||null,
  mcap:num(j.mcap)??num(j.fdv)??c.mcap??null,liq:num(j.liquidity)??c.liq??null,price:num(j.usdPrice)??c.price??null,holders:num(j.holderCount)??c.holders??null,
  st:{m5:j.stats5m||null,h1:j.stats1h||null,h6:j.stats6h||null,h24:j.stats24h||null},
  top10:num(a.topHoldersPercentage),devPct:num(a.devBalancePercentage),devMints:num(a.devMints),devMig:num(a.devMigrations),
  mintOff:a.mintAuthorityDisabled,freezeOff:a.freezeAuthorityDisabled,
  organic:num(j.organicScore),organicLabel:j.organicScoreLabel||null,verified:!!j.isVerified,tags:j.tags||[],
  x:j.twitter||c.x,tg:j.telegram||c.tg,web:j.website||c.web,dev:j.dev||null,t22:j.tokenProgram===TOKEN22,jup:true});
 return c}
function fromDx(p,c){if(!p)return c;const i=p.info||{},soc=i.socials||[],web=(i.websites||[])[0];
 c.mint=c.mint||p.baseToken.address;c.sym=c.sym||p.baseToken.symbol;c.name=c.name||p.baseToken.name;c.icon=c.icon||i.imageUrl;
 c.pair=p.pairAddress;c.pairUrl=p.url;c.dex=p.dexId;c.curve=CURVES.has(p.dexId);
 c.tx=p.txns||null;c.vol=p.volume||null;c.ch=p.priceChange||null;
 if(c.mcap==null)c.mcap=num(p.marketCap)??num(p.fdv);if(c.liq==null)c.liq=num(p.liquidity&&p.liquidity.usd);if(c.price==null)c.price=num(p.priceUsd);
 if(!c.created&&p.pairCreatedAt)c.created=p.pairCreatedAt;
 const tw=soc.find(s=>s.type==="twitter"),tg=soc.find(s=>s.type==="telegram");
 c.x=c.x||(tw&&tw.url)||null;c.tg=c.tg||(tg&&tg.url)||null;c.web=c.web||(web&&web.url)||null;return c}
function fromGt(pool,inc){const a=pool.attributes||{},bt=((pool.relationships||{}).base_token||{}).data;if(!bt||!bt.id)return null;
 const t=inc.get(bt.id)||{},mint=bt.id.replace(/^solana_/,"");
 return{mint,sym:t.symbol,name:t.name,icon:t.image_url||undefined,created:Date.parse(a.pool_created_at)||null,mcap:num(a.market_cap_usd)??num(a.fdv_usd),
  liq:num(a.reserve_in_usd),price:num(a.base_token_price_usd),pair:a.address}}
const bestPair=(pairs,mint)=>(pairs||[]).filter(p=>p.baseToken&&p.baseToken.address===mint)
 .sort((a,b)=>(num(b.liquidity&&b.liquidity.usd)||0)-(num(a.liquidity&&a.liquidity.usd)||0))[0]||null;

/* numbers the checks and score read, from whichever source has them */
const txB=(c,w)=>c.st&&c.st[w]&&c.st[w].numBuys!=null?c.st[w].numBuys:c.tx&&c.tx[w]?c.tx[w].buys:null;
const txS=(c,w)=>c.st&&c.st[w]&&c.st[w].numSells!=null?c.st[w].numSells:c.tx&&c.tx[w]?c.tx[w].sells:null;
const chg=(c,w)=>c.ch&&c.ch[w]!=null?num(c.ch[w]):c.st&&c.st[w]&&c.st[w].priceChange!=null?num(c.st[w].priceChange):null;
const vol=(c,w)=>c.vol&&c.vol[w]!=null?num(c.vol[w]):c.st&&c.st[w]&&c.st[w].buyVolume!=null?(num(c.st[w].buyVolume)||0)+(num(c.st[w].sellVolume)||0):null;
const money=n=>{if(n==null||!isFinite(n))return"–";const a=Math.abs(n),s=n<0?"-":"";
 const t=(v,d)=>v.toFixed(d).replace(/\.0+$|(\.\d*?)0+$/,"$1");
 return s+"$"+(a>=1e9?t(a/1e9,2)+"B":a>=1e6?t(a/1e6,a>=1e7?1:2)+"M":a>=1e3?t(a/1e3,a>=1e4?0:1)+"K":a>=1?a.toFixed(0):a.toFixed(2))};
const ageTxt=h=>h==null?"–":h<1/60?"just now":h<1?Math.round(h*60)+"m":h<48?(h<10?h.toFixed(1).replace(/\.0$/,""):Math.round(h))+"h":Math.round(h/24)+"d";

/* ---------- the scam checks ---------- */
// RugCheck's findings, matched to the checks below so the same problem isn't listed twice
const RC_MAP=[[/top 10|high ownership|single holder/i,"holders","A few wallets hold most of it"],[/low liquidity/i,"liqsize","Tiny pool"],
 [/creator history|rugged/i,"creator","Creator has rugged before"],[/freeze authority/i,"freeze","Creator can freeze wallets"],
 [/mint authority/i,"mint","Creator can still make more coins"],[/lp unlocked|liquidity unlocked|amount of lp/i,"lp","Pool money isn't locked"],
 [/mutable metadata/i,"meta","Name and picture can be changed"],[/holder correlation|bundle|insider/i,"insiders","Wallets look linked"],
 [/copycat/i,"copycat","Copycat name"],[/transfer fee|transfer hook|permanent delegate|non.?transferable|default account state/i,"trap",null]];
const LV={ok:0,na:0,info:1,warn:2,bad:3};
function checks(c){const F={};const set=(k,level,t,d)=>{const o=F[k];if(!o||LV[level]>LV[o.level])F[k]={k,level,t,d:d||""}};
 const gp=c.gp||{};
 if(c.mintOff===false||gp.mint)set("mint","bad","Creator can still make more coins","The mint is still on, so they could print new coins and dump them on buyers.");
 else if(c.mintOff===true||gp.mint===false)set("mint","ok","Creator can't make more coins","The mint is switched off, so the supply can't be watered down.");
 else set("mint","na","Couldn't check the mint");
 if(c.freezeOff===false||gp.freeze)set("freeze","bad","Creator can freeze wallets","They could lock your coins so you can't sell.");
 else if(c.freezeOff===true||gp.freeze===false)set("freeze","ok","Creator can't freeze your coins","Nobody can lock the coins in your wallet.");
 else set("freeze","na","Couldn't check freezing");
 if(c.curve)set("lp","ok","Still on the launch curve","It hasn't moved to a trading pool yet, so there's no pool for the creator to pull.");
 else if(c.rc&&c.rc.lp!=null){const p=c.rc.lp;
  if(p>=90)set("lp","ok","Pool money is locked",`${Math.round(p)}% of the pool is locked or burned, so it can't be pulled.`);
  else if(p>=50)set("lp","warn","Pool money partly unlocked",`Only ${Math.round(p)}% of the pool is locked. The rest could be pulled.`);
  else if(c.ageH>720&&c.liq>2e5)set("lp","warn","Pool money isn't all locked",`${Math.round(p)}% is locked. That's common for older coins where lots of people add to the pool, but the unlocked part can still be pulled.`);
  else set("lp","bad","Pool money isn't locked",`Only ${Math.round(p)}% is locked, so the creator could pull the money out of the pool (a rug pull).`)}
 else set("lp","na","Couldn't check the pool lock");
 if(c.top10!=null){const t=c.top10;
  if(t<=30)set("holders","ok","Coins are spread out",`The top 10 wallets hold ${t.toFixed(0)}%.`);
  else if(t<=50)set("holders","warn","A few wallets hold a lot",`The top 10 wallets hold ${t.toFixed(0)}%. If they sell, the price drops hard.`);
  else set("holders","bad","A few wallets hold most of it",`The top 10 wallets hold ${t.toFixed(0)}%. They can crash the price whenever they sell.`)}
 // RugCheck flags a live mint or freeze switch; when it ran and flagged neither, they're off
 if(c.rc&&!c.rc.risks.some(r=>/mint authority/i.test(r.name||""))&&F.mint.level==="na")F.mint={k:"mint",level:"ok",t:"Creator can't make more coins",d:"RugCheck found the mint switched off."};
 if(c.rc&&!c.rc.risks.some(r=>/freeze authority/i.test(r.name||""))&&F.freeze.level==="na")F.freeze={k:"freeze",level:"ok",t:"Creator can't freeze your coins",d:"RugCheck found freezing switched off."};
 if(c.devPct!=null){const d=c.devPct;
  if(d<=5)set("dev","ok","Creator holds a small bag",`The creator holds ${d<.1?"almost none":d.toFixed(1)+"%"}.`);
  else if(d<=15)set("dev","warn","Creator holds a big bag",`The creator still holds ${d.toFixed(1)}%.`);
  else set("dev","bad","Creator holds a huge bag",`The creator still holds ${d.toFixed(0)}%, enough to dump on everyone.`)}
 if(c.devMints!=null){if(c.devMints>=20&&(c.devMig||0)/c.devMints<.03)set("creator","warn","Creator launches lots of coins",`This wallet has launched ${c.devMints.toLocaleString()} coins and ${c.devMig||0} took off. Serial launchers often walk away.`);
  else if(c.devMints<=3)set("creator","ok","Not a serial launcher",`This wallet has launched ${c.devMints} coin${c.devMints===1?"":"s"}.`)}
 if(c.organicLabel){const L=c.organicLabel;
  if(L==="low")set("bots","warn","Mostly bot trading","Most of the buying and selling looks automated, not real people.");
  else set("bots","ok",L==="high"?"Lots of real traders":"Some real traders",`Jupiter rates the real-trader activity ${L}.`)}
 const b1=txB(c,"h1"),s1=txS(c,"h1");
 if(b1!=null&&b1>=15&&s1===0)set("sell","bad","Nobody has sold in the last hour",`${b1} buys and no sells. That's what a coin you can't sell looks like.`);
 else if(s1>0)set("sell","ok","People are selling fine",`${s1.toLocaleString()} sell${s1===1?"":"s"} in the last hour.`);
 if(gp.hook)set("trap","bad","Has a transfer hook","Extra code runs on every transfer, which can block selling.");
 if(gp.delegate)set("trap","bad","Creator can take coins from wallets","A permanent delegate can move or burn coins in any wallet.");
 if(gp.nontransfer)set("trap","bad","Coins can't be sent","The coin is locked to whoever holds it.");
 if(gp.fee>0)set("trap",gp.fee>.05?"bad":"warn","Charges a fee on every transfer",`${(gp.fee*100).toFixed(1)}% of each transfer goes to the creator.`);
 if(gp.close)set("trap","warn","Creator can close token accounts","");
 if(!c.curve&&c.liq!=null){const l=c.liq;
  if(l>=15e3)set("liqsize","ok","Enough money in the pool",`${money(l)} in the pool.`);
  else if(l>=5e3)set("liqsize","warn","Thin pool",`Only ${money(l)} in the pool, so a big sell moves the price a lot.`);
  else set("liqsize","bad","Tiny pool",`Only ${money(l)} in the pool. One sell can tank it.`)}
 if(c.x||c.tg||c.web)set("socials","ok","Has socials",[c.x&&"X",c.tg&&"Telegram",c.web&&"website"].filter(Boolean).join(", ")+".");
 else set("socials","warn","No socials","No X, Telegram or website listed, so it's hard to tell who's behind it.");
 if(c.holders!=null&&c.ageH!=null&&c.ageH>1&&c.holders<50)set("few","warn","Very few holders",`Only ${c.holders} wallets hold it after ${ageTxt(c.ageH)}.`);
 const c1=chg(c,"h1"),c24=chg(c,"h24");
 if((c1!=null&&c1>300)||(c24!=null&&c24>2000))set("ran","warn","Already pumped hard",`Up ${Math.round(Math.max(c1||0,c24||0)).toLocaleString()}% recently. Late buyers often end up holding the bag.`);
 if(c.rc)for(const r of c.rc.risks){const m=RC_MAP.find(([re])=>re.test(r.name||"")),k=m?m[1]:"rc:"+r.name;
  const lv=r.level==="danger"?"bad":r.level==="warn"?(k==="meta"?"info":"warn"):"info";
  set(k,lv,(m&&m[2])||r.name,(r.d||"")+(r.value?` (${r.value})`:""))}
 const order={bad:0,warn:1,info:2,ok:3,na:4};
 return Object.values(F).sort((a,b)=>order[a.level]-order[b.level])}
function verdictOf(F,c){if(F.some(f=>f.level==="bad"))return"sketchy";
 const known=F.filter(f=>f.level!=="na").length;if(c&&!c.rc&&known<4)return"unchecked";
 return F.some(f=>f.level==="warn")?"caution":"passed"}
const VERDICT={passed:"Passed",caution:"Caution",sketchy:"Sketchy",unchecked:"Not checked"};

/* ---------- the Early score: how early, how much real buying, how real it looks (not how likely it goes up) ---------- */
function score(c,pre){const cl=(x,a,b)=>x==null||!isFinite(x)?null:Math.max(0,Math.min(1,(x-a)/(b-a))),or=(x,d)=>x==null?d:x;
 const a=c.ageH!=null?c.ageH:c.created?(Date.now()-c.created)/36e5:null;
 const early=.55*or(a==null?null:Math.exp(-a/8),.3)+.45*or(c.mcap?1-cl(Math.log10(c.mcap),4.2,6.7):null,.4);
 const b=txB(c,"h1"),s=txS(c,"h1"),bp=b!=null&&s!=null&&b+s>=5?cl(b/(b+s),.45,.68):.3;
 const hg=or(cl(c.st&&c.st.h1?num(c.st.h1.holderChange):null,0,25),.3);
 const v=vol(c,"h1"),vl=v!=null&&c.liq?cl(v/c.liq,.05,1.5):.25;
 const mom=bp*.4+hg*.35+vl*.25,real=or(cl(c.organic,10,85),.3);
 const soc=Math.min(1,(c.x?.45:0)+(c.tg?.2:0)+(c.web?.2:0)+(c.profile||c.cto?.15:0));
 let sc=100*(.25*early+.35*mom+.25*real+.15*soc);
 if(!pre&&c.checks)for(const f of c.checks){if(f.level==="warn")sc*=.9;if(f.level==="bad")sc*=.6}
 return Math.max(0,Math.min(99,Math.round(sc)))}

/* ---------- the coach's buy signal ----------
   A Passed coin where real buying is clearly winning right now, without chasing one that has already gone vertical.
   Fixed rules, the same on the phone and in the hourly record, so the record shows whether they actually work.
   Returns {lvl:2 strong, 1 okay, 0 none, why:[reasons it qualifies], no:"why not"} */
function buySignal(c){const no=t=>({lvl:0,why:[],no:t});if(!c)return no("No data");
 // Passed coins can get a strong signal; a Caution coin whose only worry is a mild one (no socials, few holders yet, pool not all locked) can get an okay one
 const W=(c.checks||[]).filter(f=>f.level==="warn"),soft=c.verdict==="caution"&&W.length===1&&["socials","few","lp"].includes(W[0].k);
 if(c.verdict!=="passed"&&!soft)return no(c.verdict==="sketchy"?"It failed the scam checks":c.verdict==="caution"?`Scam-check warning: ${(W[0]&&W[0].t||"see Safety").toLowerCase()}${W.length>1?` and ${W.length-1} more`:""}`:"It hasn't been fully checked");
 const s1=c.st&&c.st.h1,s5=c.st&&c.st.m5;if(!s1)return no("Not enough trading data yet");
 const h1=chg(c,"h1"),bv=num(s1.buyVolume)||0,sv=num(s1.sellVolume)||0,tv=bv+sv,r=tv?bv/tv:0;
 if(tv<5000)return no("Too little trading this hour to get in and out cleanly");
 if(!c.curve&&(c.liq||0)<1e4)return no("The pool is too small to get in and out cleanly");
 if(h1!=null&&h1>150)return no(`Already up ${Math.round(h1)}% this hour, too late to chase`);
 if(h1!=null&&h1<-25)return no(`Falling hard (${Math.round(h1)}% this hour)`);
 if(c.top10!=null&&c.top10>35)return no(`The top 10 wallets hold ${Math.round(c.top10)}%, enough to dump on everyone`);
 if(c.devPct!=null&&c.devPct>10)return no(`The creator still holds ${Math.round(c.devPct)}%`);
 if(c.organic!=null&&c.organic<15)return no("The trading is mostly bots");
 if(r<.5)return no("More money is selling than buying this hour");
 const why=[],nb=num(s1.numNetBuyers),tr=num(s1.numTraders)||0,hc=num(s1.holderChange);
 if(r>=.55)why.push(`${Math.round(r*100)}% of the money this hour was buying`);
 if(nb!=null&&nb>=Math.max(10,tr*.05))why.push(`${nb.toLocaleString()} more wallets bought than sold this hour`);
 if(hc!=null&&hc>=3)why.push(`Holders up ${hc.toFixed(0)}% this hour`);
 if(s5){const b5=num(s5.buyVolume)||0,x5=num(s5.sellVolume)||0;if(b5+x5>=500&&b5>x5*1.2)why.push("Still being bought in the last 5 minutes")}
 if(c.organic!=null&&c.organic>=40)why.push("Mostly real traders, not bots");
 if(c.score>=60)why.push(`Early score ${c.score}`);
 const n=why.length,lvl=n>=5?2:n>=4?1:0;
 if(!lvl)return{lvl:0,why,no:"Buying isn't strong enough yet"};
 return soft?{lvl:1,why,warn:W[0].t}:{lvl,why}}

/* ---------- the sources ---------- */
const FEEDS={
 fresh:[["dxProfiles",`${DX}/token-profiles/latest/v1`],["dxBoosts",`${DX}/token-boosts/latest/v1`],["dxCto",`${DX}/community-takeovers/latest/v1`],
  ["gtNew",`${GT}/networks/solana/new_pools?include=base_token`],["jupTrend",`${JUP}/toptrending/5m?limit=40`]],
 hot:[["jupTrend",`${JUP}/toptrending/1h?limit=50`],["jupOrganic",`${JUP}/toporganicscore/1h?limit=50`],["dxBoostsTop",`${DX}/token-boosts/top/v1`]]};
const DEFAULTS={fresh:{maxAgeH:24,minMcap:8e3,maxMcap:2e6,minLiq:5e3,rcLimit:30},hot:{maxAgeH:24*7,minMcap:5e4,maxMcap:5e7,minLiq:2e4,rcLimit:30}};

async function rug(get,c){const d=await get(`${RC}/tokens/${c.mint}/report/summary`,600000);
 c.rc={score:num(d.score),norm:num(d.score_normalised),lp:num(d.lpLockedPct),
  risks:(d.risks||[]).map(r=>({name:r.name,value:r.value,d:r.description,level:r.level}))};return c}
async function goplus(get,c){const d=await get(`${GP}?contract_addresses=${c.mint}`,600000),R=d&&d.result,r=R&&(R[c.mint]||Object.values(R)[0]);if(!r)return c;
 const on=x=>!!x&&String(x.status)==="1",off=x=>!!x&&String(x.status)==="0";
 c.gp={mint:on(r.mintable)?true:off(r.mintable)?false:undefined,freeze:on(r.freezable)?true:off(r.freezable)?false:undefined,close:on(r.closable),
  delegate:on(r.balance_mutable_authority),hook:Array.isArray(r.transfer_hook)&&r.transfer_hook.length>0,
  fee:r.transfer_fee&&num(r.transfer_fee.current_fee_rate||r.transfer_fee.fee_rate)||0,nontransfer:String(r.non_transferable)==="1"};return c}
function finish(c,now){c.ageH=c.created?Math.max(0,(now-c.created)/36e5):null;c.checks=checks(c);c.verdict=verdictOf(c.checks,c);c.score=score(c);return c}
const VR={passed:0,caution:1,unchecked:2,sketchy:3};

/* a list of coins: "fresh" (just launched) or "hot" (trending now), checked and scored */
async function scan(get,mode,opt){mode=mode==="hot"?"hot":"fresh";const o=Object.assign({},DEFAULTS[mode],opt||{}),now=o.now||Date.now(),M=new Map(),src={},fails=[];
 const at=m=>{if(!m||SKIP.has(m)||!B58.test(m))return null;let c=M.get(m);if(!c){c={mint:m,src:[]};M.set(m,c)}return c};
 const fa=o.maxAge!=null?o.maxAge:mode==="fresh"?45000:90000;   // a pulled refresh asks for brand-new answers
 await Promise.all(FEEDS[mode].map(async([k,url])=>{try{const d=await get(url,fa);let n=0;
   if(k.startsWith("jup")){for(const j of d||[]){const c=at(j.id);if(c){fromJup(j,c);c.src.push(k);n++}}}
   else if(k==="gtNew"){const inc=new Map((d.included||[]).map(t=>[t.id,t.attributes||{}]));
    for(const p of d.data||[]){const g=fromGt(p,inc),c=g&&at(g.mint);if(!c)continue;for(const kk in g)if(c[kk]==null&&g[kk]!=null)c[kk]=g[kk];c.src.push(k);n++}}
   else for(const x of d||[]){if(x.chainId!=="solana")continue;const c=at(x.tokenAddress);if(!c)continue;c.src.push(k);n++;
    if(k==="dxProfiles")c.profile=true;if(k==="dxCto")c.cto=true;if(k.startsWith("dxBoosts"))c.boost=Math.max(c.boost||0,num(x.totalAmount)||num(x.amount)||0);
    if(!c.icon&&x.icon)c.icon=x.icon;const L=x.links||[],tw=L.find(l=>l.type==="twitter"||/\/\/(x|twitter)\.com/.test(l.url||"")),tg=L.find(l=>l.type==="telegram"),w=L.find(l=>!l.type&&l.url);
    if(tw&&!c.x)c.x=tw.url;if(tg&&!c.tg)c.tg=tg.url;if(w&&!c.web)c.web=w.url}
   src[k]=n}catch(e){fails.push(k)}}));
 // Jupiter's details (holders, who owns what, real vs bot trading) for coins the other feeds found
 const need=[...M.values()].filter(c=>!c.jup).map(c=>c.mint).slice(0,100);
 for(const part of chunk(need,50)){try{const d=await get(`${JUP}/search?query=${part.join(",")}`,Math.max(fa,20000));for(const j of d||[]){const c=M.get(j.id);if(c)fromJup(j,c)}}catch(e){fails.push("jupSearch")}}
 const age=c=>c.created?(now-c.created)/36e5:null;
 const fits=(c,f)=>{const a=age(c);if(a!=null&&a>o.maxAgeH*f)return false;if(c.mcap!=null&&(c.mcap>o.maxMcap*f||c.mcap<o.minMcap/f))return false;
  if(c.liq!=null&&c.liq<o.minLiq/f&&!c.curve)return false;return true};
 let C=[...M.values()].filter(c=>fits(c,2));
 // trading pools and socials from DEX Screener
 for(const part of chunk(C.map(c=>c.mint),30)){try{const d=await get(`${DX}/tokens/v1/solana/${part.join(",")}`,Math.min(30000,fa));
   for(const m of part){const p=bestPair(d,m);if(p)fromDx(p,M.get(m))}}catch(e){fails.push("dxTokens")}}
 C=C.filter(c=>c.mcap!=null&&(c.sym||c.name)&&fits(c,1));
 for(const c of C){c.ageH=age(c);c.pre=score(c,true)}
 C.sort((a,b)=>b.pre-a.pre);
 await Promise.all(C.slice(0,o.rcLimit).map(c=>rug(get,c).catch(()=>{})));
 for(const c of C)finish(c,now);
 C.sort((a,b)=>VR[a.verdict]-VR[b.verdict]||b.score-a.score);
 return{coins:C,at:now,mode,src,fails:[...new Set(fails)]}}

/* a coin already on a list, checked in full when you open it: adds GoPlus's checks for coins that can trap your money */
async function enrich(get,c,now){await Promise.all([c.rc?null:rug(get,c).catch(()=>{}),goplus(get,c).catch(()=>{})]);return finish(c,now||Date.now())}

/* pull a coin address out of whatever was pasted: an address, or a DEX Screener / pump.fun / Jupiter / RugCheck / Solscan link */
function parseInput(s){const m=String(s||"").match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);return m?m.sort((a,b)=>b.length-a.length)[0]:null}

/* one coin, checked in full (adds GoPlus's checks for coins that can trap your money) */
async function checkOne(get,input,now){now=now||Date.now();let mint=parseInput(input);if(!mint)return null;
 const c={mint,src:["check"]};let j=null,pairs=[];
 const jup=async m=>{try{const d=await get(`${JUP}/search?query=${m}`,30000);return(d||[]).find(t=>t.id===m)||null}catch(e){return null}};
 [j,pairs]=await Promise.all([jup(mint),get(`${DX}/tokens/v1/solana/${mint}`,20000).catch(()=>[])]);
 if(!j&&!bestPair(pairs,mint)){   // maybe a pool address, from a DEX Screener link
  try{const d=await get(`${DX}/latest/dex/pairs/solana/${mint}`,20000),p=(d&&(d.pairs||(d.pair?[d.pair]:[])))||[];
   if(p[0]&&p[0].baseToken){mint=c.mint=p[0].baseToken.address;pairs=p;j=await jup(mint)}}catch(e){}}
 if(j)fromJup(j,c);const bp=bestPair(pairs,mint);if(bp)fromDx(bp,c);
 if(!c.jup&&!bp)return null;
 await Promise.all([rug(get,c).catch(()=>{}),goplus(get,c).catch(()=>{})]);
 return finish(c,now)}

/* current price, pool and market cap for a list of coins (watchlist, buys, and the tracker's re-checks) */
async function quotes(get,mints,maxAge){const out={},age=maxAge==null?20000:maxAge,miss=[];let failed=0;
 const put=(m,p)=>{out[m]={price:num(p.priceUsd),mcap:num(p.marketCap)??num(p.fdv),liq:num(p.liquidity&&p.liquidity.usd)||null,ch:p.priceChange||{},pairUrl:p.url,sym:p.baseToken.symbol,curve:CURVES.has(p.dexId)}};
 for(const part of chunk([...new Set(mints)],30)){try{const d=await get(`${DX}/tokens/v1/solana/${part.join(",")}`,age);
   for(const m of part){const p=bestPair(d,m);if(p)put(m,p);else miss.push(m)}}catch(e){miss.push(...part)}}
 // a batch can come back short, so look up the missing ones one at a time before calling a coin gone
 for(const m of miss.slice(0,40)){try{const d=await get(`${DX}/tokens/v1/solana/${m}`,age),p=bestPair(d,m);if(p)put(m,p)}catch(e){failed++}}
 failed+=Math.max(0,miss.length-40);
 return{q:out,failed}}

return{makeGet,scan,checkOne,enrich,quotes,checks,verdictOf,score,buySignal,parseInput,money,ageTxt,txB,txS,chg,vol,VERDICT,DEFAULTS,FEEDS,B58}});
