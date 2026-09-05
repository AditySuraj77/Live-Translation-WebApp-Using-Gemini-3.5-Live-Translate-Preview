export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface DistanceResult {
  km: number;
  miles: number;
  formatted: string;
}

/**
 * Calculates the great-circle distance between two points on the Earth
 * using the Haversine formula.
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): DistanceResult {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const km = Math.round(R * c);
  const miles = Math.round(km * 0.621371);

  return {
    km,
    miles,
    formatted: `${km.toLocaleString()} km (${miles.toLocaleString()} mi)`,
  };
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Converts latitude and longitude to 3D Cartesian sphere coordinates
 * with rotation offset applied.
 */
export function latLonToSphere(
  lat: number,
  lon: number,
  radius: number,
  rotX = 0,
  rotY = 0
): Vec3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180) + rotY;

  // Spherical to Cartesian
  let x = -(radius * Math.sin(phi) * Math.cos(theta));
  let z = radius * Math.sin(phi) * Math.sin(theta);
  let y = radius * Math.cos(phi);

  // Apply tilt rotation around X-axis
  if (rotX !== 0) {
    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);
    const newY = y * cosX - z * sinX;
    const newZ = y * sinX + z * cosX;
    y = newY;
    z = newZ;
  }

  return { x, y, z };
}
