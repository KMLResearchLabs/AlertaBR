function distanceKm(lat1, lng1, lat2, lng2) {
  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCapPolygon(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const ring = value
    .trim()
    .split(/\s+/)
    .map((point) => {
      const parts = point.split(",");
      if (parts.length !== 2) {
        return null;
      }

      const lat = Number(parts[0]);
      const lng = Number(parts[1]);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
      }

      return [lng, lat];
    })
    .filter(Boolean);

  if (ring.length < 3) {
    return null;
  }

  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];

  if (firstLng !== lastLng || firstLat !== lastLat) {
    ring.push([firstLng, firstLat]);
  }

  return ring;
}

function geometryFromRings(rings) {
  if (!rings.length) {
    return null;
  }

  if (rings.length === 1) {
    return {
      type: "Polygon",
      coordinates: [rings[0]]
    };
  }

  return {
    type: "MultiPolygon",
    coordinates: rings.map((ring) => [ring])
  };
}

function geometryBbox(geometry) {
  const points = flattenGeometry(geometry);
  if (!points.length) {
    return null;
  }

  let minLng = points[0][0];
  let minLat = points[0][1];
  let maxLng = points[0][0];
  let maxLat = points[0][1];

  for (const [lng, lat] of points) {
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }

  return [minLng, minLat, maxLng, maxLat];
}

function geometryCenter(geometry) {
  const points = flattenGeometry(geometry);
  if (!points.length) {
    return null;
  }

  const totals = points.reduce((accumulator, [lng, lat]) => {
    accumulator.lng += lng;
    accumulator.lat += lat;
    return accumulator;
  }, { lng: 0, lat: 0 });

  return {
    lng: totals.lng / points.length,
    lat: totals.lat / points.length
  };
}

function flattenGeometry(geometry) {
  if (!geometry) {
    return [];
  }

  if (geometry.type === "Polygon") {
    return geometry.coordinates[0] || [];
  }

  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) => polygon[0] || []);
  }

  return [];
}

module.exports = {
  distanceKm,
  geometryBbox,
  geometryCenter,
  geometryFromRings,
  parseCapPolygon
};
