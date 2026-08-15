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
  const userKey = user?.id ?? user?.patient_id ?? null;
  const [dependents, setDependents] = useState([]);
  const [loadedForUser, setLoadedForUser] = useState(null);
  const [activeProfileId, setActiveProfileId] = useState(() => {
    const stored = getActingPatientId();
    return stored || getDefaultProfileId();
  });
  const dependentsReady = loadedForUser != null && loadedForUser === userKey;

  if (loadedForUser != null && loadedForUser !== userKey) {
    setLoadedForUser(null);
    setDependents([]);
  }

  useEffect(() => {
    let ignore = false;
    async function loadDependents() {
      try {
        const data = await api.get("/patient-portal/dependents");
        if (!ignore) {
          setDependents(data.dependents || []);
          setLoadedForUser(userKey);
        }
      } catch {
        // Keep the last good list. Do not mark ready on a failed first fetch,
        // or a stored dependent id would be wiped while dependents is still [].
      }
    }
    if (userKey) {
      void loadDependents();
    } else {
      setDependents([]);
      setLoadedForUser(null);
    }
    return () => {
      ignore = true;
    };
  }, [user, userKey, refreshKey]);

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
    () => profiles.find((profile) => String(profile.id) === String(activeProfileId)) || profiles[0],
    [profiles, activeProfileId],
  );

  useEffect(() => {
    if (!dependentsReady) return;
    if (!activeProfileId || activeProfileId === PRIMARY_PROFILE_ID) return;
    const known = profiles.some((profile) => String(profile.id) === String(activeProfileId));
    if (!known) {
      setActiveProfile(PRIMARY_PROFILE_ID);
    }
  }, [dependentsReady, profiles, activeProfileId, setActiveProfile]);

  const reloadDependents = useCallback(async () => {
    const data = await api.get("/patient-portal/dependents");
    setDependents(data.dependents || []);
    setLoadedForUser(userKey);
  }, [userKey]);

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
