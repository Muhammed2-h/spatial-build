
import type { FeatureCollection, Feature, Point, Geometry } from 'geojson';

export interface DataSource {
  id: string;
  name: string;
  data: FeatureCollection<Geometry>;
  isActive: boolean;
  opacity?: number; // 0 to 1
  // Per-layer settings
  visibleAttributes: string[];
  customResultField: string | null;
  // Cache for large datasets
  pendingFeatures: Feature<Geometry>[];
}

export interface ProcessingFile {
  id: string;
  name: string;
  progress: number; // 0 to 100
  error?: string;
}

export interface GeoState {
  dataSources: DataSource[];
  isLoading: boolean;
  error: string | null;
}

export interface AnalysisResult {
  nearestFeature: Feature<Geometry> | null;
  distance: number | null; // in kilometers
  bearing: number | null; // in degrees (User -> Tower)
  
  // Sector Analysis Metrics
  sectorAzimuth: number | null; // The central heading of the sector (Tower -> Sector Centroid)
  sectorBeamwidth: number | null; // Approximate angular width
  deviationAngle: number | null; // Degrees off-axis
  isInside: boolean; // Geometric inside check
  
  searchPoint: { lat: number; lng: number } | null;
  nearestPoint: { lat: number; lng: number } | null; // The specific vertex used as reference (e.g., tower center)
  rank: number; // 1-based index (1 = nearest, 2 = 2nd nearest)
  totalFeatures: number;
  
  // Source Info
  sourceId: string;
  sourceName: string;
  
  // Audit Info
  timestamp?: number;
}

export interface SearchState {
  query: string;
  isSearching: boolean;
}
