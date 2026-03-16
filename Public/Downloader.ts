// ═══════════════════════════════════════════════════════
//  VidDrop — TypeScript Core Logic
//  Powered by Cobalt API (cobalt.tools)
// ═══════════════════════════════════════════════════════

// ─── Types & Interfaces ───────────────────────────────

type DownloadStatus =
  | "idle"
  | "detecting"
  | "fetching"
  | "ready"
  | "downloading"
  | "done"
  | "error";

type VideoQuality = "max" | "2160" | "1440" | "1080" | "720" | "480" | "360" | "audio";

interface QualityOption {
  label: string;
  value: VideoQuality;
  badge?: string;
  audioOnly?: boolean;
}

interface CobaltRequest {
  url: string;
  videoQuality?: string;
  audioFormat?: string;
  filenameStyle?: "classic" | "pretty" | "basic" | "nerdy";
  downloadMode?: "auto" | "audio" | "mute";
}

interface CobaltResponse {
  status: "tunnel" | "redirect" | "picker" | "error";
  url?: string;
  filename?: string;
  picker?: CobaltPickerItem[];
  error?: { code: string };
}

interface CobaltPickerItem {
  type: "photo" | "video" | "gif";
  url: string;
  thumb?: string;
}

interface DetectedSite {
  name: string;
  icon: string;
  color: string;
  supportsQuality: boolean;
}

interface AppState {
  status: DownloadStatus;
  url: string;
  quality: VideoQuality;
  site: DetectedSite | null;
  downloadUrl: string | null;
  filename: string | null;
  error: string | null;
  pickerItems: CobaltPickerItem[];
}

// ─── Constants ────────────────────────────────────────

const COBALT_API = "https://api.cobalt.tools/";

const QUALITY_OPTIONS: QualityOption[] = [
  { label: "Best Quality", value: "max",   badge: "MAX" },
  { label: "4K",           value: "2160",  badge: "4K"  },
  { label: "1440p",        value: "1440",  badge: "2K"  },
  { label: "1080p",        value: "1080",  badge: "FHD" },
  { label: "720p",         value: "720",   badge: "HD"  },
  { label: "480p",         value: "480"                  },
  { label: "360p",         value: "360"                  },
  { label: "Audio Only",   value: "audio", badge: "MP3", audioOnly: true },
];

const SITE_DETECTORS: Array<[RegExp, DetectedSite]> = [
  [/youtube\.com|youtu\.be/, { name: "YouTube",   icon: "▶",  color: "#ff0000", supportsQuality: true  }],
  [/twitter\.com|x\.com/,   { name: "X / Twitter",icon: "✕",  color: "#1d9bf0", supportsQuality: false }],
  [/instagram\.com/,        { name: "Instagram",  icon: "◉",  color: "#e1306c", supportsQuality: false }],
  [/tiktok\.com/,           { name: "TikTok",     icon: "♪",  color: "#69c9d0", supportsQuality: false }],
  [/reddit\.com/,           { name: "Reddit",     icon: "◆",  color: "#ff4500", supportsQuality: false }],
  [/twitch\.tv/,            { name: "Twitch",     icon: "◈",  color: "#9147ff", supportsQuality: true  }],
  [/vimeo\.com/,            { name: "Vimeo",      icon: "○",  color: "#1ab7ea", supportsQuality: true  }],
  [/soundcloud\.com/,       { name: "SoundCloud", icon: "♬",  color: "#ff5500", supportsQuality: false }],
  [/bilibili\.com/,         { name: "Bilibili",   icon: "◎",  color: "#00a1d6", supportsQuality: true  }],
  [/dailymotion\.com/,      { name: "Dailymotion",icon: "◐",  color: "#0066dc", supportsQuality: true  }],
];

// ─── URL Validation ────────────────────────────────────

const isValidUrl = (raw: string): boolean => {
  try {
    const u = new URL(raw.trim());
    return ["http:", "https:"].includes(u.protocol);
  } catch {
    return false;
  }
};

const detectSite = (url: string): DetectedSite | null => {
  for (const [pattern, site] of SITE_DETECTORS) {
    if (pattern.test(url)) return site;
  }
  return { name: "Site inconnu", icon: "◇", color: "#888", supportsQuality: true };
};

// ─── State Machine ─────────────────────────────────────

class DownloadStateMachine {
  private state: AppState = {
    status:       "idle",
    url:          "",
    quality:      "max",
    site:         null,
    downloadUrl:  null,
    filename:     null,
    error:        null,
    pickerItems:  [],
  };

  private listeners: Array<(s: AppState) => void> = [];

  subscribe(fn: (s: AppState) => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private emit(): void {
    const snap = { ...this.state };
    this.listeners.forEach(fn => fn(snap));
  }

  private transition(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  getState(): Readonly<AppState> {
    return this.state;
  }

  setUrl(raw: string): void {
    const url = raw.trim();
    const site = isValidUrl(url) ? detectSite(url) : null;
    this.transition({ url, site, status: url ? "detecting" : "idle", error: null });
    if (isValidUrl(url)) {
      setTimeout(() => this.transition({ status: "ready" }), 400);
    }
  }

  setQuality(q: VideoQuality): void {
    this.transition({ quality: q });
  }

  reset(): void {
    this.transition({
      status: "idle", url: "", quality: "max",
      site: null, downloadUrl: null, filename: null,
      error: null, pickerItems: [],
    });
  }

  async download(): Promise<void> {
    const { url, quality } = this.state;

    if (!isValidUrl(url)) {
      this.transition({ status: "error", error: "URL invalide. Colle un lien valide." });
      return;
    }

    this.transition({ status: "fetching", error: null });

    try {
      const body: CobaltRequest = {
        url,
        filenameStyle: "pretty",
        ...(quality === "audio"
          ? { downloadMode: "audio", audioFormat: "mp3" }
          : { videoQuality: quality === "max" ? undefined : quality }),
      };

      const res = await fetch(COBALT_API, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body:    JSON.stringify(body),
      });

      if (!res.ok) throw new Error(`Erreur serveur: ${res.status}`);

      const data: CobaltResponse = await res.json();

      if (data.status === "error") {
        throw new Error(this.mapError(data.error?.code ?? "unknown"));
      }

      if (data.status === "picker" && data.picker?.length) {
        this.transition({ status: "ready", pickerItems: data.picker });
        return;
      }

      if (data.url) {
        this.transition({
          status:      "downloading",
          downloadUrl: data.url,
          filename:    data.filename ?? this.inferFilename(url, quality),
        });

        // Trigger browser download
        this.triggerDownload(data.url, data.filename ?? "video");

        await this.simulateProgress();
        this.transition({ status: "done" });
      } else {
        throw new Error("Réponse inattendue de l'API.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue.";
      this.transition({ status: "error", error: msg });
    }
  }

  private triggerDownload(url: string, filename: string): void {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.target = "_blank";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  private inferFilename(url: string, quality: VideoQuality): string {
    try {
      const u = new URL(url);
      const base = u.hostname.replace("www.", "");
      const ext  = quality === "audio" ? "mp3" : "mp4";
      return `${base}_${Date.now()}.${ext}`;
    } catch {
      return quality === "audio" ? "audio.mp3" : "video.mp4";
    }
  }

  private mapError(code: string): string {
    const map: Record<string, string> = {
      "content.post_not_found":      "Contenu introuvable. Vérifie le lien.",
      "content.video.unavailable":   "Vidéo non disponible dans ta région.",
      "fetch.rate_limit":            "Trop de requêtes. Attends quelques secondes.",
      "fetch.empty":                 "Aucun média trouvé à cette URL.",
      "link.invalid":                "Lien invalide ou non supporté.",
      "content.too_long":            "Contenu trop long pour être téléchargé.",
      "service.unsupported":         "Ce site n'est pas encore supporté.",
    };
    return map[code] ?? `Erreur: ${code}`;
  }

  private simulateProgress(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 1500));
  }
}

// ─── UI Renderer ───────────────────────────────────────

class VidDropUI {
  private machine: DownloadStateMachine;

  constructor(machine: DownloadStateMachine) {
    this.machine = machine;
  }

  mount(): void {
    this.machine.subscribe(state => this.render(state));
    this.attachInputListener();
  }

  private attachInputListener(): void {
    const input = document.getElementById("urlInput") as HTMLInputElement;
    if (!input) return;

    input.addEventListener("input", () => this.machine.setUrl(input.value));
    input.addEventListener("paste", (e) => {
      const pasted = e.clipboardData?.getData("text") ?? "";
      setTimeout(() => this.machine.setUrl(pasted), 0);
    });

    // Quality buttons
    document.querySelectorAll<HTMLButtonElement>("[data-quality]").forEach(btn => {
      btn.addEventListener("click", () => {
        this.machine.setQuality(btn.dataset.quality as VideoQuality);
      });
    });

    // Download button
    document.getElementById("downloadBtn")?.addEventListener("click", () => {
      this.machine.download();
    });

    // Reset button
    document.getElementById("resetBtn")?.addEventListener("click", () => {
      this.machine.reset();
      (document.getElementById("urlInput") as HTMLInputElement).value = "";
    });
  }

  private render(state: AppState): void {
    this.updateSiteBadge(state);
    this.updateQualityGrid(state);
    this.updateDownloadBtn(state);
    this.updateStatus(state);
  }

  private updateSiteBadge(state: AppState): void {
    const badge = document.getElementById("siteBadge");
    if (!badge) return;

    if (state.site && state.status !== "idle") {
      badge.innerHTML = `
        <span style="color:${state.site.color}">${state.site.icon}</span>
        <span>${state.site.name}</span>
      `;
      badge.style.opacity = "1";
    } else {
      badge.style.opacity = "0";
    }
  }

  private updateQualityGrid(state: AppState): void {
    const grid = document.getElementById("qualityGrid");
    if (!grid) return;

    const visible = state.status !== "idle";
    grid.style.opacity       = visible ? "1" : "0";
    grid.style.pointerEvents = visible ? "auto" : "none";
    grid.style.transform     = visible ? "translateY(0)" : "translateY(8px)";

    document.querySelectorAll<HTMLButtonElement>("[data-quality]").forEach(btn => {
      const active = btn.dataset.quality === state.quality;
      btn.classList.toggle("active", active);
    });
  }

  private updateDownloadBtn(state: AppState): void {
    const btn = document.getElementById("downloadBtn") as HTMLButtonElement;
    if (!btn) return;

    const labels: Partial<Record<DownloadStatus, string>> = {
      idle:        "Colle un lien d'abord",
      detecting:   "Détection...",
      ready:       "Télécharger",
      fetching:    "Connexion...",
      downloading: "Téléchargement...",
      done:        "✓ Terminé !",
      error:       "Réessayer",
    };

    btn.textContent = labels[state.status] ?? "Télécharger";
    btn.disabled    = ["idle", "detecting", "fetching", "downloading"].includes(state.status);
    btn.dataset.status = state.status;
  }

  private updateStatus(state: AppState): void {
    const el = document.getElementById("statusMsg");
    if (!el) return;

    if (state.status === "error" && state.error) {
      el.textContent  = "⚠ " + state.error;
      el.className    = "status-msg error";
      el.style.opacity = "1";
    } else if (state.status === "done") {
      el.textContent  = "✓ Téléchargement lancé dans ton navigateur.";
      el.className    = "status-msg success";
      el.style.opacity = "1";
    } else if (state.status === "fetching") {
      el.textContent  = "◌  Analyse du contenu...";
      el.className    = "status-msg info";
      el.style.opacity = "1";
    } else {
      el.style.opacity = "0";
    }
  }
}

// ─── Bootstrap ────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  const machine = new DownloadStateMachine();
  const ui      = new VidDropUI(machine);
  ui.mount();

  // Expose for debug
  (window as any).__vidDrop = machine;
});