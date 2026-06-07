import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { findProfileById, getDefaultProfileId } from "../lib/familyProfiles.js";

const FamilyProfileContext = createContext(null);

export function FamilyProfileProvider({ children }) {
  const [activeProfileId, setActiveProfileId] = useState(getDefaultProfileId);

  const setActiveProfile = useCallback((profileId) => {
    setActiveProfileId(profileId);
  }, []);

  const activeProfile = useMemo(
    () => findProfileById(activeProfileId),
    [activeProfileId],
  );

  const value = useMemo(
    () => ({
      activeProfile,
      activeProfileId,
      setActiveProfile,
    }),
    [activeProfile, activeProfileId, setActiveProfile],
  );

  return (
    <FamilyProfileContext.Provider value={value}>{children}</FamilyProfileContext.Provider>
  );
}

export function useFamilyProfile() {
  const context = useContext(FamilyProfileContext);

  if (!context) {
    throw new Error("useFamilyProfile must be used within a FamilyProfileProvider.");
  }

  return context;
}
