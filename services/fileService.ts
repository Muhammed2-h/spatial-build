
import JSZip from 'jszip';
// @ts-ignore
import * as togeojson from '@tmcw/togeojson';
import { coordAll, point, bearing, centroid } from '@turf/turf';
import { FeatureCollection, Geometry, Position, Feature } from 'geojson';

// SECURITY: Max file size 50MB to prevent DoS/Crash
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.kml', '.kmz'];

// Helper to yield control to the main thread to keep UI responsive
const yieldToMain = () => new Promise(resolve => setTimeout(resolve, 0));

// Helper to calculate angle at vertex B given neighbors A and C
// Returns angle in degrees (0-180)
const calculateAngle = (curr: number[], prev: number[], next: number[]): number => {
    try {
        const pCurr = point(curr);
        const pPrev = point(prev);
        const pNext = point(next);
        
        const b1 = bearing(pCurr, pPrev);
        const b2 = bearing(pCurr, pNext);
        
        let diff = Math.abs(b1 - b2);
        if (diff > 180) diff = 360 - diff;
        return diff;
    } catch (e) {
        return 180;
    }
};

// Helper to check for explicit coordinates in properties
// Matches keys like 'lat', 'latitude', 'site_lat', etc.
const getExplicitCenter = (properties: any): Position | null => {
    if (!properties) return null;
    
    const pKeys = Object.keys(properties);
    // Regex for finding latitude/longitude keys (case insensitive)
    const latKey = pKeys.find(k => /^(site_?)?lat(itude)?$/i.test(k));
    const lngKey = pKeys.find(k => /^(site_?)?lon(gitude)?|lng$/i.test(k));

    if (latKey && lngKey) {
        const lat = parseFloat(properties[latKey]);
        const lng = parseFloat(properties[lngKey]);
        // Simple validity check
        if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            return [lng, lat];
        }
    }
    return null;
}

export const parseGeoFile = async (file: File): Promise<FeatureCollection<Geometry>> => {
  // SECURITY CHECK: File Size
  if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`);
  }

  const fileName = file.name.toLowerCase();
  
  // SECURITY CHECK: File Extension
  if (!ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext))) {
       throw new Error('Invalid file type. Only .kml and .kmz files are allowed.');
  }

  let kmlText = '';

  if (fileName.endsWith('.kmz')) {
    const zip = new JSZip();
    try {
        const loadedZip = await zip.loadAsync(file);
        // Find the first .kml file in the zip
        const kmlFilename = Object.keys(loadedZip.files).find(name => name.toLowerCase().endsWith('.kml'));
        
        if (!kmlFilename) {
          throw new Error('No KML file found inside the KMZ archive.');
        }

        // Check uncompressed size of KML (simple heuristic protection)
        const fileData = loadedZip.files[kmlFilename];
        // @ts-ignore - _data is internal but often accessible, or we rely on JSZip's internal memory limits
        kmlText = await fileData.async('string');
    } catch (e: any) {
        throw new Error('Failed to read KMZ file. The file may be corrupted or encrypted.');
    }
  } else if (fileName.endsWith('.kml')) {
    kmlText = await file.text();
  }

  // Parse KML text to XML DOM
  // SECURITY: DOMParser in browsers disables DTD/external entities by default, preventing XXE.
  const parser = new DOMParser();
  const kmlDom = parser.parseFromString(kmlText, 'text/xml');
  
  // check for parsing errors
  const parseError = kmlDom.querySelector('parsererror');
  if (parseError) {
      throw new Error('Invalid XML/KML content.');
  }

  // Convert to GeoJSON
  const geojson = togeojson.kml(kmlDom) as FeatureCollection<Geometry>;

  if (!geojson || !geojson.features) {
    throw new Error('Failed to parse GeoJSON from file.');
  }

  // DEDUPLICATION STEP
  const uniqueFeatures: Feature<Geometry>[] = [];
  const seenSignatures = new Set<string>();

  // Use standard loop for async yielding
  const featureCount = geojson.features.length;
  
  for (let i = 0; i < featureCount; i++) {
      // Yield to main thread every 2000 features to keep UI responsive
      if (i % 2000 === 0) await yieldToMain();

      const feature = geojson.features[i];

      // Skip empty geometries
      if (!feature.geometry) continue;

      const coords = coordAll(feature);
      if (coords.length === 0) continue;

      // Create a signature based on geometry type and rounded coordinates
      // Rounding to 5 decimal places (~1.1 meters) handles minor floating point variances
      const coordSig = coords
        .map(c => `${c[0].toFixed(5)},${c[1].toFixed(5)}`)
        .join(';');
      
      const signature = `${feature.geometry.type}|${coordSig}`;

      if (!seenSignatures.has(signature)) {
          seenSignatures.add(signature);
          uniqueFeatures.push(feature);
      }
  }

  geojson.features = uniqueFeatures;

  // PRE-PROCESSING: Identify shared vertices (Tower Centers)
  // 1. Build a frequency map of all coordinates in the dataset
  const coordCounts = new Map<string, number>();

  for (let i = 0; i < geojson.features.length; i++) {
      if (i % 3000 === 0) await yieldToMain();

      const feature = geojson.features[i];
      const coords = coordAll(feature);
      // Deduplicate coordinates within a single feature to avoid self-inflation
      const uniqueCoords = new Set(coords.map((c: any) => c.join(',')));
      
      uniqueCoords.forEach((cStr: any) => {
          coordCounts.set(cStr, (coordCounts.get(cStr) || 0) + 1);
      });
  }

  // 2. Inject properties: Unique ID and the Identified Center
  let counter = 0;
  // Generate a random session ID to avoid ID collisions across multiple files
  const sessionId = Math.random().toString(36).substr(2, 6);

  for (let i = 0; i < geojson.features.length; i++) {
    // Heavier geometry calculations, yield more frequently
    if (i % 500 === 0) await yieldToMain();

    const feature = geojson.features[i];

    if (!feature.properties) feature.properties = {};
    feature.properties._id = `feat_${sessionId}_${Date.now()}_${counter++}`;

    // STRATEGY 1: Check for explicit coordinates in KML ExtendedData/Properties
    const explicitCenter = getExplicitCenter(feature.properties);
    if (explicitCenter) {
        feature.properties._center = explicitCenter;
        continue; // Skip geometric heuristics if we have explicit data
    }

    // Determine the main ring of coordinates for analysis
    let ring: Position[] = [];
    
    if (feature.geometry.type === 'Polygon') {
        ring = feature.geometry.coordinates[0];
    } else if (feature.geometry.type === 'MultiPolygon') {
        // Use the outer ring of the first polygon as a representative
        ring = feature.geometry.coordinates[0][0];
    } else {
        // Fallback for Lines/Points/Collections
        ring = coordAll(feature);
        if (ring.length > 0) feature.properties._center = ring[0];
        continue;
    }

    // If not a polygon ring (e.g. LineString or Point), simplified logic
    if (ring.length < 3) {
         if (ring.length > 0) feature.properties._center = ring[0];
         continue;
    }

    // Normalize Ring: GeoJSON polygons are closed (Last == First). 
    const isClosed = (
        ring.length > 0 && 
        ring[0][0] === ring[ring.length - 1][0] && 
        ring[0][1] === ring[ring.length - 1][1]
    );
    
    const analysisLength = isClosed ? ring.length - 1 : ring.length;
    
    // Calculate angles at each vertex
    const angles: number[] = [];
    for (let j = 0; j < analysisLength; j++) {
        const coord = ring[j];
        const prev = ring[(j - 1 + analysisLength) % analysisLength];
        const next = ring[(j + 1) % analysisLength];
        angles.push(calculateAngle(coord, prev, next));
    }

    // STRATEGY 2: Regular Polygon / Omni Antenna Detection
    const avgAngle = angles.reduce((a, b) => a + b, 0) / angles.length;
    const variance = angles.reduce((a, b) => a + Math.pow(b - avgAngle, 2), 0) / angles.length;
    const stdDev = Math.sqrt(variance);

    if (analysisLength > 3 && avgAngle > 90 && stdDev < 15) {
        try {
            const center = centroid(feature);
            feature.properties._center = center.geometry.coordinates;
            continue;
        } catch (e) {
            // Fallback to vertex scoring if centroid fails
        }
    }

    // STRATEGY 3: Sector Tip Identification (Weighted Scoring)
    let bestScore = -Infinity;
    let bestCenter = ring[0];

    for (let k = 0; k < analysisLength; k++) {
        const coord = ring[k];
        const cStr = coord.join(',');
        
        const count = coordCounts.get(cStr) || 1;
        const scoreTopology = count * 50;
        const scoreIndex = (k === 0) ? 80 : 0;
        const angle = angles[k];
        const scoreGeometry = (180 - angle) * 2;

        const totalScore = scoreTopology + scoreIndex + scoreGeometry;

        if (totalScore > bestScore) {
            bestScore = totalScore;
            bestCenter = coord;
        }
    }
    
    // Store the calculated center in properties
    feature.properties._center = bestCenter;
  }

  return geojson;
};
