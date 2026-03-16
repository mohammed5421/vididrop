/**
 * ═══════════════════════════════════════════════════════
 *  Vididrop — Backend Server v2.0
 *  Moteur : yt-dlp (notre propre système)
 *  Plus de dépendance aux instances Cobalt !
 *
 *  Prérequis :
 *    pip install yt-dlp        (ou brew install yt-dlp)
 *    npm install express bcryptjs jsonwebtoken cors lowdb@1.0.0
 *
 *  Lancer : node server.js
 *  Port   : 3000
 * ═══════════════════════════════════════════════════════
 */

"use strict";

const express    = require("express");
const bcrypt     = require("bcryptjs");
const jwt        = require("jsonwebtoken");
const cors       = require("cors");
const path       = require("path");
const fs         = require("fs");
const os         = require("os");
const { spawn, execFile } = require("child_process");

// ── lowdb (base de données JSON locale) ──────────────
const low      = require("lowdb");
const FileSync = require("lowdb/adapters/FileSync");
const adapter  = new FileSync(path.join(__dirname, "database.json"));
const db       = low(adapter);
db.defaults({ users: [], downloads: [] }).write();

// ── Config ────────────────────────────────────────────
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "vididrop_secret_change_in_production";
const JWT_EXPIRES = "7d";
const TEMP_DIR   = path.join(os.tmpdir(), "vididrop");
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

// ── Chercher yt-dlp automatiquement ───────────────────
function findYtDlp() {
  const user = os.userInfo().username;
  const candidates = [
    // Windows — pip user install (Python 3.x)
    `C:\\Users\\${user}\\AppData\\Roaming\\Python\\Python314\\Scripts\\yt-dlp.exe`,
    `C:\\Users\\${user}\\AppData\\Roaming\\Python\\Python313\\Scripts\\yt-dlp.exe`,
    `C:\\Users\\${user}\\AppData\\Roaming\\Python\\Python312\\Scripts\\yt-dlp.exe`,
    `C:\\Users\\${user}\\AppData\\Roaming\\Python\\Python311\\Scripts\\yt-dlp.exe`,
    `C:\\Users\\${user}\\AppData\\Local\\Programs\\Python\\Python314\\Scripts\\yt-dlp.exe`,
    `C:\\Users\\${user}\\AppData\\Local\\Programs\\Python\\Python313\\Scripts\\yt-dlp.exe`,
    `C:\\Users\\${user}\\AppData\\Local\\Programs\\Python\\Python312\\Scripts\\yt-dlp.exe`,
    // Windows — PATH standard
    "yt-dlp",
    "yt-dlp.exe",
    // Linux / Mac
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
    "/opt/homebrew/bin/yt-dlp",
    path.join(os.homedir(), ".local/bin/yt-dlp"),
    path.join(os.homedir(), "AppData/Roaming/Python/Python314/Scripts/yt-dlp.exe"),
    path.join(process.cwd(), "yt-dlp"),
    path.join(process.cwd(), "yt-dlp.exe"),
  ];
  for (const p of candidates) {
    try {
      require("child_process").execFileSync(p, ["--version"], { timeout: 3000, stdio: "pipe" });
      console.log("✅ yt-dlp trouvé:", p);
      return p;
    } catch {}
  }
  return null;
}

const YTDLP_PATH = findYtDlp();
if (!YTDLP_PATH) {
  console.error("\n❌ yt-dlp introuvable ! Installe-le avec: pip install yt-dlp\n");
}

const app = express();
app.use(cors({ origin: "*", methods: ["GET","POST","DELETE"], allowedHeaders: ["Content-Type","Authorization"] }));
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Middleware JWT ──────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers["authorization"];
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Token manquant." });
  try { req.user = jwt.verify(header.split(" ")[1], JWT_SECRET); next(); }
  catch { res.status(401).json({ error: "Token expiré ou invalide." }); }
}

// ── Auth routes ──────────────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: "Tous les champs sont requis." });
  if (password.length < 6) return res.status(400).json({ error: "Mot de passe trop court (min 6)." });
  if (db.get("users").find({ email }).value()) return res.status(409).json({ error: "Email déjà utilisé." });
  if (db.get("users").find({ username }).value()) return res.status(409).json({ error: "Pseudo déjà pris." });
  const hash = await bcrypt.hash(password, 12);
  const user = { id: Date.now().toString(), username: username.trim(), email: email.toLowerCase().trim(), password: hash, createdAt: new Date().toISOString(), downloads: 0 };
  db.get("users").push(user).write();
  const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.status(201).json({ message: "Compte créé !", token, user: { id: user.id, username: user.username, email: user.email } });
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email et mot de passe requis." });
  const user = db.get("users").find({ email: email.toLowerCase().trim() }).value();
  if (!user || !(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Email ou mot de passe incorrect." });
  const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ message: "Connexion réussie !", token, user: { id: user.id, username: user.username, email: user.email, downloads: user.downloads } });
});

app.get("/api/auth/me", requireAuth, (req, res) => {
  const user = db.get("users").find({ id: req.user.id }).value();
  if (!user) return res.status(404).json({ error: "Utilisateur introuvable." });
  res.json({ id: user.id, username: user.username, email: user.email, downloads: user.downloads, createdAt: user.createdAt });
});

// ── Detect ffmpeg ──────────────────────────────────────
function hasFfmpeg() {
  const candidates = [
    "ffmpeg",
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    `C:\\Users\\${os.userInfo().username}\\scoop\\shims\\ffmpeg.exe`,
    "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg", "/opt/homebrew/bin/ffmpeg",
  ];
  for (const p of candidates) {
    try {
      require("child_process").execFileSync(p, ["-version"], { timeout: 3000, stdio: "pipe" });
      console.log("✅ ffmpeg trouvé:", p);
      return true;
    } catch {}
  }
  console.warn("⚠️  ffmpeg non trouvé — utilisation des formats sans fusion");
  return false;
}

const FFMPEG_AVAILABLE = hasFfmpeg();

// ── Quality/Format map ──────────────────────────────────
// Avec ffmpeg : on peut fusionner vidéo + audio séparés (meilleure qualité)
// Sans ffmpeg : on utilise des formats pré-fusionnés (mp4 natif, un peu moins de choix)
function getFormat(quality, isAudio) {
  if (isAudio) return "bestaudio/best";

  if (FFMPEG_AVAILABLE) {
    // Formats avec fusion — meilleure qualité
    const map = {
      max:    "bestvideo+bestaudio/best",
      "2160": "bestvideo[height<=2160]+bestaudio/best[height<=2160]",
      "1440": "bestvideo[height<=1440]+bestaudio/best[height<=1440]",
      "1080": "bestvideo[height<=1080]+bestaudio/best[height<=1080]",
      "720":  "bestvideo[height<=720]+bestaudio/best[height<=720]",
      "480":  "bestvideo[height<=480]+bestaudio/best[height<=480]",
      "360":  "bestvideo[height<=360]+bestaudio/best[height<=360]",
    };
    return map[quality] || map.max;
  } else {
    // Formats pré-fusionnés (pas besoin de ffmpeg)
    // mp4 natif avec vidéo+audio déjà dans le même fichier
    const map = {
      max:    "bestvideo[ext=mp4][vcodec!=none][acodec!=none]/best[ext=mp4]/best",
      "2160": "best[ext=mp4][height<=2160][vcodec!=none][acodec!=none]/best[height<=2160][ext=mp4]/best[height<=2160]",
      "1440": "best[ext=mp4][height<=1440][vcodec!=none][acodec!=none]/best[height<=1440][ext=mp4]/best[height<=1440]",
      "1080": "best[ext=mp4][height<=1080][vcodec!=none][acodec!=none]/best[height<=1080][ext=mp4]/best[height<=1080]",
      "720":  "best[ext=mp4][height<=720][vcodec!=none][acodec!=none]/best[height<=720][ext=mp4]/best[height<=720]",
      "480":  "best[ext=mp4][height<=480][vcodec!=none][acodec!=none]/best[height<=480][ext=mp4]/best[height<=480]",
      "360":  "best[ext=mp4][height<=360][vcodec!=none][acodec!=none]/best[height<=360][ext=mp4]/best[height<=360]",
    };
    return map[quality] || map.max;
  }
}

// ── Download route (direct file stream) ────────────────
app.post("/api/download", async (req, res) => {
  const { url, quality = "max" } = req.body;
  if (!url) return res.status(400).json({ error: "URL manquante." });
  if (!YTDLP_PATH) return res.status(503).json({ error: "yt-dlp non installé. Fais: pip install yt-dlp" });
  try { new URL(url); } catch { return res.status(400).json({ error: "URL invalide." }); }

  const isAudio  = quality === "audio";
  const format   = getFormat(quality, isAudio);
  const ts       = Date.now();
  const outTpl   = path.join(TEMP_DIR, `vid_${ts}.%(ext)s`);

  const args = [
    url, "--format", format,
    "--output", outTpl,
    "--no-playlist", "--no-warnings",
    "--restrict-filenames",
    "--socket-timeout", "30",
    "--retries", "3",
  ];

  if (isAudio) {
    args.push("--extract-audio", "--audio-format", "mp3", "--audio-quality", "0");
  } else {
    args.push("--merge-output-format", "mp4");
  }

  console.log("📥 Download:", url, "| quality:", quality);

  try {
    const filePath = await new Promise((resolve, reject) => {
      const proc = spawn(YTDLP_PATH, args);
      let stderr = "", finalPath = null;

      proc.stdout.on("data", d => {
        const m = d.toString().match(/Destination: (.+)/);
        if (m) finalPath = m[1].trim();
      });
      proc.stderr.on("data", d => { stderr += d.toString(); });
      proc.on("close", code => {
        if (code !== 0) return reject(new Error(parseYtDlpError(stderr)));
        // Find produced file
        try {
          const base  = `vid_${ts}`;
          const files = fs.readdirSync(TEMP_DIR)
            .filter(f => f.startsWith(base))
            .map(f => path.join(TEMP_DIR, f));
          if (files.length) return resolve(files[0]);
        } catch {}
        if (finalPath && fs.existsSync(finalPath)) return resolve(finalPath);
        reject(new Error("Fichier introuvable après téléchargement."));
      });
    });

    const stat     = fs.statSync(filePath);
    const filename = path.basename(filePath);
    const ext      = path.extname(filename).toLowerCase();
    const mime     = ext === ".mp3" ? "audio/mpeg" : "video/mp4";

    console.log("✅ Sending:", filename, `(${(stat.size/1024/1024).toFixed(1)} MB)`);

    // Log download for authenticated users
    logDownload(req, url, quality, filename);

    res.setHeader("Content-Disposition", `attachment; filename="${sanitize(filename)}"`);
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", stat.size);

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on("close", () => setTimeout(() => { try { fs.unlinkSync(filePath); } catch {} }, 5000));

  } catch (err) {
    console.error("❌", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── SSE progress stream ─────────────────────────────────
app.get("/api/progress", (req, res) => {
  const { url, quality = "max" } = req.query;
  if (!url || !YTDLP_PATH) {
    res.status(400).end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");

  const send = (evt, data) => res.write(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`);
  const isAudio = quality === "audio";
  const ts      = Date.now();
  const outTpl  = path.join(TEMP_DIR, `vid_${ts}.%(ext)s`);

  const args = [
    url, "--format", getFormat(quality, isAudio),
    "--output", outTpl,
    "--no-playlist", "--newline", "--progress",
    "--restrict-filenames", "--socket-timeout", "30",
  ];

  if (isAudio) {
    if (FFMPEG_AVAILABLE) args.push("--extract-audio", "--audio-format", "mp3", "--audio-quality", "0");
    else args.push("--extract-audio", "--audio-format", "best");
  } else if (FFMPEG_AVAILABLE) {
    args.push("--merge-output-format", "mp4");
  }

  send("status", { message: "Connexion...", percent: 2 });

  const proc  = spawn(YTDLP_PATH, args);
  let lastPct = 0;

  proc.stdout.on("data", d => {
    const text = d.toString();
    const pct  = text.match(/\[download\]\s+([\d.]+)%/);
    const eta  = text.match(/ETA\s+([\d:]+)/);
    const spd  = text.match(/at\s+([\d.]+\s*\w+\/s)/);
    if (pct) {
      const p = Math.min(Math.round(parseFloat(pct[1])), 95);
      if (p !== lastPct) {
        lastPct = p;
        send("progress", { percent: p, eta: eta?.[1] || "", speed: spd?.[1] || "" });
      }
    }
    if (text.includes("Merger")) send("status", { message: "Fusion des pistes...", percent: 96 });
  });

  proc.on("close", code => {
    if (code !== 0) { send("error", { message: "Téléchargement échoué. Vérifie l\'URL." }); res.end(); return; }

    try {
      const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(`vid_${ts}`));
      if (!files.length) { send("error", { message: "Fichier introuvable." }); res.end(); return; }
      const fp   = path.join(TEMP_DIR, files[0]);
      const stat = fs.statSync(fp);
      send("done", {
        percent: 100,
        filename: sanitize(files[0]),
        size: stat.size,
        downloadUrl: `/api/file/${files[0]}`,
      });
    } catch (e) { send("error", { message: e.message }); }
    res.end();
  });

  req.on("close", () => proc.kill("SIGTERM"));
});

// ── Serve downloaded file ───────────────────────────────
app.get("/api/file/:name", (req, res) => {
  const name = path.basename(req.params.name);
  const fp   = path.join(TEMP_DIR, name);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: "Fichier expiré." });
  const stat = fs.statSync(fp);
  const ext  = path.extname(name).toLowerCase();
  res.setHeader("Content-Disposition", `attachment; filename="${sanitize(name)}"`);
  res.setHeader("Content-Type", ext === ".mp3" ? "audio/mpeg" : "video/mp4");
  res.setHeader("Content-Length", stat.size);
  const stream = fs.createReadStream(fp);
  stream.pipe(res);
  stream.on("close", () => setTimeout(() => { try { fs.unlinkSync(fp); } catch {} }, 5000));
});

// ── History ─────────────────────────────────────────────
app.get("/api/history", requireAuth, (req, res) => {
  res.json(db.get("downloads").filter({ userId: req.user.id }).orderBy("date","desc").take(50).value());
});

app.delete("/api/history", requireAuth, (req, res) => {
  db.get("downloads").remove({ userId: req.user.id }).write();
  res.json({ message: "Historique effacé." });
});

// ── Status ──────────────────────────────────────────────
app.get("/api/status", (req, res) => {
  let version = "non installé";
  if (YTDLP_PATH) {
    try { version = require("child_process").execFileSync(YTDLP_PATH, ["--version"], { timeout: 3000 }).toString().trim(); } catch {}
  }
  res.json({ status: "online", ytdlp: !!YTDLP_PATH, path: YTDLP_PATH, version, ffmpeg: FFMPEG_AVAILABLE });
});

// ── Helpers ─────────────────────────────────────────────
function parseYtDlpError(msg) {
  if (!msg) return "Erreur inconnue.";
  if (msg.includes("not available"))   return "Vidéo non disponible dans ta région.";
  if (msg.includes("Private video"))   return "Vidéo privée.";
  if (msg.includes("members-only"))    return "Contenu réservé aux membres.";
  if (msg.includes("age-restricted"))  return "Contenu avec restriction d\'âge.";
  if (msg.includes("Unsupported URL")) return "Ce site n\'est pas supporté.";
  if (msg.includes("No video formats"))return "Aucun format disponible.";
  if (msg.includes("Sign in"))         return "Connexion requise pour cette vidéo.";
  const errLine = msg.split("\n").find(l => l.includes("ERROR:"));
  return errLine?.replace(/.*ERROR:\s*/, "").trim() || "Erreur lors du téléchargement.";
}

function sanitize(name) { return name.replace(/[^\w.\-_]/g, "_"); }

function logDownload(req, url, quality, filename) {
  const auth = req.headers["authorization"];
  if (!auth?.startsWith("Bearer ")) return;
  try {
    const decoded = jwt.verify(auth.split(" ")[1], JWT_SECRET);
    const u = db.get("users").find({ id: decoded.id }).value();
    if (u) {
      db.get("users").find({ id: decoded.id }).assign({ downloads: (u.downloads || 0) + 1 }).write();
      db.get("downloads").push({ id: Date.now().toString(), userId: decoded.id, url, quality, filename, date: new Date().toISOString() }).write();
    }
  } catch {}
}

// Cleanup temp files older than 1 hour
setInterval(() => {
  try {
    const now = Date.now();
    fs.readdirSync(TEMP_DIR).forEach(f => {
      const fp = path.join(TEMP_DIR, f);
      try { if (now - fs.statSync(fp).mtimeMs > 3600000) fs.unlinkSync(fp); } catch {}
    });
  } catch {}
}, 30 * 60 * 1000);

// ── SPA fallback ────────────────────────────────────────
app.get("/{*path}", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ── Start ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════╗
  ║   🌙 Vididrop Server v2.0                ║
  ║   http://localhost:${PORT}                  ║
  ║   Moteur: yt-dlp ${YTDLP_PATH ? "✅ actif" : "❌ manquant"}           ║
  ╚══════════════════════════════════════════╝
  `);
});