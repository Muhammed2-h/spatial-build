
import { 
  point, 
  distance as turfDistance, 
  centroid, 
  coordAll, 
  bearing as turfBearing, 
  booleanPointInPolygon 
} from '@turf/turf';
import { FeatureCollection, Feature, Point, Geometry, Position } from 'geojson';
import { AnalysisResult } from '../types';

// --- Helpers ---

// Normalize any angle to 0 <= angle < 360
const normalizeAngle = (angle: number): number => {
    const result = (angle % 360 + 360) % 360;
    return result === 360 ? 0 : result;
};

// Calculate shortest angular difference (0-180)
const calculateDeviation = (angle1: number, angle2: number): number => {
    let diff = Math.abs(angle1 - angle2);
    if (diff > 180) diff = 360 - diff;
    return diff;
};

// Check explicit properties for Azimuth using extended regex
const getExplicitAzimuth = (props: any): number | null => {
    if (!props) return null;
    const keys = Object.keys(props);
    // Regex matches: azimuth, bearing, heading, dir, direction, site_azimuth, orientation, etc.
    const key = keys.find(k => /^(site_?)?(azimuth|bearing|heading|dir(ection)?|orient(ation)?)$/i.test(k));
    if (key) {
        const val = parseFloat(props[key]);
        if (!isNaN(val)) return normalizeAngle(val);
    }
    return null;
};

// Interface for detailed sector metrics
interface SectorMetrics {
    azimuth: number;
    beamwidth: number;
    isOmni: boolean;
    startAngle: number;
    endAngle: number;
}

// Calculate Azimuth, Beamwidth, and Coverage Edges using Angular Gap Logic
const analyzeSectorGeometry = (geoFeature: Feature<any>, towerCenter: Feature<Point>): SectorMetrics => {
    // 1. Explicit Property Check (Highest Priority for Azimuth)
    const explicitAzimuth = getExplicitAzimuth(geoFeature.properties);
    
    // Default fallback values
    let azimuth = 0;
    let beamwidth = 360;
    let isOmni = true;
    let startAngle = 0;
    let endAngle = 360;

    // 2. Geometry Check: Point geometries are Omni
    if (!geoFeature.geometry || geoFeature.geometry.type === 'Point') {
        if (explicitAzimuth !== null) return { azimuth: explicitAzimuth, beamwidth: 65, isOmni: false, startAngle: normalizeAngle(explicitAzimuth - 32.5), endAngle: normalizeAngle(explicitAzimuth + 32.5) };
        return { azimuth: 0, beamwidth: 360, isOmni: true, startAngle: 0, endAngle: 360 };
    }

    const centerPoint = centroid(geoFeature);
    const distToCentroid = turfDistance(towerCenter, centerPoint, { units: 'meters' });

    // Omni/Small Cell check (centroid extremely close to tower center, e.g. < 2m)
    // This happens when a polygon is drawn effectively as a circle around the center
    if (distToCentroid < 2) {
         if (explicitAzimuth !== null) return { azimuth: explicitAzimuth, beamwidth: 65, isOmni: false, startAngle: normalizeAngle(explicitAzimuth - 32.5), endAngle: normalizeAngle(explicitAzimuth + 32.5) };
         return { azimuth: 0, beamwidth: 360, isOmni: true, startAngle: 0, endAngle: 360 };
    }

    // 3. Angular Gap Analysis
    // Determine bearings from Tower Center to ALL vertices of the polygon.
    // The "Sector" coverage is defined by the angular cluster of these vertices.
    // We find this by identifying the LARGEST angular gap between sorted vertices.
    
    const coords = coordAll(geoFeature);
    
    // Filter out coordinates that ARE the tower center (within tolerance) to isolate the "outer arc"
    const outerCoords = coords.filter(c => {
        const d = turfDistance(point(c), towerCenter, { units: 'meters' });
        return d > 2; // 2m tolerance
    });

    if (outerCoords.length === 0) {
        // Fallback: If collapsed, use centroid bearing
        azimuth = normalizeAngle(turfBearing(towerCenter, centerPoint));
        return { azimuth, beamwidth: 360, isOmni: true, startAngle: 0, endAngle: 360 };
    }

    // Calculate bearings to all outer vertices
    const bearings = outerCoords.map(c => normalizeAngle(turfBearing(towerCenter, point(c))));
    
    // Sort bearings numerically
    bearings.sort((a, b) => a - b);

    // Find the largest gap between adjacent bearings
    let maxGap = 0;
    let gapStart = 0;
    let gapEnd = 0;

    for (let i = 0; i < bearings.length; i++) {
        const current = bearings[i];
        const next = bearings[(i + 1) % bearings.length];
        
        // Calculate difference accounting for 360 wrap on the last element
        let diff = next - current;
        if (diff < 0) diff += 360;

        if (diff > maxGap) {
            maxGap = diff;
            gapStart = current;
            gapEnd = next;
        }
    }

    // The "Sector" is the complement of the Max Gap.
    // If the max gap is small (e.g. < 60 degrees), it implies vertices are distributed all around -> Omni
    if (maxGap < 60) {
         return { azimuth: 0, beamwidth: 360, isOmni: true, startAngle: 0, endAngle: 360 };
    }

    // Coverage Start/End is the inverse of the gap
    // The sector starts at gapEnd and goes to gapStart
    startAngle = gapEnd;
    endAngle = gapStart;
    
    beamwidth = 360 - maxGap;
    
    // Geometric Azimuth is the midpoint of the coverage sector
    // We handle the case where the sector crosses North (0 deg)
    // If Start=330, End=30 (Gap 60, Width 60). Midpoint calculation needs care.
    let geoAzimuth = normalizeAngle(startAngle + (beamwidth / 2));

    // If we have an explicit azimuth, prefer it, but use the geometric beamwidth
    azimuth = explicitAzimuth !== null ? explicitAzimuth : geoAzimuth;

    return {
        azimuth,
        beamwidth,
        isOmni: false,
        startAngle,
        endAngle
    };
};

export const performSpatialAnalysis = (
  searchLat: number,
  searchLng: number,
  geoData: FeatureCollection<Geometry>,
  rank: number = 1
): AnalysisResult => {
  const targetPoint = point([searchLng, searchLat]);
  
  if (!geoData.features || geoData.features.length === 0) {
     throw new Error("No features found in dataset to analyze.");
  }

  // OPTIMIZATION: Quick Bounding Box Filter
  // Avoid heavy turf.distance for far away objects.
  // ~0.5 degrees is roughly 55km. If nothing found in 55km, it's likely outside reliable range anyway.
  const LAT_THRESHOLD = 0.5;
  const LNG_THRESHOLD = 0.5 / Math.max(0.1, Math.cos(searchLat * Math.PI / 180)); // Simple longitude adjustment

  const minLat = searchLat - LAT_THRESHOLD;
  const maxLat = searchLat + LAT_THRESHOLD;
  const minLng = searchLng - LNG_THRESHOLD;
  const maxLng = searchLng + LNG_THRESHOLD;

  // Optimized Filter using simple coordinate comparisons
  const candidates = geoData.features.filter(f => {
      let lat, lng;
      // Fast path: Use pre-calculated centers from fileService
      if (f.properties && f.properties._center) {
          [lng, lat] = f.properties._center;
      } else {
          // Slow path fallback: Centroid calculation
          try {
             const centr = centroid(f);
             [lng, lat] = centr.geometry.coordinates;
          } catch(e) { return false; }
      }
      return lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;
  });

  // If filter killed everything (user is very far away), fall back to all features 
  // to ensure "nearest" works even if 1000km away, though it will be slow.
  const featuresToAnalyze = candidates.length > 0 ? candidates : geoData.features;

  // --- 1. GROUPING (Clustering) ---
  // Group features into "Sites" based on proximity.
  
  interface SiteGroup {
      id: string;
      referencePoint: Feature<Point>;
      distance: number;
      candidates: Feature<Geometry>[];
  }
  
  const siteGroups = new Map<string, SiteGroup>();

  featuresToAnalyze.forEach((f) => {
    let centerCoords: Position;

    if (f.properties && f.properties._center) {
        centerCoords = f.properties._center;
    } else {
        const allCoords = coordAll(f);
        if (allCoords.length > 0) {
            centerCoords = allCoords[0];
        } else {
            const centr = centroid(f);
            centerCoords = centr.geometry.coordinates;
        }
    }

    // Creating keys by rounding lat/lng is a simple clustering method
    const latKey = centerCoords[1].toFixed(4);
    const lngKey = centerCoords[0].toFixed(4);
    const key = `${latKey},${lngKey}`;

    if (!siteGroups.has(key)) {
        const refPoint = point(centerCoords);
        const dist = turfDistance(targetPoint, refPoint); // km
        
        siteGroups.set(key, {
            id: key,
            referencePoint: refPoint,
            distance: dist,
            candidates: []
        });
    }
    
    siteGroups.get(key)!.candidates.push(f);
  });

  // --- 2. RANKING SITES ---
  const sites = Array.from(siteGroups.values());
  sites.sort((a, b) => a.distance - b.distance);

  const totalSites = sites.length;
  const safeRank = Math.max(1, Math.min(rank, totalSites));
  const selectedSite = sites[safeRank - 1];

  if (!selectedSite) {
      throw new Error("No suitable site found.");
  }

  // --- 3. SECTOR SELECTION (Best Facing Logic) ---
  
  // Angle: Tower -> User
  const bearingTowerToUser = normalizeAngle(turfBearing(selectedSite.referencePoint, targetPoint));

  // Check if User is in Near Field (< 30m)
  // In near field, azimuth is less relevant due to tower size/GPS error. Proximity governs.
  const isNearField = selectedSite.distance * 1000 < 30; 

  const evaluatedCandidates = selectedSite.candidates.map(f => {
      // A. Geometric Analysis
      const { azimuth, beamwidth, isOmni, startAngle, endAngle } = analyzeSectorGeometry(f, selectedSite.referencePoint);
      
      // B. Deviation from Boresight (Primary Direction)
      // Deviation measures how far off-axis the user is from the center of the sector.
      // 0 = Dead center (Best). 180 = Directly behind (Worst).
      let deviation = calculateDeviation(azimuth, bearingTowerToUser);
      
      if (isOmni || isNearField) {
          deviation = 0; 
      }

      // C. Spatial Containment (Polygon Inside Check)
      let isInside = false;
      try {
          if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
              isInside = booleanPointInPolygon(targetPoint, f as any);
          }
      } catch (e) { /* ignore invalid geometry */ }

      // D. "In Beam" Check (Angular Containment)
      // Checks if the user is strictly within the angular wedge defined by start/end angles.
      let isInBeam = false;
      if (!isOmni && !isNearField) {
          // Half-width check is mathematically equivalent to checking start/end but cleaner
          // e.g. Azimuth 90, Beam 60 -> User must be 60-120. Deviation must be <= 30.
          if (deviation <= (beamwidth / 2)) {
              isInBeam = true;
          }
      } else {
          isInBeam = true; // Omni/NearField always "in beam"
      }

      // E. Weighted Scoring Algorithm (Lower is Better)
      
      // Base Score starts as the angular deviation (0 to 180)
      // A feature directly facing the user (deviation 0) starts with the best possible score.
      let score = deviation; 

      // TIER 1: Physical Containment
      // If the point is geometrically inside the polygon, this is the strongest signal.
      if (isInside) {
          score -= 10000; 
      } 
      // TIER 2: Near Field Proximity
      // If we are extremely close to the site, geometric angles are unreliable.
      // We rely on the base grouping, treating all sectors as viable, but prioritizing explicit azimuths slightly below.
      else if (isNearField) {
          score -= 5000;
      } 
      // TIER 3: Angular Containment (Main Beam)
      // If we are within the defined beamwidth (e.g., +/- 33 deg for a 65 deg sector).
      else if (isInBeam) {
          score -= 2000;  
      }
      
      // Penalty: Back Lobe / Side Lobe
      // If we are outside the beam, the score remains high (positive deviation).
      // e.g. User is at 180 deg deviation (back of sector). Score = 180.
      
      // Secondary Tie-Breaker: Prefer explicitly defined azimuths slightly
      // This helps disambiguate if geometry is messy but data attributes are clean.
      if (getExplicitAzimuth(f.properties) !== null) {
          score -= 10;
      }

      return {
          feature: f,
          azimuth,
          beamwidth,
          deviation,
          isInside,
          score
      };
  });

  // Sort candidates by Score ASC
  // Best score (lowest) wins.
  // Priority: Inside > NearField > InBeam (Low Deviation) > InBeam (High Deviation) > Outside Beam
  evaluatedCandidates.sort((a, b) => a.score - b.score);

  const bestMatch = evaluatedCandidates[0];

  // --- 4. RESULT CONSTRUCTION ---
  
  // Bearing User -> Tower (Standard Output Format)
  const bearingUserToTower = normalizeAngle(turfBearing(targetPoint, selectedSite.referencePoint));

  const result: AnalysisResult = {
      nearestFeature: bestMatch.feature,
      distance: selectedSite.distance,
      bearing: bearingUserToTower, 
      
      sectorAzimuth: bestMatch.azimuth,
      sectorBeamwidth: bestMatch.beamwidth,
      deviationAngle: bestMatch.deviation,
      isInside: bestMatch.isInside,
      
      searchPoint: { lat: searchLat, lng: searchLng },
      nearestPoint: { 
          lat: selectedSite.referencePoint.geometry.coordinates[1], 
          lng: selectedSite.referencePoint.geometry.coordinates[0] 
      },
      
      rank: safeRank,
      totalFeatures: totalSites,
      
      sourceId: bestMatch.feature.properties?._sourceId || 'unknown',
      sourceName: bestMatch.feature.properties?._sourceName || 'unknown',
      
      timestamp: Date.now()
  };

  return result;
};

export const parseCoordinateString = (input: string): { lat: number, lng: number } | null => {
    // Matches: "12.34, 56.78" or "12.34 56.78"
    const regex = /^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/;
    const match = input.trim().match(regex);
    
    if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[3]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            return { lat, lng };
        }
    }
    return null;
};
