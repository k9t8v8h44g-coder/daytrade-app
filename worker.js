export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // V3 API 測試
    if (url.pathname === "/api/status") {
      return Response.json({
        ok: true,
        app: "台股當沖助手 V3.0",
        message: "Worker API 正常運作",
        time: new Date().toISOString()
      });
    }

    // 其他網址繼續由原本靜態網站處理
    return env.ASSETS.fetch(request);
  }
};
