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


function twDateCompact(d){
  return `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,"0")}${String(d.getUTCDate()).padStart(2,"0")}`;
}
async function fetchStooqHistory(symbol){
  const code=`${symbol}.tw`;
  const u=`https://stooq.com/q/d/l/?s=${encodeURIComponent(code)}&i=d`;
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),5500);
  try{
    const r=await fetch(u,{signal:ctl.signal,headers:{"Accept":"text/csv,text/plain,*/*","User-Agent":"Mozilla/5.0"}});
    if(!r.ok)throw new Error("Stooq HTTP "+r.status);
    const text=await r.text();
    const lines=text.trim().split(/\r?\n/);
    if(lines.length<6)throw new Error("Stooq history insufficient");
    const rows=[];
    for(const line of lines.slice(1)){
      const a=line.split(",");
      if(a.length<6)continue;
      const [date,open,high,low,close,volume]=a;
      const nums=[open,high,low,close].map(Number);
      if(nums.every(Number.isFinite))rows.push({date,open:+open,high:+high,low:+low,close:+close,volume:Number(volume)||null});
    }
    return rows.slice(-20);
  }finally{clearTimeout(timer)}
}

async function getHistory(symbol,market="tse"){
  const now=new Date(),months=[];
  for(let k=0;k<2;k++){
    const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-k,1));
    months.push(twDateCompact(d));
  }
  const rows=[],errors=[];

  if(market==="otc"){
    for(const date of months){
      const rocYear=Number(date.slice(0,4))-1911;
      const rocDate=`${rocYear}/${date.slice(4,6)}/01`;
      const u=`https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock?code=${encodeURIComponent(symbol)}&date=${encodeURIComponent(rocDate)}&response=json`;
      const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),3000);
      try{
        const r=await fetch(u,{signal:ctl.signal,redirect:"follow",headers:{"Accept":"application/json","User-Agent":"Mozilla/5.0"}});
        if(r.ok){
          const j=await r.json();
          const data=Array.isArray(j?.tables?.[0]?.data)?j.tables[0].data:(Array.isArray(j.data)?j.data:[]);
          for(const a of data){
            if(!Array.isArray(a)||a.length<7)continue;
            const clean=v=>Number(String(v??"").replace(/,/g,"").replace(/[＋+]/g,""));
            const open=clean(a[3]),high=clean(a[4]),low=clean(a[5]),close=clean(a[6]),volume=clean(a[1]);
            if([open,high,low,close].every(Number.isFinite))rows.push({date:String(a[0]),open,high,low,close,volume:Number.isFinite(volume)?volume:null});
          }
        }
      }catch(e){errors.push("TPEx "+String(e?.message||e))}
      finally{clearTimeout(timer)}
    }
    if(rows.length>=5)return {rows:rows.slice(-20),source:"TPEx 個股日成交資訊",warning:null};
    try{
      const alt=await fetchStooqHistory(symbol);
      if(alt.length>=5)return {rows:alt,source:"Stooq 歷史日線（備援）",warning:null};
    }catch(e){errors.push(String(e?.message||e))}
    return {rows:[],source:"fallback",warning:"歷史資料暫時無法取得"};
  }

  for(const date of months){
    const u=`https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${date}&stockNo=${encodeURIComponent(symbol)}&response=json`;
    const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),4500);
    try{
      const r=await fetch(u,{signal:ctl.signal,headers:{"Accept":"application/json"}});
      if(!r.ok)continue;
      const j=await r.json();
      for(const a of (Array.isArray(j.data)?j.data:[])){
        if(!Array.isArray(a)||a.length<9)continue;
        const clean=v=>Number(String(v??"").replace(/,/g,""));
        const open=clean(a[3]),high=clean(a[4]),low=clean(a[5]),close=clean(a[6]),volume=clean(a[1]);
        if([open,high,low,close].every(Number.isFinite))rows.push({date:String(a[0]),open,high,low,close,volume:Number.isFinite(volume)?volume:null});
      }
    }finally{clearTimeout(timer)}
  }
  if(rows.length>=5)return {rows:rows.slice(-20),source:"TWSE STOCK_DAY",warning:null};
  try{
    const alt=await fetchStooqHistory(symbol);
    if(alt.length>=5)return {rows:alt,source:"Stooq 歷史日線（備援）",warning:null};
  }catch(e){}
  return {rows:[],source:"fallback",warning:"歷史資料暫時無法取得"};
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


async function getCombinedMisAfterHours(tseSymbols=[],otcSymbols=[]){

  const pairs=[
    ...[...new Set(tseSymbols||[])].slice(0,60).map(symbol=>({symbol,market:"tse"})),
    ...[...new Set(otcSymbols||[])].slice(0,60).map(symbol=>({symbol,market:"otc"}))
  ];

  const quotes=[];
  const errors=[];
  const chunks=[];

  for(let i=0;i<pairs.length;i+=20){
    chunks.push(pairs.slice(i,i+20));
  }

  let cursor=0;

  async function runner(){
    while(true){
      const idx=cursor++;
      if(idx>=chunks.length)return;
      const chunk=chunks[idx];

      const ex_ch=chunk
        .map(x=>`${x.market}_${x.symbol}.tw`)
        .join("|");

      const u=
        TWSE_URL+
        "?ex_ch="+encodeURIComponent(ex_ch)+
        "&json=1&delay=0&_="+Date.now();

      const ctl=new AbortController();
      const timer=setTimeout(()=>ctl.abort(),6500);

      try{
        const r=await fetch(u,{
          signal:ctl.signal,
          headers:{
            "Accept":"application/json,text/plain,*/*",
            "Referer":"https://mis.twse.com.tw/stock/fibest.jsp"
          }
        });

        if(!r.ok)throw new Error("TWSE HTTP "+r.status);

        const j=await r.json();
        const arr=Array.isArray(j.msgArray)?j.msgArray:[];

        const found=new Set();

        for(const row of arr){
          const symbol=String(row.c||"").trim();
          if(!symbol)continue;

          const req=chunk.find(x=>x.symbol===symbol);
          if(!req)continue;

          const q=normalize(row);
          if(q.price==null)continue;

          quotes.push({
            ...q,
            market:req.market,
            source:"TWSE MIS combined batch"
          });
          found.add(req.market+"_"+symbol);
        }

        for(const x of chunk){
          const k=x.market+"_"+x.symbol;
          if(!found.has(k)){
            errors.push(x.market.toUpperCase()+" "+x.symbol+": no quote");
          }
        }

      }catch(e){
        for(const x of chunk){
          errors.push(x.market.toUpperCase()+" "+x.symbol+": "+String(e?.message||e));
        }
      }finally{
        clearTimeout(timer);
      }
    }
  }

  await Promise.all(
    Array.from({length:Math.min(3,chunks.length)},runner)
  );

  return {quotes,errors};
}

async function getAfterHours(otcSymbols=DEFAULT_OTC_AFTER_SYMBOLS,tseSymbols=[]){

  const quotes=[];
  const errors=[];

  // 1) Full TWSE OpenAPI remains the listed-market fallback.
  try{
    const tse=await fetchAfter(TWSE_AFTER,"tse");
    quotes.push(...tse);
  }catch(e){
    errors.push("TWSE: "+String(e?.message||e));
  }

  // 2) Fetch current-day TSE + OTC candidates together from MIS.
  // This avoids serial TSE-first requests starving/rate-limiting OTC.
  try{
    const mis=await getCombinedMisAfterHours(tseSymbols,otcSymbols);

    // Replace stale bulk TSE rows for symbols that MIS returned.
    const freshKeys=new Set(
      mis.quotes.map(q=>q.market+"_"+q.symbol)
    );

    for(let i=quotes.length-1;i>=0;i--){
      const k=quotes[i].market+"_"+quotes[i].symbol;
      if(freshKeys.has(k)){
        quotes.splice(i,1);
      }
    }

    quotes.push(...mis.quotes);
    errors.push(...mis.errors);

  }catch(e){
    errors.push("MIS combined: "+String(e?.message||e));
  }

  return {quotes,errors};
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

        version:"5.3.1"
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
            "TWSE OpenAPI + combined TSE/OTC TWSE MIS batch",

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
            "TWSE MIS combined batch",

          tseMisRequested:
            tseParam.length,

          tseMode:
            "TWSE MIS combined batch + OpenAPI fallback",

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

    if(u.pathname==="/api/history"){
      const symbol=(u.searchParams.get("symbol")||"").trim();
      const market=(u.searchParams.get("market")||"tse").trim().toLowerCase();
      if(!/^\d{4,6}$/.test(symbol))return json({ok:false,error:"Invalid symbol"},400);

      const cache=typeof caches!=="undefined"?caches.default:null;
      const cacheKey=new Request(`${u.origin}/__history_cache/${market}/${symbol}`,{method:"GET"});
      if(cache){
        const hit=await cache.match(cacheKey);
        if(hit){
          const payload=await hit.json();
          return json({...payload,cached:true},200);
        }
      }

      try{
        const out=await getHistory(symbol,market);
        const payload={ok:out.rows.length>0,symbol,market,count:out.rows.length,source:out.source,
          warning:out.warning,rows:out.rows,cached:false};
        if(cache&&out.rows.length>=5){
          const cachedResp=new Response(JSON.stringify(payload),{
            status:200,headers:{"content-type":"application/json;charset=UTF-8","cache-control":"public,max-age=21600"}
          });
          await cache.put(cacheKey,cachedResp);
        }
        return json(payload,200);
      }catch(e){
        return json({ok:false,symbol,market,count:0,error:"歷史資料暫時無法取得，已使用單日支撐壓力",rows:[]},200);
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
        ...new Set(
          raw
            .map(s=>s.replace(/^(?:tse|otc):/i,""))
            .filter(s=>/^\d{4,6}$/.test(s))
        )
      ];

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
