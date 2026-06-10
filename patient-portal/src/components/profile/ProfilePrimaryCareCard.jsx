import { Phone, Stethoscope } from "lucide-react";
import { formatDoctorName } from "../../lib/healthRecordsDisplay.js";

const OCS_CARE_TEL = "52522234";
const OCS_CARE_DISPLAY = "52 52 22 34";

function ProfilePrimaryCareCard({ doctorName }) {
  const displayName = doctorName ? formatDoctorName(doctorName) : "To be assigned";

  return (
    <section className="profile-list-card profile-list-card-tinted profile-crafted-card">
      <div className="flex items-center gap-3 px-5 py-4">
        <Stethoscope className="profile-row-icon size-[18px] shrink-0" strokeWidth={1.75} />
        <p className="text-[15px] font-semibold leading-snug text-[#1a5c52]">{displayName}</p>
      </div>
      <div className="profile-list-divider" aria-hidden="true" />
      <div className="flex items-center gap-3 px-5 py-4">
        <Phone className="profile-row-icon size-[18px] shrink-0" strokeWidth={1.75} />
        {doctorName ? (
          <a
            href={`tel:${OCS_CARE_TEL}`}
            className="text-[15px] font-semibold text-[#e8a020] transition hover:text-[#c88710] active:opacity-70"
          >
            {OCS_CARE_DISPLAY}
          </a>
        ) : (
          <p className="text-[15px] font-medium text-[#8a9e9a]">Available after assignment</p>
        )}
      </div>
    </section>
  );
}

export default ProfilePrimaryCareCard;
