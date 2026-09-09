export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/status") {
      return new Response(JSON.stringify({
        ok: true,
        app: "\u53f0\u80a1\u7576\u6c96\u52a9\u624b V3.0",
        message: "Worker API \u6b63\u5e38\u904b\u4f5c",
        time: new Date().toISOString()
      }), {
        headers: {
          "content-type": "application/json; charset=UTF-8"
        }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
