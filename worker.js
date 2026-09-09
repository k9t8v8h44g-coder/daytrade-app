export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API 狀態測試
    if (url.pathname === "/api/status") {
      return json({
        ok: true,
        app: "\u53f0\u80a1\u7576\u6c96\u52a9\u624b V3.1",
        message: "Worker API \u6b63\u5e38\u904b\u4f5c",
        time: new Date().toISOString()
      });
    }

    // 台股即時行情
    if (url.pathname === "/api/quote") {
      const symbol = (url.searchParams.get("symbol") || "2330").trim();
      const market = (url.searchParams.get("market") || "tse").trim();

      if (!/^\d{4,6}$/.test(symbol)) {
        return json({ ok: false, error: "Invalid symbol" }, 400);
      }

      if (!["tse", "otc"].includes(market)) {
        return json({ ok: false, error: "Invalid market" }, 400);
      }

      const exCh = `${market}_${symbol}.tw`;

      const api =
        "https://mis.twse.com.tw/stock/api/getStockInfo.jsp" +
        "?ex_ch=" + encodeURIComponent(exCh) +
        "&json=1&delay=0&_=" + Date.now();

      try {
        const res = await fetch(api, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept": "application/json"
          }
        });

        if (!res.ok) {
          throw new Error(`TWSE HTTP ${res.status}`);
        }

        const data = await res.json();
        const q = data.msgArray?.[0];

        if (!q) {
          return json({
            ok: false,
            symbol,
            error: "No quote data"
          }, 404);
        }

        const last = toNumber(q.z);
        const prev = toNumber(q.y);

        const change = last !== null && prev !== null
          ? last - prev
          : null;

        const changePct =
          change !== null && prev
            ? (change / prev) * 100
            : null;

        return json({
          ok: true,
          symbol: q.c || symbol,
          name: q.n || "",
          market: q.ex || market,
          price: last,
          previousClose: prev,
          change: change,
          changePct: changePct,
          open: toNumber(q.o),
          high: toNumber(q.h),
          low: toNumber(q.l),
          volume: toNumber(q.v),
          tradeDate: q.d || "",
          tradeTime: q.t || "",
          source: "TWSE MIS"
        });

      } catch (err) {
        return json({
          ok: false,
          symbol,
          error: String(err.message || err)
        }, 502);
      }
    }

    // 原本網站
    return env.ASSETS.fetch(request);
  }
};

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
  return Number.isFinite(n) ? n : null;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=UTF-8",
      "cache-control": "no-store"
    }
  });
}
