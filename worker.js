export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/status") {
      return json({
        ok: true,
        app: "台股當沖助手 V3.3",
        message: "Worker API 正常運作",
        time: new Date().toISOString()
      });
    }

    if (url.pathname === "/api/quote") {
      const symbol = (url.searchParams.get("symbol") || "").trim();
      const market = (url.searchParams.get("market") || "tse").trim().toLowerCase();

      if (!/^\d{4,6}$/.test(symbol)) {
        return json({ ok: false, error: "Invalid symbol" }, 400);
      }

      if (!["tse", "otc"].includes(market)) {
        return json({ ok: false, error: "Invalid market" }, 400);
      }

      try {
        const q = await fetchQuotes([`${market}:${symbol}`]);

        if (!q.length) {
          return json({ ok: false, error: "No quote data" }, 502);
        }

        return json({
          ok: true,
          ...q[0]
        });

      } catch (err) {
        return json({
          ok: false,
          error: String(err.message || err)
        }, 502);
      }
    }

    if (url.pathname === "/api/quotes") {
      const raw = (url.searchParams.get("symbols") || "").trim();

      if (!raw) {
        return json({ ok: false, error: "No symbols" }, 400);
      }

      const items = raw
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);

      if (items.length > 20) {
        return json({
          ok: false,
          error: "Maximum 20 symbols"
        }, 400);
      }

      const normalized = items
        .map(item => {
          const parts = item.split(":");

          const market =
            parts.length === 2
              ? parts[0].toLowerCase()
              : "tse";

          const symbol =
            parts.length === 2
              ? parts[1]
              : parts[0];

          if (!["tse", "otc"].includes(market)) {
            return null;
          }

          if (!/^\d{4,6}$/.test(symbol)) {
            return null;
          }

          return `${market}:${symbol}`;
        })
        .filter(Boolean);

      if (!normalized.length) {
        return json({
          ok: false,
          error: "Invalid symbols"
        }, 400);
      }

      try {
        const quotes = await fetchQuotes(normalized);

        return json({
          ok: true,
          count: quotes.length,
          source: "TWSE MIS",
          quotes
        });

      } catch (err) {
        return json({
          ok: false,
          error: String(err.message || err)
        }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  }
};


async function fetchQuotes(items) {
  const channels = items.map(item => {
    const [market, symbol] = item.split(":");
    return `${market}_${symbol}.tw`;
  });

  const api =
    "https://mis.twse.com.tw/stock/api/getStockInfo.jsp" +
    "?ex_ch=" +
    encodeURIComponent(channels.join("|")) +
    "&json=1&delay=0&_=" +
    Date.now();

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();

      const timeout = setTimeout(
        () => controller.abort(),
        7000
      );

      const res = await fetch(api, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept": "application/json",
          "Referer": "https://mis.twse.com.tw/stock/index.jsp"
        },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const err = new Error(`TWSE HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();

      const quotes = (data.msgArray || [])
        .map(q => normalizeQuote(q))
        .filter(Boolean);

      if (!quotes.length) {
        throw new Error("TWSE 無有效行情");
      }

      return quotes;

    } catch (err) {
      lastError = err;

      if (attempt < 3) {
        await sleep(700 * attempt);
      }
    }
  }

  throw lastError || new Error("TWSE 連線失敗");
}


function normalizeQuote(q) {
  const symbol = q.c || "";
  const name = q.n || "";
  const market = q.ex || "";

  const previousClose = toNumber(q.y);
  const open = toNumber(q.o);
  const high = toNumber(q.h);
  const low = toNumber(q.l);
  const volume = toNumber(q.v);

  let price = toNumber(q.z);

  if (price === null) {
    const bid = firstNumber(q.b);
    const ask = firstNumber(q.a);

    if (bid !== null) {
      price = bid;
    } else if (ask !== null) {
      price = ask;
    }
  }

  if (!symbol) {
    return null;
  }

  const change =
    price !== null && previousClose !== null
      ? price - previousClose
      : null;

  const changePct =
    change !== null &&
    previousClose !== null &&
    previousClose !== 0
      ? (change / previousClose) * 100
      : null;

  return {
    symbol,
    name,
    market,
    price,
    previousClose,
    change,
    changePct,
    open,
    high,
    low,
    volume,
    tradeDate: q.d || "",
    tradeTime: q.t || "",
    source: "TWSE MIS"
  };
}


function firstNumber(value) {
  if (!value) return null;

  const first = String(value)
    .split("_")
    .map(v => toNumber(v))
    .find(v => v !== null);

  return first ?? null;
}


function toNumber(value) {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === "-"
  ) {
    return null;
  }

  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}


function sleep(ms) {
  return new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}


function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-store"
      }
    }
  );
}
