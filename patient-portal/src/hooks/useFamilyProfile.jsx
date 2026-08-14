import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  buildDependentProfile,
  buildPrimaryProfile,
  getDefaultProfileId,
  PRIMARY_PROFILE_ID,
} from "../lib/familyProfiles.js";
import { api, getActingPatientId, setActingPatientId } from "../lib/api.js";
import { dispatchPatientDataChange } from "../lib/patientDataSync.js";
import { useLiveRefreshKey } from "./useLiveRefreshKey.js";
import { usePatientAuth } from "./usePatientAuth.jsx";

const FamilyProfileContext = createContext(null);

export function FamilyProfileProvider({ children }) {
  const { user } = usePatientAuth();
  const refreshKey = useLiveRefreshKey();
  const [dependents, setDependents] = useState([]);
  const [activeProfileId, setActiveProfileId] = useState(() => {
    const stored = getActingPatientId();
    return stored || getDefaultProfileId();
  });

  useEffect(() => {
    let ignore = false;
    async function loadDependents() {
      try {
        const data = await api.get("/patient-portal/dependents");
        if (!ignore) {
          setDependents(data.dependents || []);
        }
      } catch {
        if (!ignore) setDependents([]);
      }
    }
    if (user) {
      void loadDependents();
    }
    return () => {
      ignore = true;
    };
  }, [user, refreshKey]);

  const profiles = useMemo(() => {
    const primary = buildPrimaryProfile(user);
    const family = dependents.map((row, index) => buildDependentProfile(row, index));
    return [primary, ...family];
  }, [user, dependents]);

  const setActiveProfile = useCallback((profileId) => {
    setActiveProfileId(profileId);
    if (!profileId || profileId === PRIMARY_PROFILE_ID) {
      setActingPatientId(null);
    } else {
      setActingPatientId(profileId);
    }
    dispatchPatientDataChange();
  }, []);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId) || profiles[0],
    [profiles, activeProfileId],
  );

  const reloadDependents = useCallback(async () => {
    const data = await api.get("/patient-portal/dependents");
    setDependents(data.dependents || []);
  }, []);

  const value = useMemo(
    () => ({
      activeProfile,
      activeProfileId,
      setActiveProfile,
      profiles,
      dependents,
      reloadDependents,
    }),
    [activeProfile, activeProfileId, setActiveProfile, profiles, dependents, reloadDependents],
  );

  return <FamilyProfileContext.Provider value={value}>{children}</FamilyProfileContext.Provider>;
}

export function useFamilyProfile() {
  const context = useContext(FamilyProfileContext);

  if (!context) {
    throw new Error("useFamilyProfile must be used within a FamilyProfileProvider.");
  }

  return context;
}
