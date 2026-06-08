import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { buildPrimaryProfile, getDefaultProfileId } from "../lib/familyProfiles.js";
import { usePatientAuth } from "./usePatientAuth.jsx";

const FamilyProfileContext = createContext(null);

export function FamilyProfileProvider({ children }) {
  const { user } = usePatientAuth();
  const [activeProfileId, setActiveProfileId] = useState(getDefaultProfileId);

  // The profile list is derived from the authenticated patient, so each signed-in
  // user sees their own identity (no shared/hardcoded profile).
  const profiles = useMemo(() => [buildPrimaryProfile(user)], [user]);

  const setActiveProfile = useCallback((profileId) => {
    setActiveProfileId(profileId);
  }, []);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) || profiles[0],
    [profiles, activeProfileId],
  );

  const value = useMemo(
    () => ({
      activeProfile,
      activeProfileId,
      setActiveProfile,
      profiles,
    }),
    [activeProfile, activeProfileId, setActiveProfile, profiles],
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
