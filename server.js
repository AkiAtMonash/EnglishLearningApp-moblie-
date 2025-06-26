const express = require("express");
const { Client } = require("@notionhq/client");
const cors = require("cors");
const path = require("path");

const app = express();

// CORS
app.use(cors({ origin: '*', methods: ['GET','POST'], allowedHeaders: ['Content-Type'] }));

// 静的ファイル
app.use(express.static(path.join(__dirname)));

// JSON パーサー
app.use(express.json());

// Notion クライアント
const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

// キャッシュ設定
let cachedPages = [];
let lastCacheTime = 0;
const CACHE_DURATION = 10 * 60 * 1000; // 10分間キャッシュ

// 全てのページを取得する関数（ページネーション対応）
async function getAllPages() {
  let allPages = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: { property: "タグ", multi_select: { contains: "English" } },
      sorts: [{ property: "learningCount", direction: "ascending" }],
      start_cursor: startCursor,
      page_size: 100
    });

    allPages = allPages.concat(response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return allPages;
}

// キャッシュ付きページ取得
async function getCachedPages() {
  const now = Date.now();
  
  // キャッシュが有効な場合はキャッシュを返す
  if (cachedPages.length > 0 && (now - lastCacheTime) < CACHE_DURATION) {
    return cachedPages;
  }
  
  // キャッシュが無効または古い場合は新しく取得
  console.log('Fetching fresh data from Notion...');
  cachedPages = await getAllPages();
  lastCacheTime = now;
  console.log(`Cached ${cachedPages.length} pages`);
  
  return cachedPages;
}

// GET /get-random-row
app.get("/get-random-row", async (req, res) => {
  try {
    // キャッシュ付きで全てのページを取得
    const allPages = await getCachedPages();
    
    if (!allPages.length) {
      return res.status(404).json({ message: "No data" });
    }

    // 重み付きランダム選択
    const weighted = allPages.map(r => ({
      r, 
      weight: Math.exp(-0.1 * (r.properties.learningCount?.number || 0))
    }));
    
    const total = weighted.reduce((s, w) => s + w.weight, 0);
    let rnd = Math.random() * total;
    const sel = weighted.find(w => (rnd -= w.weight) <= 0)?.r || allPages[0];

    const p = sel.properties;
    res.json({
      id: sel.id,
      name: p["名前"]?.title[0]?.plain_text || "No Name",
      url: p["URL"]?.url || "",
      text: p["テキスト"]?.rich_text[0]?.plain_text || "",
      learningCount: p["learningCount"]?.number || 0,
      image: (p["image"]?.files || []).map(f => ({ url: f.file?.url, type: f.type })),
      video: (p["video"]?.files || []).map(f => ({ url: f.file?.url, type: f.type }))
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// POST /update-learning-count
app.post("/update-learning-count", async (req, res) => {
  try {
    const { pageId } = req.body;
    const page = await notion.pages.retrieve({ page_id: pageId });
    const cur = page.properties.learningCount?.number || 0;
    
    await notion.pages.update({
      page_id: pageId,
      properties: { learningCount: { number: cur + 1 } }
    });
    
    // キャッシュ内の該当ページも更新
    const cachedPageIndex = cachedPages.findIndex(p => p.id === pageId);
    if (cachedPageIndex !== -1) {
      cachedPages[cachedPageIndex].properties.learningCount.number = cur + 1;
    }
    
    res.json({ success: true, newCount: cur + 1 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /cache-stats (デバッグ用)
app.get("/cache-stats", (req, res) => {
  res.json({
    totalPages: cachedPages.length,
    lastCacheTime: new Date(lastCacheTime).toISOString(),
    cacheAge: Date.now() - lastCacheTime,
    isValid: (Date.now() - lastCacheTime) < CACHE_DURATION
  });
});

// 起動
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
