const FOLDER_CARD_TONES = {
  "services": { label: "text-teal-800", wash: "bg-teal-200", hex: "#0f766e", washHex: "#99f6e4" },
  "pediatric drugs": { label: "text-violet-800", wash: "bg-violet-300", hex: "#6d28d9", washHex: "#c4b5fd" },
  "wound dressing": { label: "text-red-800", wash: "bg-red-200", hex: "#b91c1c", washHex: "#fecaca" },
  "consumable": { label: "text-yellow-800", wash: "bg-yellow-200", hex: "#a16207", washHex: "#fef08a" },
  "im drugs": { label: "text-orange-800", wash: "bg-orange-200", hex: "#c2410c", washHex: "#fed7aa" },
  "catherisation & ngt": { label: "text-indigo-800", wash: "bg-indigo-300", hex: "#3730a3", washHex: "#a5b4fc" },
  "iv drugs": { label: "text-blue-800", wash: "bg-blue-300", hex: "#1e40af", washHex: "#93c5fd" },
  "o2 & nebuliser": { label: "text-sky-700", wash: "bg-cyan-200", hex: "#0284c7", washHex: "#67e8f9" },
  "investigation": { label: "text-pink-800", wash: "bg-pink-200", hex: "#be185d", washHex: "#fbcfe8" },
  "oral drugs": { label: "text-green-800", wash: "bg-green-200", hex: "#166534", washHex: "#bbf7d0" },
};

const DEFAULT_TONE = { label: "text-slate-500", wash: "bg-white", hex: "#64748b", washHex: "#f8fafc" };

function folderTone(name) {
  return FOLDER_CARD_TONES[String(name || "").trim().toLowerCase()] || DEFAULT_TONE;
}

export { folderTone };
