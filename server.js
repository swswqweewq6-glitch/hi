// server.js
const express = require("express");
const axios = require("axios");

const app = express();
const PORT = process.env.PORT || 3000;

// Simple in-memory cache to avoid rate limits
const cache = new Map();
const TTL = 60; // seconds

async function cached(key, fetcher) {
  const now = Date.now() / 1000;
  const hit = cache.get(key);
  if (hit && now - hit.ts < TTL) return hit.data;
  const data = await fetcher();
  cache.set(key, { data, ts: now });
  return data;
}

async function getJSON(url) {
  const res = await axios.get(url, { timeout: 10000 });
  return res.data;
}

async function collect(userId, typeId) {
  const base = `https://www.roproxy.com/users/inventory/list-json?assetTypeId=${typeId}&cursor=`;
  const all = [];
  let cursor = "";
  while (true) {
    const data = await getJSON(`${base}${encodeURIComponent(cursor)}&itemsPerPage=100&userId=${userId}`);
    if (!data || !data.Data || !Array.isArray(data.Data.Items)) break;
    all.push(...data.Data.Items);
    if (!data.Data.nextPageCursor) break;
    cursor = data.Data.nextPageCursor;
  }
  return all;
}

function filter(items, userId) {
  const out = [];
  for (const it of items) {
    try {
      if (
        it.Creator &&
        it.Creator.Id === userId &&
        it.Product &&
        it.Product.IsForSale &&
        it.Product.PriceInRobux
      ) {
        out.push({
          id: it.Item.AssetId,
          name: it.Item.Name,
          price: it.Product.PriceInRobux,
          type: "Asset",
        });
      }
    } catch {}
  }
  return out;
}

app.get("/api/creator-items", async (req, res) => {
  const userId = Number(req.query.userId);
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const key = `items:${userId}`;
  try {
    const result = await cached(key, async () => {
      const types = [34, 2, 11, 12]; // GamePass, T-Shirt, Shirt, Pants
      const all = [];
      for (const t of types) {
        const inv = await collect(userId, t);
        all.push(...filter(inv, userId));
      }
      return all.sort((a, b) => (a.price || 1e9) - (b.price || 1e9));
    });

    res.json({ items: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch data" });
  }
});

app.get("/", (req, res) => {
  res.send("Roblox Asset Proxy API running. Use /api/creator-items?userId=USERID");
});

app.listen(PORT, () => console.log(`Running on ${PORT}`));
