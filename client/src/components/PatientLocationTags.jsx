import React, { useState, useMemo } from 'react';

const CLINICS = ["Anahita Residence", "Anahita Hotel", "Four Seasons", "Radisson Blu Poste Lafayette", "Radisson Blu Azuri", "Azuri Residence", "Crystal Beach", "Medic World", "OCS Santé Flacq", "OCS Médecin PL"];
const INSURANCE = ["Linkham", "NIC", "Swan", "MUA", "Eagle", "Jubilee", "Alliance Sanlam"];
const TOWNS = {
  "Port Louis": ["Cassis", "Bain des Dames", "Roche Bois", "Sainte-Croix", "Vallée des Prêtres", "Plaine Verte", "Ward IV", "Tranquebar", "Champ de Mars", "Bell Village", "Pailles"],
  "Beau Bassin - Rose Hill": ["Balfour", "Barkly", "Mont Roches", "Chebel", "Coromandel", "Stanley", "Trèfles", "Camp Levieux", "Roches Brunes", "Beau Séjour", "Vandermeersch"],
  "Quatre Bornes": ["Sodnac", "Vieux Quatre Bornes", "Belle Rose", "Pellegrin", "Palma", "Bassin", "La Source", "Bagatelle", "Trianon"],
  "Vacoas - Phoenix": ["Sadally", "Glen Park", "Henrietta", "Reunion", "Camp Mapou", "Floreal (Border)", "Solferino", "Camp Sauvage", "Petit Camp", "Valentia", "Highlands", "Mesnil", "Castel", "Pont Fer"],
  "Curepipe": ["Floreal", "Forest Side", "Eau Coulée", "Les Casernes", "Camp Caval", "Malherbes", "Wooton", "La Brasserie"]
};
const VILLAGES = ["Albion", "Amaury", "Arsenal", "Baie du Tombeau", "Bambous", "Bel Air Rivière Sèche", "Belle Mare", "Bon Accueil", "Brisée Verdière", "Calebasses", "Camp de Masque", "Cap Malheureux", "Chamarel", "Chemin Grenier", "Flic en Flac", "Fond du Sac", "Goodlands", "Grand Baie", "Grand Gaube", "Lallmatie", "Le Hochet", "Mahébourg", "Montagne Longue", "Pamplemousses", "Petit Raffray", "Pitre", "Plaine des Papayes", "Pointe aux Piments", "Poste de Flacq", "Poudre d'Or", "Rivière du Rempart", "Roches Noires", "Rose Belle", "Saint Pierre", "Souillac", "Surinam", "Terre Rouge", "Triolet", "Trou aux Biches", "Trou d'Eau Douce"];

export default function PatientLocationTags({ tags = [], onChange, readOnly = false }) {
  const [selectedTown, setSelectedTown] = useState("");
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 border rounded-md bg-white">
          <div>
            <label className="block text-sm font-medium text-gray-700">Clinic</label>
            <select className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" onChange={(e) => { if(e.target.value) addTag('Clinic', e.target.value); e.target.value=''; }}>
              <option value="">Add Clinic...</option>
              {CLINICS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700">Insurance</label>
            <select className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" onChange={(e) => { if(e.target.value) addTag('Insurance', e.target.value); e.target.value=''; }}>
              <option value="">Add Insurance...</option>
              {INSURANCE.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Town</label>
            <select className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" value={selectedTown} onChange={(e) => {
              setSelectedTown(e.target.value);
              if(e.target.value) addTag('Town', e.target.value);
            }}>
              <option value="">Select Town...</option>
              {Object.keys(TOWNS).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {selectedTown && (
            <div>
              <label className="block text-sm font-medium text-gray-700">Neighborhood (in {selectedTown})</label>
              <select className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" onChange={(e) => { if(e.target.value) addTag('Neighborhood', e.target.value); e.target.value=''; }}>
                <option value="">Add Neighborhood...</option>
                {TOWNS[selectedTown].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}

          <div className="md:col-span-2 relative">
            <label className="block text-sm font-medium text-gray-700">Village Search</label>
            <input 
              type="text" 
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm" 
              placeholder="Type to search villages..."
              value={villageSearch}
              onChange={(e) => setVillageSearch(e.target.value)}
            />
            {filteredVillages.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-white shadow-lg max-h-40 rounded-md py-1 text-base overflow-auto sm:text-sm border">
                {filteredVillages.map(v => (
                  <li key={v} 
                    className="cursor-pointer select-none relative py-2 pl-3 hover:bg-indigo-600 hover:text-white"
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
          <span key={idx} className={`inline-flex items-center px-3 py-1 rounded-full border text-sm font-medium ${getTagColor(tag.category)}`}>
            {tag.category}: {tag.name}
            {!readOnly && (
              <button type="button" onClick={() => removeTag(tag.category, tag.name)} className="ml-2 flex-shrink-0 h-4 w-4 rounded-full inline-flex items-center justify-center text-current hover:bg-black hover:bg-opacity-20 focus:outline-none">
                <span className="sr-only">Remove tag</span>
                &times;
              </button>
            )}
          </span>
        ))}
        {tags.length === 0 && <span className="text-sm text-gray-500 italic">No locations or affiliations linked.</span>}
      </div>
    </div>
  );
}