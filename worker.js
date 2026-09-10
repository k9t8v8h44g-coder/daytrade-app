const TWSE_URL="https://mis.twse.com.tw/stock/api/getStockInfo.jsp";
const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type",
  "Cache-Control":"no-store"
};
function json(x,status=200){return new Response(JSON.stringify(x),{status,headers:{...CORS,"Content-Type":"application/json; charset=utf-8"}})}
function n(v){if(v==null||v===""||v==="-")return null;const x=Number(String(v).replace(/,/g,""));return Number.isFinite(x)?x:null}
function px(v){return v?n(String(v).split("_")[0]):null}
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
async function oneExchange(symbol,ex){
  const ex_ch=ex+"_"+symbol+".tw";
  const u=TWSE_URL+"?ex_ch="+encodeURIComponent(ex_ch)+"&json=1&delay=0&_="+Date.now();
  const ctl=new AbortController(), timer=setTimeout(()=>ctl.abort(),4500);
  try{
    const r=await fetch(u,{signal:ctl.signal,headers:{
      "Accept":"application/json,text/plain,*/*",
      "Referer":"https://mis.twse.com.tw/stock/fibest.jsp"
    }});
    if(!r.ok)throw new Error("TWSE HTTP "+r.status);
    const j=await r.json();
    const row=(j.msgArray||[]).find(x=>x.c===symbol);
    if(!row)return null;
    const q=normalize(row);
    return q.price!=null?q:null;
  }finally{clearTimeout(timer)}
}
async function oneSymbol(symbol){
  // Try listed first, then OTC. Each upstream request contains exactly ONE stock.
  try{
    const q=await oneExchange(symbol,"tse");
    if(q)return q;
  }catch(e){}
  try{
    const q=await oneExchange(symbol,"otc");
    if(q)return q;
  }catch(e){}
  return null;
}
async function getQuotes(symbols){
  // Worker pool: at most 4 single-stock requests in flight.
  const out=new Array(symbols.length).fill(null);
  let cursor=0;
  async function runner(){
    while(true){
      const i=cursor++;
      if(i>=symbols.length)return;
      out[i]=await oneSymbol(symbols[i]);
    }
  }
  await Promise.all(Array.from({length:Math.min(4,symbols.length)},runner));
  return out.filter(Boolean);
}
export default{
  async fetch(request,env){
    if(request.method==="OPTIONS")return new Response(null,{status:204,headers:CORS});
    const u=new URL(request.url);
    if(u.pathname==="/api/status")return json({
      ok:true,service:"daytrade-realtime",source:"TWSE MIS",
      mode:"single-symbol-pool",concurrency:4,timeoutMs:4500
    });
    if(u.pathname==="/api/quote"||u.pathname==="/api/quotes"){
      const raw=u.pathname==="/api/quote"
        ?[(u.searchParams.get("symbol")||"").trim()]
        :(u.searchParams.get("symbols")||"").split(",").map(s=>s.trim());
      const symbols=[...new Set(raw)].filter(s=>/^\d{4,6}$/.test(s));
      if(!symbols.length)return json({ok:false,error:"No valid symbols"},400);
      if(symbols.length>20)return json({ok:false,error:"Maximum 20 symbols"},400);
      const started=Date.now();
      try{
        const quotes=await getQuotes(symbols);
        return json({
          ok:quotes.length>0,
          count:quotes.length,
          requested:symbols.length,
          partial:quotes.length<symbols.length,
          elapsedMs:Date.now()-started,
          mode:"single-symbol-pool",
          source:"TWSE MIS",
          quotes
        },quotes.length?200:502);
      }catch(e){
        return json({ok:false,error:String(e?.message||e),count:0,requested:symbols.length,quotes:[]},502);
      }
    }
    if(env&&env.ASSETS)return env.ASSETS.fetch(request);
    return new Response("Not found",{status:404,headers:CORS});
  }
};