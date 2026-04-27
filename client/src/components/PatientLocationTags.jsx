import React, { useState, useMemo } from 'react';
import { MAURITIUS_LOCATION_OPTIONS } from "../lib/mauritiusLocations.js";

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

export default function PatientLocationTags({ tags = [], onChange, readOnly = false }) {
  const [locationType, setLocationType] = useState("village");
  const [selectedTown, setSelectedTown] = useState("");

  const selectedTownSuburbs = useMemo(() => TOWNS[selectedTown] || [], [selectedTown]);

  const addTag = (category, name, { replaceCategory = false } = {}) => {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) {
      return;
    }

    const next = replaceCategory
      ? tags.filter((tag) => tag.category !== category)
      : tags;

    if (!next.some(t => t.category === category && t.name === normalizedName)) {
      onChange([...next, { category, name: normalizedName }]);
    }
  };

  const removeTag = (category, name) => {
    onChange(tags.filter(t => !(t.category === category && t.name === name)));
  };

  const getTagColor = (category) => {
    switch (category) {
      case 'Clinic': return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'Insurance': return 'bg-green-100 text-green-800 border-green-300';
      case 'Town':
      case 'Neighborhood':
      case 'Village': return 'bg-gray-100 text-gray-800 border-gray-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="grid grid-cols-1 gap-4 rounded-[24px] border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-2">
          <div>
            <label className="block text-sm font-semibold text-slate-700">Clinic</label>
            <select className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400" onChange={(e) => { if(e.target.value) addTag('Clinic', e.target.value); e.target.value=''; }}>
              <option value="">Add Clinic...</option>
              {CLINICS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-semibold text-slate-700">Insurance</label>
            <select className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400" onChange={(e) => { if(e.target.value) addTag('Insurance', e.target.value); e.target.value=''; }}>
              <option value="">Add Insurance...</option>
              {INSURANCE.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>

          <div className="md:col-span-2 relative">
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
                <select
                  className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400"
                  value={selectedTown}
                  onChange={(event) => {
                    const nextTown = event.target.value;
                    setSelectedTown(nextTown);
                    if (nextTown) {
                      addTag("Town", nextTown, { replaceCategory: true });
                    }
                  }}
                >
                  <option value="">Select town...</option>
                  {Object.keys(TOWNS).map((town) => (
                    <option key={town} value={town}>
                      {town}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-slate-700">Suburb</label>
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
                    <option key={suburb} value={suburb}>
                      {suburb}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <div className="md:col-span-2">
              <label className="block text-sm font-semibold text-slate-700">Village</label>
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
                  <option key={village} value={village}>
                    {village}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* Render Tags */}
      <div className="flex flex-wrap gap-2">
        {tags.map((tag, idx) => (
          <span key={idx} className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium ${getTagColor(tag.category)}`}>
            {tag.category}: {tag.name}
            {!readOnly && (
              <button type="button" onClick={() => removeTag(tag.category, tag.name)} className="ml-2 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-current focus:outline-none hover:bg-black/20">
                <span className="sr-only">Remove tag</span>
                &times;
              </button>
            )}
          </span>
        ))}
        {tags.length === 0 && <span className="text-sm italic text-slate-500">No locations or affiliations linked.</span>}
      </div>
    </div>
  );
}