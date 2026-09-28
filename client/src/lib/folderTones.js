const FOLDER_CARD_TONES = {
  "services": { label: "text-teal-700", wash: "bg-teal-50", hex: "#0f766e", washHex: "#f0fdfa" },
  "pediatric drugs": { label: "text-violet-700", wash: "bg-violet-50", hex: "#6d28d9", washHex: "#f5f3ff" },
  "wound dressing": { label: "text-rose-700", wash: "bg-rose-50", hex: "#be123c", washHex: "#fff1f2" },
  "consumable": { label: "text-lime-800", wash: "bg-lime-50", hex: "#3f6212", washHex: "#f7fee7" },
  "im drugs": { label: "text-orange-700", wash: "bg-orange-50", hex: "#c2410c", washHex: "#fff7ed" },
  "catherisation & ngt": { label: "text-indigo-700", wash: "bg-indigo-50", hex: "#4338ca", washHex: "#eef2ff" },
  "iv drugs": { label: "text-blue-700", wash: "bg-blue-50", hex: "#1d4ed8", washHex: "#eff6ff" },
  "o2 & nebuliser": { label: "text-cyan-700", wash: "bg-cyan-50", hex: "#0e7490", washHex: "#ecfeff" },
  "investigation": { label: "text-fuchsia-700", wash: "bg-fuchsia-50", hex: "#a21caf", washHex: "#fdf4ff" },
  "oral drugs": { label: "text-emerald-700", wash: "bg-emerald-50", hex: "#047857", washHex: "#ecfdf5" },
};

const DEFAULT_TONE = { label: "text-slate-500", wash: "bg-white", hex: "#64748b", washHex: "#f8fafc" };

function folderTone(name) {
  return FOLDER_CARD_TONES[String(name || "").trim().toLowerCase()] || DEFAULT_TONE;
}

export { folderTone };
