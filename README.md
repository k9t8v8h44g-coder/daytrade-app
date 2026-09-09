# 台股當沖助手 PWA

## 本機開啟
直接用瀏覽器開 index.html 可預覽，但 PWA 安裝與 service worker 需透過 HTTPS 或 localhost。

## iPhone 安裝
1. 將這個資料夾部署到任一 HTTPS 靜態網站服務（例如 GitHub Pages / Cloudflare Pages / Netlify）。
2. 用 Safari 打開網站。
3. 點「分享」→「加入主畫面」。
4. 之後會像 App 一樣從主畫面開啟。

## 下一步可串接
- TWSE / TPEx 公開資訊
- 券商即時行情 API
- 自動選股條件：成交量、量比、漲跌幅、突破、VWAP、5分K、法人/籌碼
- 推播提醒與自訂觀察名單

注意：目前畫面使用示範資料，不可直接視為即時行情或交易指令。
