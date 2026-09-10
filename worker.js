const TWSE_URL="https://mis.twse.com.tw/stock/api/getStockInfo.jsp";

const TWSE_AFTER="https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL";
const TWSE_MARKET_DATES="https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK";
const TPEX_AFTER="https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes";

const DEFAULT_OTC_AFTER_SYMBOLS=[
  "1815","3105","3260","3293","3324","3363","3374","3483","3529","3548",
  "3552","3580","3680","3707","4123","4162","4979","4991","5009","5347",
  "5371","5425","5483","5498","6104","6125","6147","6182","6207","6223",
  "6231","6274","6290","6488","6510","6547","6643","8069","8086","8299"
];

const TPEX_FALLBACK=
  "https://www.tpex.org.tw/www/zh-tw/afterTrading/otc?date=&id=&response=json";

function rocDateISO(s){
  s=String(s||"").trim().replace(/[^\d]/g,"");
  if(/^1\d{6}$/.test(s)){
    const y=Number(s.slice(0,3))+1911;
    return `${y}-${s.slice(3,5)}-${s.slice(5,7)}`;
  }
  if(/^\d{8}$/.test(s)){
    return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  }
  return null;
}

async function fetchLatestTwseTradeDate(){
  const ctl=new AbortController();
  const timer=setTimeout(()=>ctl.abort(),8000);

  try{
    const r=await fetch(TWSE_MARKET_DATES,{
      signal:ctl.signal,
      headers:{
        "Accept":"application/json"
      }
    });

    if(!r.ok){
      throw new Error("TWSE date HTTP "+r.status);
    }

    const a=await r.json();

    if(!Array.isArray(a)||!a.length){
      return null;
    }

    const dates=a
      .map(x=>rocDateISO(x.Date))
      .filter(Boolean)
      .sort();

    return dates.at(-1)||null;

  }finally{
    clearTimeout(timer);
  }
}

function pick(o,keys){
  for(const k of keys){
    if(o&&o[k]!=null&&o[k]!==""){
      return o[k];
    }
  }
  return null;
}

function nn(v){
  if(v==null||v===""||v==="--"||v==="---"){
    return null;
  }

  const x=Number(
    String(v)
      .replace(/,/g,"")
      .replace(/[＋+]/g,"")
  );

  return Number.isFinite(x)?x:null;
}

function afterRow(r,market){

  const symbol=String(
    pick(r,[
      "Code",
      "SecuritiesCompanyCode",
      "股票代號",
      "代號",
      "證券代號",
      "code"
    ])||""
  ).trim();

  const name=String(
    pick(r,[
      "Name",
      "CompanyName",
      "證券名稱",
      "股票名稱",
      "名稱",
      "name"
    ])||""
  ).trim();

  const tradeDate=String(
    pick(r,[
      "Date",
      "TradeDate",
      "TradingDate",
      "資料日期",
      "日期",
      "date"
    ])||""
  ).trim();

  const price=nn(
    pick(r,[
      "ClosingPrice",
      "Close",
      "收盤價",
      "收盤",
      "close"
    ])
  );

  const open=nn(
    pick(r,[
      "OpeningPrice",
      "Open",
      "開盤價",
      "開盤",
      "open"
    ])
  );

  const high=nn(
    pick(r,[
      "HighestPrice",
      "High",
      "最高價",
      "最高",
      "high"
    ])
  );

  const low=nn(
    pick(r,[
      "LowestPrice",
      "Low",
      "最低價",
      "最低",
      "low"
    ])
  );

  const volume=nn(
    pick(r,[
      "TradeVolume",
      "TradingShares",
      "成交股數",
      "成交量",
      "volume"
    ])
  )||0;

  const ch=nn(
    pick(r,[
      "Change",
      "ChangeAmount",
      "漲跌價差",
      "漲跌",
      "change"
    ])
  );

  let previousClose=
    (price!=null&&ch!=null)
      ?price-ch
      :null;

  const ref=nn(
    pick(r,[
      "PreviousClose",
      "ReferencePrice",
      "昨收",
      "參考價",
      "previousClose"
    ])
  );

  if(ref!=null){
    previousClose=ref;
  }

  return {
    symbol,
    name,
    market,
    tradeDate,
    price,
    previousClose,
    open,
    high,
    low,
    volume,
    change:ch,
    source:
      market==="tse"
        ?"TWSE OpenAPI"
        :"TPEx OpenAPI"
  };
}

function parseTpexTables(j){
  const out=[];

  const tables=
    Array.isArray(j?.tables)
      ?j.tables
      :[];

  for(const table of tables){

    if(!Array.isArray(table?.data)){
      continue;
    }

    const fields=
      Array.isArray(table?.fields)
        ?table.fields
        :[];

    for(const row of table.data){

      if(!Array.isArray(row)){
        continue;
      }

      const obj={};

      fields.forEach((f,i)=>{
        obj[f]=row[i];
      });

      out.push(obj);
    }
  }

  return out;
}

async function fetchAfter(url,market){

  if(market==="tse"){

    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),12000);

    try{

      const r=await fetch(url,{
        signal:ctl.signal,
        headers:{
          "Accept":"application/json",
          "User-Agent":"Mozilla/5.0"
        }
      });

      if(!r.ok){
        throw new Error("TWSE HTTP "+r.status);
      }

      const j=await r.json();

      const arr=
        Array.isArray(j)
          ?j
          :(
            Array.isArray(j?.data)
              ?j.data
              :[]
          );

      return arr
        .map(x=>afterRow(x,market))
        .filter(q=>
          /^\d{4}$/.test(q.symbol) &&
          q.price!=null &&
          q.price>0 &&
          q.previousClose!=null &&
          q.previousClose>0
        );

    }finally{
      clearTimeout(timer);
    }
  }

  const candidates=[
    url,
    url+"?l=zh-tw"
  ];

  const failures=[];

  for(const target of candidates){

    const ctl=new AbortController();
    const timer=setTimeout(()=>ctl.abort(),12000);

    try{

      const r=await fetch(target,{
        signal:ctl.signal
      });

      if(!r.ok){
        throw new Error("HTTP "+r.status);
      }

      const finalUrl=String(r.url||"");

      if(finalUrl.includes("/errors")){
        throw new Error("redirected to TPEx /errors");
      }

      const text=await r.text();

      let j;

      try{
        j=JSON.parse(text);
      }catch(e){
        throw new Error("invalid JSON");
      }

      const arr=
        Array.isArray(j)
          ?j
          :Array.isArray(j?.data)
            ?j.data
            :Array.isArray(j?.tables)
              ?parseTpexTables(j)
              :[];

      const rows=
        arr
          .map(x=>afterRow(x,"otc"))
          .filter(q=>
            /^\d{4}$/.test(q.symbol) &&
            q.price!=null &&
            q.price>0 &&
            q.previousClose!=null &&
            q.previousClose>0
          );

      if(rows.length){
        return rows;
      }

      throw new Error("0 valid rows");

    }catch(e){

      failures.push(
        target+" => "+
        String(e?.message||e)
      );

    }finally{
      clearTimeout(timer);
    }
  }

  throw new Error(
    "all bare TPEx attempts failed: "+
    failures.join(" | ")
  );
}
async function fetchTpexFallback(){

  const ctl=
    new AbortController();

  const timer=
    setTimeout(
      ()=>ctl.abort(),
      8000
    );

  try{

    const r=
      await fetch(
        TPEX_FALLBACK,
        {
          signal:ctl.signal,
          redirect:"follow",
          headers:{
            "Accept":
              "application/json,text/plain,*/*",
            "User-Agent":
              "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
            "Referer":
              "https://www.tpex.org.tw/zh-tw/mainboard/trading/info/mi-pricing.html"
          }
        }
      );

    if(!r.ok){

      throw new Error(
        "TPEx fallback HTTP "+
        r.status
      );
    }

    const text=await r.text();

    let j;

    try{
      j=JSON.parse(text);
    }catch(e){
      throw new Error(
        "TPEx fallback invalid JSON"
      );
    }

    const arr=
      Array.isArray(j)
        ?j
        :Array.isArray(j?.data)
          ?j.data
          :parseTpexTables(j);

    const quotes=
      arr
        .map(x=>afterRow(x,"otc"))
        .filter(q=>
          /^\d{4}$/.test(q.symbol) &&
          q.price!=null &&
          q.price>0 &&
          q.previousClose!=null &&
          q.previousClose>0
        );

    return quotes.map(q=>({
      ...q,
      source:"TPEx official fallback"
    }));

  }finally{

    clearTimeout(timer);
  }
}

async function getAfterHours(otcSymbols=DEFAULT_OTC_AFTER_SYMBOLS,tseSymbols=[]){

  const quotes=[];
  const errors=[];

  /*
    1) TWSE listed stocks:
       keep the already-working official bulk OpenAPI.
  */
  try{

    const tse=
      await fetchAfter(
        TWSE_AFTER,
        "tse"
      );

    quotes.push(...tse);

  }catch(e){

    errors.push(
      "TWSE: "+
      String(
        e?.message||
        e
      )
    );
  }

  /*
    1b) Current-day TSE MIS overlay:
        the bulk TWSE OpenAPI can lag one trading day after close.
        Pull the app's listed candidate symbols from MIS and replace stale
        bulk rows for the same symbols. Date filtering in the app remains final guard.
  */
  if((tseSymbols||[]).length){
    try{
      const tseMis=await getAfterHoursByMis(tseSymbols,"tse",60);
      const freshBySymbol=new Map(tseMis.quotes.map(q=>[q.symbol,q]));
      for(let i=quotes.length-1;i>=0;i--){
        if(quotes[i].market==="tse" && freshBySymbol.has(quotes[i].symbol)){
          quotes.splice(i,1);
        }
      }
      quotes.push(...tseMis.quotes);
      errors.push(...tseMis.errors);
    }catch(e){
      errors.push("TSE MIS: "+String(e?.message||e));
    }
  }

  /*
    2) OTC watch / recommendation symbols:
       do NOT call TPEx from the Worker, because TPEx currently
       redirects Cloudflare Worker traffic to /errors.
       Fetch only the OTC symbols the app actually needs through
       TWSE MIS using otc_<symbol>.tw.
  */
  try{

    const otc=
      await getOtcAfterHoursByMis(
        otcSymbols
      );

    quotes.push(...otc.quotes);

    errors.push(
      ...otc.errors
    );

  }catch(e){

    errors.push(
      "OTC MIS: "+
      String(
        e?.message||
        e
      )
    );
  }

  return {
    quotes,
    errors
  };
}
const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET,OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type",
  "Cache-Control":"no-store"
};

function json(x,status=200){

  return new Response(
    JSON.stringify(x),
    {
      status,
      headers:{
        ...CORS,
        "Content-Type":
          "application/json; charset=utf-8"
      }
    }
  );
}

function n(v){

  if(
    v==null||
    v===""||
    v==="-"
  ){
    return null;
  }

  const x=Number(
    String(v)
      .replace(/,/g,"")
  );

  return Number.isFinite(x)
    ?x
    :null;
}

function px(v){

  return v
    ?n(String(v).split("_")[0])
    :null;
}

function normalize(x){

  const price=
    px(x.z) ??
    px(x.y) ??
    px(x.o);

  const prev=px(x.y);

  return {

    symbol:x.c||"",

    name:
      x.n||
      x.nf||
      "",

    market:
      (x.ex||"")
      .toLowerCase(),

    price,

    previousClose:prev,

    change:
      (
        price!=null &&
        prev!=null
      )
        ?price-prev
        :null,

    changePct:
      (
        price!=null &&
        prev
      )
        ?(price-prev)/prev*100
        :null,

    open:px(x.o),

    high:px(x.h),

    low:px(x.l),

    volume:
      n(x.v) ??
      n(x.tv) ??
      0,

    tradeDate:x.d||"",

    tradeTime:x.t||"",

    source:"TWSE MIS"
  };
}

async function oneExchange(symbol,ex){

  const ex_ch=
    ex+"_"+symbol+".tw";

  const u=
    TWSE_URL+
    "?ex_ch="+
    encodeURIComponent(ex_ch)+
    "&json=1&delay=0&_="+
    Date.now();

  const ctl=
    new AbortController();

  const timer=
    setTimeout(
      ()=>ctl.abort(),
      4500
    );

  try{

    const r=await fetch(u,{
      signal:ctl.signal,
      headers:{
        "Accept":
          "application/json,text/plain,*/*",

        "Referer":
          "https://mis.twse.com.tw/stock/fibest.jsp"
      }
    });

    if(!r.ok){
      throw new Error(
        "TWSE HTTP "+r.status
      );
    }

    const j=await r.json();

    const row=
      (j.msgArray||[])
      .find(x=>x.c===symbol);

    if(!row){
      return null;
    }

    const q=normalize(row);

    return q.price!=null
      ?q
      :null;

  }finally{
    clearTimeout(timer);
  }
}

async function oneSymbol(symbol){

  try{

    const q=
      await oneExchange(
        symbol,
        "tse"
      );

    if(q){
      return q;
    }

  }catch(e){}

  try{

    const q=
      await oneExchange(
        symbol,
        "otc"
      );

    if(q){
      return q;
    }

  }catch(e){}

  return null;
}


async function getAfterHoursByMis(symbols,market,limit=60){

  const out=[];
  const errors=[];
  const unique=[
    ...new Set(
      (symbols||[])
        .map(x=>String(x||"").trim())
        .filter(x=>/^\d{4,6}$/.test(x))
    )
  ].slice(0,limit);

  let cursor=0;

  async function runner(){
    while(true){
      const i=cursor++;
      if(i>=unique.length)return;
      const symbol=unique[i];
      try{
        const q=await oneExchange(symbol,market);
        if(q){
          out.push({
            ...q,
            market,
            source:"TWSE MIS "+market.toUpperCase()
          });
        }else{
          errors.push(market.toUpperCase()+" "+symbol+": no quote");
        }
      }catch(e){
        errors.push(market.toUpperCase()+" "+symbol+": "+String(e?.message||e));
      }
    }
  }

  await Promise.all(
    Array.from({length:Math.min(8,unique.length)},runner)
  );

  return {quotes:out,errors};
}

async function getOtcAfterHoursByMis(symbols){

  const out=[];
  const errors=[];

  const unique=[
    ...new Set(
      (symbols||[])
        .map(x=>String(x||"").trim())
        .filter(x=>/^\d{4,6}$/.test(x))
    )
  ].slice(0,60);

  let cursor=0;

  async function runner(){

    while(true){

      const i=cursor++;

      if(i>=unique.length){
        return;
      }

      const symbol=unique[i];

      try{

        const q=
          await oneExchange(
            symbol,
            "otc"
          );

        if(q){
          out.push({
            ...q,
            market:"otc",
            source:"TWSE MIS OTC"
          });
        }else{
          errors.push(
            "OTC "+symbol+": no quote"
          );
        }

      }catch(e){

        errors.push(
          "OTC "+symbol+": "+
          String(
            e?.message||
            e
          )
        );
      }
    }
  }

  await Promise.all(
    Array.from(
      {
        length:
          Math.min(
            8,
            unique.length
          )
      },
      runner
    )
  );

  return {
    quotes:out,
    errors
  };
}

async function getQuotes(symbols){

  const out=
    new Array(symbols.length)
    .fill(null);

  let cursor=0;

  async function runner(){

    while(true){

      const i=cursor++;

      if(i>=symbols.length){
        return;
      }

      out[i]=
        await oneSymbol(
          symbols[i]
        );
    }
  }

  await Promise.all(
    Array.from(
      {
        length:
          Math.min(
            4,
            symbols.length
          )
      },
      runner
    )
  );

  return out.filter(Boolean);
}

export default{

  async fetch(request,env){

    if(request.method==="OPTIONS"){

      return new Response(
        null,
        {
          status:204,
          headers:CORS
        }
      );
    }

    const u=
      new URL(request.url);

    if(u.pathname==="/api/status"){

      return json({

        ok:true,

        service:
          "daytrade-realtime",

        source:
          "TWSE MIS",

        mode:
          "single-symbol-pool",

        concurrency:4,

        timeoutMs:4500,

        afterhoursTimeoutMs:12000,

        otcAfterMode:"TWSE MIS symbol watchlist",

        version:"4.9.3"
      });
    }

    if(
      u.pathname===
      "/api/afterhours"
    ){

      const started=
        Date.now();

      try{

        const otcParam=
          (u.searchParams.get("otc")||"")
            .split(",")
            .map(x=>x.trim())
            .filter(x=>/^\d{4,6}$/.test(x));

        const tseParam=
          (u.searchParams.get("tse")||"")
            .split(",")
            .map(x=>x.trim())
            .filter(x=>/^\d{4,6}$/.test(x))
            .slice(0,60);

        const otcMerged=[
          ...new Set([
            ...DEFAULT_OTC_AFTER_SYMBOLS,
            ...otcParam
          ])
        ].slice(0,60);

        const out=
          await getAfterHours(
            otcMerged,
            tseParam
          );

        const payloadDates=[
          ...new Set(
            out.quotes
              .map(q=>
                rocDateISO(
                  q.tradeDate
                )
              )
              .filter(Boolean)
          )
        ].sort();

        let marketDate=
          payloadDates.length
            ?payloadDates.at(-1)
            :null;

        if(!marketDate){

          try{

            marketDate=
              await fetchLatestTwseTradeDate();

          }catch(e){

            out.errors.push(
              "TWSE date: "+
              String(
                e?.message||
                e
              )
            );
          }
        }

        return json({

          ok:
            out.quotes.length>0,

          count:
            out.quotes.length,

          partial:
            out.errors.length>0,

          errors:
            out.errors,

          warnings:
            payloadDates.length>1
              ?[
                  "Market dates are not aligned; do not combine TSE and OTC rows for same-day ranking until dates match."
                ]
              :[],

          elapsedMs:
            Date.now()-started,

          source:
            "TWSE OpenAPI + TSE/OTC TWSE MIS overlay",

          marketDate,

          payloadDates,

          marketDates:{
            tse:[
              ...new Set(
                out.quotes
                  .filter(q=>q.market==="tse")
                  .map(q=>rocDateISO(q.tradeDate))
                  .filter(Boolean)
              )
            ].sort().at(-1)||null,

            otc:[
              ...new Set(
                out.quotes
                  .filter(q=>q.market==="otc")
                  .map(q=>rocDateISO(q.tradeDate))
                  .filter(Boolean)
              )
            ].sort().at(-1)||null
          },

          datesAligned:
            payloadDates.length<=1,

          marketCounts:{

            tse:
              out.quotes.filter(
                q=>q.market==="tse"
              ).length,

            otc:
              out.quotes.filter(
                q=>q.market==="otc"
              ).length
          },

          otcRequested:
            otcMerged.length,

          otcMode:
            "TWSE MIS watchlist",

          tseMisRequested:
            tseParam.length,

          tseMode:
            "TWSE MIS current-day overlay + OpenAPI fallback",

          quotes:
            out.quotes

        },
        out.quotes.length
          ?200
          :502
        );

      }catch(e){

        return json({

          ok:false,

          error:
            String(
              e?.message||
              e
            ),

          count:0,

          quotes:[]
        },502);
      }
    }

    if(
      u.pathname==="/api/quote" ||
      u.pathname==="/api/quotes"
    ){

      const raw=
        u.pathname==="/api/quote"

        ?[
          (
            u.searchParams
            .get("symbol")||
            ""
          ).trim()
        ]

        :(
          u.searchParams
          .get("symbols")||
          ""
        )
        .split(",")
        .map(s=>s.trim());

      const symbols=[
        ...new Set(raw)
      ].filter(
        s=>/^\d{4,6}$/.test(s)
      );

      if(!symbols.length){

        return json({
          ok:false,
          error:"No valid symbols"
        },400);
      }

      if(symbols.length>20){

        return json({
          ok:false,
          error:"Maximum 20 symbols"
        },400);
      }

      const started=
        Date.now();

      try{

        const quotes=
          await getQuotes(
            symbols
          );

        return json({

          ok:
            quotes.length>0,

          count:
            quotes.length,

          requested:
            symbols.length,

          partial:
            quotes.length<
            symbols.length,

          elapsedMs:
            Date.now()-started,

          mode:
            "single-symbol-pool",

          source:
            "TWSE MIS",

          quotes

        },
        quotes.length
          ?200
          :502
        );

      }catch(e){

        return json({

          ok:false,

          error:
            String(
              e?.message||
              e
            ),

          count:0,

          requested:
            symbols.length,

          quotes:[]
        },502);
      }
    }

    if(env&&env.ASSETS){

      return env.ASSETS.fetch(
        request
      );
    }

    return new Response(
      "Not found",
      {
        status:404,
        headers:CORS
      }
    );
  }
};
