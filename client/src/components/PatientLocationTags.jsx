import React, { useState, useMemo, useEffect, useRef } from "react";
import { Search, X, MapPin } from "lucide-react";
import { MAURITIUS_LOCATION_OPTIONS } from "../lib/mauritiusLocations.js";
import { useIsMobile } from "../hooks/useIsMobile.js";

const CLINICS = ["Anahita Residence", "Anahita Hotel", "Four Seasons", "Radisson Blu Poste Lafayette", "Radisson Blu Azuri", "Azuri Residence", "Crystal Beach", "Medic World", "OCS Santé Flacq", "OCS Médecin PL"];
const INSURANCE = ["Linkham", "NIC", "Swan", "MUA", "Eagle", "Jubilee", "Alliance Sanlam"];
const TOWNS = {
  "Port Louis": ["Cassis", "Bain des Dames", "Roche Bois", "Sainte-Croix", "Vallee des Pretres", "Plaine Verte", "Ward IV", "Tranquebar", "Champ de Mars", "Bell Village", "Pailles"],
  "Beau Bassin - Rose Hill": ["Balfour", "Barkly", "Mont Roches", "Chebel", "Coromandel", "Stanley", "Trefles", "Camp Levieux", "Roches Brunes", "Beau Sejour", "Vandermeersch"],
  "Quatre Bornes": ["Sodnac", "Vieux Quatre Bornes", "Belle Rose", "Pellegrin", "Palma", "Bassin", "La Source", "Bagatelle", "Trianon"],
  "Vacoas - Phoenix": ["Sadally", "Glen Park", "Henrietta", "Reunion", "Camp Mapou", "Floreal (Border)", "Solferino", "Camp Sauvage", "Petit Camp", "Valentia", "Highlands", "Mesnil", "Castel", "Pont Fer"],
  "Curepipe": ["Floreal", "Forest Side", "Eau Coulee", "Les Casernes", "Camp Caval", "Malherbes", "Wooton", "La Brasserie"],
};
const VILLAGES = [...MAURITIUS_LOCATION_OPTIONS].sort((first, second) => first.localeCompare(second));
const TOWN_NAMES = Object.keys(TOWNS);

function SearchableOverlay({ open, title, items, onSelect, onClose }) {
  const [query, setQuery] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      document.body.style.overflow = "hidden";
      setTimeout(() => inputRef.current?.focus(), 80);
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.toLowerCase().includes(needle));
  }, [items, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-white"
      style={{
        paddingTop: "var(--sat)",
        paddingBottom: "var(--sab)",
        paddingLeft: "var(--sal)",
        paddingRight: "var(--sar)",
      }}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          className="grid min-h-12 min-w-10 place-items-center rounded-xl text-slate-500 transition active:bg-slate-100"
        >
          <X className="size-5" />
        </button>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${title.toLowerCase()}...`}
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-[#2d8f98] focus:bg-white"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-400">No results found</p>
        ) : (
          <ul>
            {filtered.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  onClick={() => {
                    onSelect(item);
                    onClose();
                  }}
                  className="flex w-full items-center gap-3 border-b border-slate-100 px-4 py-4 text-left text-sm font-medium text-slate-800 transition active:bg-[rgba(65,200,198,0.08)]"
                >
                  <MapPin className="size-4 shrink-0 text-[#2d8f98]" />
                  {item}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function PatientLocationTags({ tags = [], onChange, readOnly = false }) {
  const isMobile = useIsMobile();
  const [locationType, setLocationType] = useState("village");
  const [selectedTown, setSelectedTown] = useState("");
  const [overlayTarget, setOverlayTarget] = useState(null);

  const selectedTownSuburbs = useMemo(() => TOWNS[selectedTown] || [], [selectedTown]);

  const addTag = (category, name, { replaceCategory = false } = {}) => {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) return;
    const next = replaceCategory ? tags.filter((tag) => tag.category !== category) : tags;
    if (!next.some((t) => t.category === category && t.name === normalizedName)) {
      onChange([...next, { category, name: normalizedName }]);
    }
  };

  const removeTag = (category, name) => {
    onChange(tags.filter((t) => !(t.category === category && t.name === name)));
  };

  const getTagColor = (category) => {
    switch (category) {
      case "Clinic": return "bg-blue-100 text-blue-800 border-blue-300";
      case "Insurance": return "bg-green-100 text-green-800 border-green-300";
      case "Town":
      case "Neighborhood":
      case "Village": return "bg-gray-100 text-gray-800 border-gray-300";
      default: return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  const currentVillageTag = tags.find((t) => t.category === "Village");
  const currentTownTag = tags.find((t) => t.category === "Town");
  const currentSuburbTag = tags.find((t) => t.category === "Neighborhood");

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="grid grid-cols-1 gap-4 rounded-[24px] border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-slate-700">Clinic</label>
            <select
              className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400"
              onChange={(e) => {
                if (e.target.value) addTag("Clinic", e.target.value);
                e.target.value = "";
              }}
            >
              <option value="">Add Clinic...</option>
              {CLINICS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700">Insurance</label>
            <select
              className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400"
              onChange={(e) => {
                if (e.target.value) addTag("Insurance", e.target.value, { replaceCategory: true });
                e.target.value = "";
              }}
            >
              <option value="">Add Insurance...</option>
              {INSURANCE.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>

          <div className="relative md:col-span-2">
            <label className="block text-sm font-semibold text-slate-700">Location Type</label>
            <div className="mt-2 flex items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1">
              <button
                type="button"
                onClick={() => setLocationType("town")}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  locationType === "town"
                    ? "bg-sky-600 text-white shadow-lg shadow-sky-600/20"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Town
              </button>
              <button
                type="button"
                onClick={() => setLocationType("village")}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                  locationType === "village"
                    ? "bg-sky-600 text-white shadow-lg shadow-sky-600/20"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Village
              </button>
            </div>
          </div>

          {locationType === "town" ? (
            <>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Town</label>
                {isMobile ? (
                  <button
                    type="button"
                    onClick={() => setOverlayTarget("town")}
                    className="mt-2 flex min-h-12 w-full items-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 transition active:border-[#2d8f98]"
                  >
                    <MapPin className="mr-2 size-4 text-[#2d8f98]" />
                    {currentTownTag?.name || "Tap to search towns..."}
                  </button>
                ) : (
                  <select
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                    value={selectedTown}
                    onChange={(event) => {
                      const nextTown = event.target.value;
                      setSelectedTown(nextTown);
                      if (nextTown) addTag("Town", nextTown, { replaceCategory: true });
                    }}
                  >
                    <option value="">Select town...</option>
                    {TOWN_NAMES.map((town) => (
                      <option key={town} value={town}>{town}</option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Suburb</label>
                {isMobile ? (
                  <button
                    type="button"
                    disabled={!selectedTown && !currentTownTag}
                    onClick={() => setOverlayTarget("suburb")}
                    className="mt-2 flex min-h-12 w-full items-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 transition active:border-[#2d8f98] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <MapPin className="mr-2 size-4 text-[#2d8f98]" />
                    {currentSuburbTag?.name || (selectedTown || currentTownTag ? "Tap to search suburbs..." : "Choose town first")}
                  </button>
                ) : (
                  <select
                    className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400 disabled:cursor-not-allowed disabled:bg-slate-100"
                    disabled={!selectedTown}
                    onChange={(event) => {
                      if (event.target.value) {
                        addTag("Neighborhood", event.target.value, { replaceCategory: true });
                        event.target.value = "";
                      }
                    }}
                  >
                    <option value="">{selectedTown ? "Select suburb..." : "Choose town first"}</option>
                    {selectedTownSuburbs.map((suburb) => (
                      <option key={suburb} value={suburb}>{suburb}</option>
                    ))}
                  </select>
                )}
              </div>
            </>
          ) : (
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700">Village</label>
              {isMobile ? (
                <button
                  type="button"
                  onClick={() => setOverlayTarget("village")}
                  className="mt-2 flex min-h-12 w-full items-center rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm text-slate-700 transition active:border-[#2d8f98]"
                >
                  <MapPin className="mr-2 size-4 text-[#2d8f98]" />
                  {currentVillageTag?.name || "Tap to search villages..."}
                </button>
              ) : (
                <select
                  className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  onChange={(event) => {
                    if (event.target.value) {
                      addTag("Village", event.target.value, { replaceCategory: true });
                      event.target.value = "";
                    }
                  }}
                >
                  <option value="">Select village...</option>
                  {VILLAGES.map((village) => (
                    <option key={village} value={village}>{village}</option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tags.map((tag, idx) => (
          <span
            key={idx}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${getTagColor(tag.category)}`}
          >
            {tag.category}: {tag.name}
            {!readOnly && (
              <button
                type="button"
                onClick={() => removeTag(tag.category, tag.name)}
                className="ml-2 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-current hover:bg-black/20 focus:outline-none"
              >
                <span className="sr-only">Remove tag</span>&times;
              </button>
            )}
          </span>
        ))}
        {tags.length === 0 && (
          <span className="text-sm italic text-slate-500">No locations or affiliations linked.</span>
        )}
      </div>

      {isMobile && (
        <>
          <SearchableOverlay
            open={overlayTarget === "village"}
            title="Villages"
            items={VILLAGES}
            onSelect={(value) => addTag("Village", value, { replaceCategory: true })}
            onClose={() => setOverlayTarget(null)}
          />
          <SearchableOverlay
            open={overlayTarget === "town"}
            title="Towns"
            items={TOWN_NAMES}
            onSelect={(value) => {
              setSelectedTown(value);
              addTag("Town", value, { replaceCategory: true });
            }}
            onClose={() => setOverlayTarget(null)}
          />
          <SearchableOverlay
            open={overlayTarget === "suburb"}
            title="Suburbs"
            items={TOWNS[selectedTown || currentTownTag?.name] || []}
            onSelect={(value) => addTag("Neighborhood", value, { replaceCategory: true })}
            onClose={() => setOverlayTarget(null)}
          />
        </>
      )}
    </div>
  );
}