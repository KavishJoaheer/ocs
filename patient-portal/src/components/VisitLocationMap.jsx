import { useEffect, useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";

function buildMapEmbedUrl(lat, lon) {
  const latitude = Number(lat);
  const longitude = Number(lon);
  const delta = 0.012;
  const bbox = [
    longitude - delta,
    latitude - delta,
    longitude + delta,
    latitude + delta,
  ].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude},${longitude}`;
}

function buildExternalMapUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

function VisitLocationMap({ address, className = "" }) {
  const [coords, setCoords] = useState(null);
  const [loading, setLoading] = useState(Boolean(address));

  useEffect(() => {
    if (!address) {
      setCoords(null);
      setLoading(false);
      return undefined;
    }

    let ignore = false;
    setLoading(true);

    const query = `${address}, Mauritius`;
    fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
      { headers: { Accept: "application/json" } },
    )
      .then((response) => response.json())
      .then((results) => {
        if (ignore) return;
        const match = results?.[0];
        if (match?.lat && match?.lon) {
          setCoords({ lat: match.lat, lon: match.lon });
        } else {
          setCoords(null);
        }
      })
      .catch(() => {
        if (!ignore) setCoords(null);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [address]);

  if (!address) {
    return null;
  }

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[#22485b]">
          <MapPin className="size-4 shrink-0 text-[#2d8f98]" />
          <span className="truncate">Visit location</span>
        </div>
        <a
          href={buildExternalMapUrl(address)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[#2d8f98] transition hover:text-[#23767f]"
        >
          Open in Maps
          <ExternalLink className="size-3.5" />
        </a>
      </div>

      {loading ? (
        <div className="flex h-44 items-center justify-center rounded-2xl border border-[rgba(65,200,198,0.16)] bg-[rgba(65,200,198,0.06)] text-sm text-[#5b7f8a]">
          Loading map…
        </div>
      ) : coords ? (
        <iframe
          title="Visit location map"
          src={buildMapEmbedUrl(coords.lat, coords.lon)}
          className="h-44 w-full rounded-2xl border border-[rgba(65,200,198,0.16)] bg-white"
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        <div className="rounded-2xl border border-[rgba(65,200,198,0.16)] bg-white/80 p-4 text-sm leading-relaxed text-[#5b7f8a]">
          {address}
        </div>
      )}
    </div>
  );
}

export default VisitLocationMap;
