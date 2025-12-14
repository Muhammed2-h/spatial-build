
// Default center (India)
export const DEFAULT_CENTER = {
  lat: 20.5937,
  lng: 78.9629,
};

export const DEFAULT_ZOOM = 5;

// --- Point Styles ---
export const DATA_LAYER_STYLE = {
  radius: 6,
  fillColor: '#3B82F6', // Tailwind blue-500
  fillOpacity: 0.8,
  color: '#ffffff',
  weight: 1,
  opacity: 1
};

export const HIGHLIGHT_STYLE = {
  radius: 10,
  fillColor: '#EF4444', // Tailwind red-500
  fillOpacity: 1,
  color: '#ffffff',
  weight: 3,
  opacity: 1
};

// --- Polygon Styles ---
export const POLYGON_STYLE = {
  fillColor: '#3B82F6',
  fillOpacity: 0.2,
  color: '#2563EB', // blue-600
  weight: 2,
};

export const POLYGON_HIGHLIGHT_STYLE = {
  fillColor: '#EF4444', // Red fill
  fillOpacity: 0.5,    // More opaque to stand out
  color: '#B91C1C',    // Darker red border (red-700)
  weight: 4,
  opacity: 1
};

export const CLICKED_POLYGON_STYLE = {
  fillColor: '#F59E0B', // Amber 500
  fillOpacity: 0.6,
  color: '#D97706', // Amber 600
  weight: 4,
  opacity: 1
};

export const SEARCH_MARKER_STYLE = {
  radius: 8,
  fillColor: '#10B981', // Emerald 500
  fillOpacity: 1,
  color: '#064E3B',
  weight: 2,
};
