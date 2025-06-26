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

// GET /get-random-row
app.get("/get-random-row", async (req, res) => {
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: { property: "タグ", multi_select: { contains: "English" } },
      sorts: [{ property: "learningCount", direction: "ascending" }]
    });
    
    if (!response.results.length) {
      return res.status(404).json({ message: "No data" });
    }

    // 重み付きランダム選択
    const weighted = response.results.map(r => ({
      r, 
      weight: Math.exp(-0.1 * (r.properties.learningCount?.number || 0))
    }));
    
    const total = weighted.reduce((s, w) => s + w.weight, 0);
    let rnd = Math.random() * total;
    const sel = weighted.find(w => (rnd -= w.weight) <= 0)?.r || response.results[0];

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
    
    res.json({ success: true, newCount: cur + 1 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 起動
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});
