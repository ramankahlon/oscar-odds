import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const STORE_PATH = path.join(__dirname, "data", "forecast-store.json");
const DEFAULT_PROFILE_ID = "default";

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && parsed.profiles && typeof parsed.profiles === "object") return parsed;

    const migratedPayload = parsed?.payload || null;
    return {
      updatedAt: parsed?.updatedAt || null,
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: {
          updatedAt: parsed?.updatedAt || null,
          payload: migratedPayload
        }
      }
    };
  } catch {
    return {
      updatedAt: null,
      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: { updatedAt: null, payload: null }
      }
    };
  }
}

async function writeStore(document) {
  await fs.writeFile(STORE_PATH, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  return document;
}

app.get("/api/health", (_, res) => {
  res.json({ ok: true, now: new Date().toISOString() });
});

app.get("/api/profiles", async (_, res) => {
  const doc = await readStore();
  const profiles = Object.entries(doc.profiles || {}).map(([id, entry]) => ({
    id,
    updatedAt: entry?.updatedAt || null
  }));
  res.json({ activeProfileId: doc.activeProfileId || DEFAULT_PROFILE_ID, profiles });
});

app.get("/api/forecast/:profileId", async (req, res) => {
  const doc = await readStore();
  const profileId = req.params.profileId || DEFAULT_PROFILE_ID;
  const profile = doc.profiles?.[profileId] || { updatedAt: null, payload: null };
  res.json({ profileId, ...profile });
});

app.put("/api/forecast/:profileId", async (req, res) => {
  const payload = req.body;
  if (!payload || typeof payload !== "object") {
    res.status(400).json({ error: "Invalid forecast payload." });
    return;
  }

  const profileId = req.params.profileId || DEFAULT_PROFILE_ID;
  const doc = await readStore();
  const updatedAt = new Date().toISOString();
  doc.updatedAt = updatedAt;
  doc.activeProfileId = profileId;
  doc.profiles = doc.profiles || {};
  doc.profiles[profileId] = { updatedAt, payload };

  const saved = await writeStore(doc);
  res.json({ profileId, ...saved.profiles[profileId] });
});

app.get("*", (_, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
