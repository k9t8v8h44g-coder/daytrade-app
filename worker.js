const TWSE_URL="https://mis.twse.com.tw/stock/api/getStockInfo.jsp";
const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type",
  "Cache-Control":"no-store"
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function json(x,status=200){return new Response(JSON.stringify(x),{status,headers:{...CORS,"Content-Type":"application/json; charset=utf-8"}})}
function n(v){if(v==null||v===""||v==="-")return null;const x=Number(String(v).replace(/,/g,""));return Number.isFinite(x)?x:null}
function px(v){return v? n(String(v).split("_")[0]) : null}
function normalize(x){
  const price=px(x.z)??px(x.y)??px(x.o), prev=px(x.y);
  return {
    symbol:x.c||"",name:x.n||x.nf||"",market:(x.ex||"").toLowerCase(),
    price,previousClose:prev,
    change:(price!=null&&prev!=null)?price-prev:null,
    changePct:(price!=null&&prev)?(price-prev)/prev*100:null,
    open:px(x.o),high:px(x.h),low:px(x.l),volume:n(x.v)??n(x.tv)??0,
    tradeDate:x.d||"",tradeTime:x.t||"",source:"TWSE MIS"
  };
}
async function fetchChunk(symbols){
  const ex=[];
  for(const s of symbols){ex.push("tse_"+s+".tw","otc_"+s+".tw")}
  const u=TWSE_URL+"?ex_ch="+encodeURIComponent(ex.join("|"))+"&json=1&delay=0&_="+Date.now();
  const ctl=new AbortController(), timer=setTimeout(()=>ctl.abort(),3500);
  try{
    const r=await fetch(u,{signal:ctl.signal,headers:{
      "Accept":"application/json,text/plain,*/*",
      "Referer":"https://mis.twse.com.tw/stock/fibest.jsp"
    }});
    if(!r.ok)throw new Error("TWSE HTTP "+r.status);
    const j=await r.json();
    const seen=new Set();
    return (j.msgArray||[]).map(normalize).filter(q=>{
      if(!q.symbol||q.price==null||seen.has(q.symbol))return false;
      seen.add(q.symbol);return true;
    });
  }finally{clearTimeout(timer)}
}
async function getQuotes(symbols){
  // Fast partial-result strategy:
  // 20 symbols -> 5 chunks x 4 symbols, max 2 concurrent.
  // No long retries. Failed chunks are skipped and recovered by the next app refresh.
  const chunks=[];
  for(let i=0;i<symbols.length;i+=4)chunks.push(symbols.slice(i,i+4));
  const out=[];
  for(let i=0;i<chunks.length;i+=2){
    const pair=chunks.slice(i,i+2);
    const results=await Promise.allSettled(pair.map(c=>fetchChunk(c)));
    for(const r of results)if(r.status==="fulfilled")out.push(...r.value);
    if(i+2<chunks.length)await sleep(100);
  }
  const map=new Map(out.map(q=>[q.symbol,q]));
  return symbols.map(s=>map.get(s)).filter(Boolean);
}
export default{
  async fetch(request,env){
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
    const u=new URL(request.url);
    if(u.pathname==="/api/status")return json({ok:true,service:"daytrade-realtime",source:"TWSE MIS",mode:"fast-partial",chunk:4,concurrency:2,timeoutMs:3500});
    if(u.pathname==="/api/quote"||u.pathname==="/api/quotes"){
      const raw=u.pathname==="/api/quote"
        ?[(u.searchParams.get("symbol")||"").trim()]
        :(u.searchParams.get("symbols")||"").split(",").map(s=>s.trim());
      const symbols=[...new Set(raw)].filter(s=>/^\d{4,6}$/.test(s));
      if(!symbols.length)return json({ok:false,error:"No valid symbols"},400);
      if(symbols.length>20)return json({ok:false,error:"Maximum 20 symbols"},400);
      try{
        const quotes=await getQuotes(symbols);
        // Partial success is still success; frontend can use what arrived immediately.
        return json({
          ok:quotes.length>0,
          count:quotes.length,
          requested:symbols.length,
          partial:quotes.length<symbols.length,
          source:"TWSE MIS",
          quotes
        },quotes.length?200:502);
      }catch(e){
        return json({ok:false,error:String(e?.message||e),quotes:[]},502);
      }
    }
    if(env&&env.ASSETS)return env.ASSETS.fetch(request);
    return new Response("Not found",{status:404,headers:CORS});
  }
};