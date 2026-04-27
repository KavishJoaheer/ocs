import React, { useState, useMemo } from 'react';
import { MAURITIUS_LOCATION_OPTIONS } from "../lib/mauritiusLocations.js";

const CLINICS = ["Anahita Residence", "Anahita Hotel", "Four Seasons", "Radisson Blu Poste Lafayette", "Radisson Blu Azuri", "Azuri Residence", "Crystal Beach", "Medic World", "OCS Santé Flacq", "OCS Médecin PL"];
const INSURANCE = ["Linkham", "NIC", "Swan", "MUA", "Eagle", "Jubilee", "Alliance Sanlam"];
const VILLAGES = [...MAURITIUS_LOCATION_OPTIONS].sort((first, second) => first.localeCompare(second));

export default function PatientLocationTags({ tags = [], onChange, readOnly = false }) {
  const [villageSearch, setVillageSearch] = useState("");

  const filteredVillages = useMemo(() => {
    if (!villageSearch) return [];
    return VILLAGES.filter(v => v.toLowerCase().includes(villageSearch.toLowerCase()));
  }, [villageSearch]);

  const addTag = (category, name) => {
    if (!tags.some(t => t.category === category && t.name === name)) {
      onChange([...tags, { category, name }]);
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
            <label className="block text-sm font-semibold text-slate-700">Village Search</label>
            <input 
              type="text" 
              className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-sky-400" 
              placeholder="Type to search villages..."
              value={villageSearch}
              onChange={(e) => setVillageSearch(e.target.value)}
            />
            {filteredVillages.length > 0 && (
              <ul className="absolute z-10 mt-2 max-h-56 w-full overflow-auto rounded-2xl border border-slate-200 bg-white py-1 text-sm shadow-lg">
                {filteredVillages.map(v => (
                  <li key={v} 
                    className="cursor-pointer select-none px-3 py-2 text-slate-700 transition hover:bg-sky-50 hover:text-sky-700"
                    onClick={() => { addTag('Village', v); setVillageSearch(""); }}>
                    {v}
                  </li>
                ))}
              </ul>
            )}
          </div>
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