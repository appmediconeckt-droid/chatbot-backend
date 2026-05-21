// Reverse geocoding via OpenStreetMap Nominatim.
// Nominatim policy: max 1 req/sec, must send a real User-Agent identifying the app.
// Docs: https://operations.osmfoundation.org/policies/nominatim/

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";
const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ||
  "MindCrawller-Mediconeckt/1.0 (admin@mediconeckt.local)";

const isValidCoord = (lat, lng) =>
  typeof lat === "number" &&
  typeof lng === "number" &&
  lat >= -90 &&
  lat <= 90 &&
  lng >= -180 &&
  lng <= 180;

export const reverseGeocode = async (lat, lng) => {
  if (!isValidCoord(lat, lng)) {
    throw new Error("Invalid coordinates");
  }

  const url = `${NOMINATIM_URL}?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": "en",
    },
  });

  if (!res.ok) {
    throw new Error(`Nominatim returned ${res.status}`);
  }

  const data = await res.json();
  const addr = data.address || {};

  return {
    address: data.display_name || "",
    city: addr.city || addr.town || addr.village || addr.county || "",
    state: addr.state || "",
    country: addr.country || "",
  };
};
