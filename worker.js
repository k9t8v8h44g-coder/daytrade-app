const TWSE_URL = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

function json(data, status=200){
  return new Response(JSON.stringify(data), {
    status,
    headers: {...CORS, "Content-Type":"application/json; charset=utf-8"}
  });
}
function n(v){
  if(v===undefined || v===null || v==="" || v==="-") return null;
  const x=Number(String(v).replace(/,/g,""));
  return Number.isFinite(x)?x:null;
}
function parsePrice(v){
  if(!v) return null;
  const s=String(v).split("_")[0];
  return n(s);
}
function marketCode(symbol){
  // Try listed first; TWSE MIS ignores invalid ex_ch items and returns the valid ones.
  return "tse_"+symbol+".tw";
}
function normalize(x){
  const price=parsePrice(x.z) ?? parsePrice(x.y) ?? parsePrice(x.o);
  const prev=parsePrice(x.y);
  const open=parsePrice(x.o);
  const high=parsePrice(x.h);
  const low=parsePrice(x.l);
  const volume=n(x.v) ?? n(x.tv) ?? 0;
  const change=(price!=null && prev!=null)?price-prev:null;
  const changePct=(change!=null && prev)?change/prev*100:null;
  return {
    symbol:x.c||"",
    name:x.n||x.nf||"",
    market:(x.ex||"").toLowerCase(),
    price, previousClose:prev, change, changePct, open, high, low, volume,
    tradeDate:x.d||"", tradeTime:x.t||"", source:"TWSE MIS"
  };
}

async function twseFetch(symbols){
  // Each requested symbol is tried as both TWSE and TPEx; MIS returns whichever exists.
  const ex=[];
  for(const s of symbols){
    ex.push("tse_"+s+".tw");
    ex.push("otc_"+s+".tw");
  }
  const url=TWSE_URL+"?ex_ch="+encodeURIComponent(ex.join("|"))+"&json=1&delay=0&_="+Date.now();
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),7000);
  try{
    const r=await fetch(url,{
      signal:ctl.signal,
      headers:{
        "Accept":"application/json,text/plain,*/*",
        "Referer":"https://mis.twse.com.tw/stock/fibest.jsp",
        "User-Agent":"Mozilla/5.0"
      }
    });
    if(!r.ok) throw new Error("TWSE HTTP "+r.status);
    const j=await r.json();
    const rows=Array.isArray(j.msgArray)?j.msgArray:[];
    const seen=new Set();
    return rows.map(normalize).filter(q=>{
      if(!q.symbol || q.price==null || seen.has(q.symbol)) return false;
      seen.add(q.symbol); return true;
    });
  }finally{
    clearTimeout(timer);
  }
}

async function fetchSmallBatch(symbols){
  let lastErr=null;
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const rows=await twseFetch(symbols);
      if(rows.length) return rows;
      throw new Error("沒有有效成交價");
    }catch(e){
      lastErr=e;
      if(attempt<3) await new Promise(r=>setTimeout(r,350*attempt));
    }
  }
  // Rescue: if a small batch still fails, try each symbol individually.
  if(symbols.length>1){
    const out=[];
    for(const s of symbols){
      try{
        const rows=await twseFetch([s]);
        out.push(...rows);
      }catch(e){}
      await new Promise(r=>setTimeout(r,120));
    }
    if(out.length) return out;
  }
  throw lastErr||new Error("TWSE 行情失敗");
}

async function getQuotes(symbols){
  // Critical fix: never forward 20 symbols to TWSE in one request.
  // Split into 5-symbol chunks and process sequentially to avoid TWSE 520/rate limiting.
  const chunks=[];
  for(let i=0;i<symbols.length;i+=5) chunks.push(symbols.slice(i,i+5));
  const out=[];
  for(let i=0;i<chunks.length;i++){
    try{
      out.push(...await fetchSmallBatch(chunks[i]));
    }catch(e){}
    if(i<chunks.length-1) await new Promise(r=>setTimeout(r,180));
  }
  const map=new Map();
  for(const q of out) map.set(q.symbol,q);
  return symbols.map(s=>map.get(s)).filter(Boolean);
}

export default {
  async fetch(request, env){
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:CORS});
    const url=new URL(request.url);

    if(url.pathname==="/api/status"){
      return json({ok:true,service:"daytrade-realtime",source:"TWSE MIS",batchMode:"5x sequential"});
    }

    if(url.pathname==="/api/quote"){
      const symbol=(url.searchParams.get("symbol")||"").trim();
      if(!/^\d{4,6}$/.test(symbol)) return json({ok:false,error:"Invalid symbol"},400);
      try{
        const quotes=await getQuotes([symbol]);
        return json({ok:true,count:quotes.length,source:"TWSE MIS",quotes});
      }catch(e){
        return json({ok:false,error:String(e?.message||e)},502);
      }
    }

    if(url.pathname==="/api/quotes"){
      const raw=(url.searchParams.get("symbols")||"").split(",").map(s=>s.trim()).filter(Boolean);
      const symbols=[...new Set(raw)].filter(s=>/^\d{4,6}$/.test(s));
      if(!symbols.length) return json({ok:false,error:"No valid symbols"},400);
      if(symbols.length>20) return json({ok:false,error:"Maximum 20 symbols"},400);
      try{
        const quotes=await getQuotes(symbols);
        if(!quotes.length) return json({ok:false,error:"No valid quotes"},502);
        return json({ok:true,count:quotes.length,requested:symbols.length,source:"TWSE MIS",quotes});
      }catch(e){
        return json({ok:false,error:String(e?.message||e)},502);
      }
    }

    if(env && env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found",{status:404,headers:CORS});
  }
};
