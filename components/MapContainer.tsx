import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { MapContainer as LeafletMap, TileLayer, GeoJSON, CircleMarker, Polyline, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { bbox } from '@turf/turf';
import { AnalysisResult, DataSource } from '../types';
import { FeatureCollection, Geometry, Feature } from 'geojson';
import { 
  DEFAULT_CENTER, 
  DEFAULT_ZOOM, 
  DATA_LAYER_STYLE, 
  HIGHLIGHT_STYLE, 
  SEARCH_MARKER_STYLE, 
  POLYGON_STYLE, 
  POLYGON_HIGHLIGHT_STYLE,
  CLICKED_POLYGON_STYLE
} from '../constants';

// Fix for default Leaflet marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Optimized Arrow Icon Creation
const createArrowIcon = (bearing: number) => L.divIcon({
    className: '!bg-transparent !border-none',
    html: `<div style="transform: rotate(${bearing}deg); width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V3"/><path d="M5 10L12 3L19 10"/></svg></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
});

// --- Types ---
interface MapContainerProps {
  dataSources: DataSource[];
  analysisResults: AnalysisResult[];
  focusedResult: AnalysisResult | null;
  previewPoint: { lat: number; lng: number } | null;
  onLongPress: (lat: number, lng: number) => void;
  theme: 'light' | 'dark';
}

// --- Map Controllers ---

const MapBoundsController = React.memo(({ dataSources }: { dataSources: DataSource[] }) => {
  const map = useMap();
  useEffect(() => {
    // Calculate bounds only on data change
    const activeFeatures = dataSources.filter(d => d.isActive).flatMap(d => d.data.features);
    if (activeFeatures.length > 0) {
      try {
          // Turf bbox is fast O(N)
          const [minX, minY, maxX, maxY] = bbox({ type: 'FeatureCollection', features: activeFeatures as any });
          if (minX !== Infinity && minY !== Infinity) {
              map.fitBounds([[minY, minX], [maxY, maxX]], { padding: [50, 50], maxZoom: 14, animate: true, duration: 1 });
          }
      } catch (e) { console.warn("Bounds calc error", e); }
    }
  }, [dataSources, map]);
  return null;
});

const ZoomController = React.memo(({ focusedResult }: { focusedResult: AnalysisResult | null }) => {
    const map = useMap();
    useEffect(() => {
        if (focusedResult?.searchPoint) {
            const latlng = L.latLng(focusedResult.searchPoint.lat, focusedResult.searchPoint.lng);
            if (focusedResult.nearestFeature) {
                try {
                    const [minX, minY, maxX, maxY] = bbox({ type: 'FeatureCollection', features: [focusedResult.nearestFeature] });
                    map.flyToBounds(L.latLngBounds([[minY, minX], [maxY, maxX]]).extend(latlng), { padding: [100, 100], maxZoom: 16, duration: 0.5 });
                } catch { map.flyTo(latlng, 15, { duration: 0.5 }); }
            } else {
                map.flyTo(latlng, 15, { duration: 0.5 });
            }
        }
    }, [focusedResult, map]);
    return null;
});

const PreviewController = React.memo(({ point }: { point?: { lat: number, lng: number } | null }) => {
    const map = useMap();
    useEffect(() => {
        if (point) map.flyTo([point.lat, point.lng], 15, { duration: 0.5 });
    }, [point, map]);
    return null;
});

const LongPressHandler = React.memo(({ onLongPress }: { onLongPress: (lat: number, lng: number) => void }) => {
    // Use Leaflet's native 'contextmenu' event.
    // This is triggered by:
    // 1. Right-click on Desktop
    // 2. Long-press on Touch Devices (iOS/Android)
    // This provides the most native and reliable feel for "Long Press" interactions.
    useMapEvents({
        contextmenu(e) {
            onLongPress(e.latlng.lat, e.latlng.lng);
            
            // Haptic feedback (if supported) to confirm the action
            if (typeof navigator.vibrate === 'function') {
                navigator.vibrate(50);
            }
        },
    });
    return null;
});

// --- Highly Optimized Data Layer ---
// Implements Viewport Culling & Level of Detail (LOD) switching
const OptimizedDataLayer = React.memo(({ source, onFeatureClick }: { source: DataSource; onFeatureClick: (f: Feature<Geometry, any>) => void }) => {
    const map = useMap();
    const layerRef = useRef<L.GeoJSON | null>(null);
    const updateTimeout = useRef<any>(null);

    // Style factory
    const getStyle = useCallback(() => ({
        ...POLYGON_STYLE,
        fillOpacity: source.opacity ?? 0.5,
        opacity: (source.opacity ?? 0.5) + 0.2,
        // Disable strokes at low zoom to save CPU
        stroke: map.getZoom() > 10,
        smoothFactor: 2.0 // Aggressive simplification
    } as L.PathOptions), [source.opacity, map]);

    const updateVisibleFeatures = useCallback(() => {
        if (!layerRef.current || !source.isActive) return;

        const zoom = map.getZoom();
        const bounds = map.getBounds().pad(0.5); // 50% buffer to prevent pop-in
        const isLowZoom = zoom < 11; // LOD Threshold

        // 1. Viewport Filter: Only render what is visible
        const visibleFeatures = source.data.features.filter(f => {
            // Using the pre-calculated center from fileService is extremely fast
            const center = f.properties?._center;
            if (center) {
                // Check if point is roughly within bounds
                return bounds.contains(L.latLng(center[1], center[0]));
            }
            // Fallback for features without centers (rare)
            return true;
        });

        layerRef.current.clearLayers();

        // 2. LOD Switching
        if (isLowZoom) {
            // Low Zoom: Render centroids as dots. 
            // Parsing 10k polygons is slow; parsing 10k points is fast.
            const points = visibleFeatures.map(f => ({
                type: 'Feature',
                id: f.id,
                properties: f.properties,
                geometry: {
                    type: 'Point',
                    coordinates: f.properties?._center || [0, 0]
                }
            }));
            layerRef.current.addData(points as any);
        } else {
            // High Zoom: Render full geometry
            layerRef.current.addData(visibleFeatures as any);
        }
    }, [map, source]);

    // Debounced updater for map interactions
    const onMapMove = useCallback(() => {
        if (updateTimeout.current) clearTimeout(updateTimeout.current);
        updateTimeout.current = setTimeout(updateVisibleFeatures, 200); // 200ms debounce
    }, [updateVisibleFeatures]);

    // Initialization & Event Binding
    useEffect(() => {
        if (!layerRef.current) {
            const l = L.geoJSON(null, {
                style: getStyle,
                pointToLayer: (_feature, latlng) => {
                    // Dynamic marker size based on zoom
                    const r = map.getZoom() < 11 ? 4 : 6;
                    return L.circleMarker(latlng, { ...DATA_LAYER_STYLE, radius: r });
                },
                onEachFeature: (f) => { if (f.properties) f.properties._sourceId = source.id; },
                markersInheritOptions: true,
                interactive: true,
                bubblingMouseEvents: false
            });

            // Single event listener for all features in this layer
            l.on('click', (e: any) => {
                L.DomEvent.stopPropagation(e);
                if (e.layer?.feature) onFeatureClick(e.layer.feature);
            });

            layerRef.current = l;
            l.addTo(map);
        }

        // Initial render
        updateVisibleFeatures();

        // Bind map events
        map.on('moveend zoomend', onMapMove);

        return () => {
            map.off('moveend zoomend', onMapMove);
            if (layerRef.current) {
                layerRef.current.remove();
                layerRef.current = null;
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); 

    // Handle prop updates
    useEffect(() => {
        updateVisibleFeatures();
    }, [source.data, source.isActive, updateVisibleFeatures]);

    useEffect(() => {
        layerRef.current?.setStyle(getStyle());
    }, [source.opacity, getStyle]);

    return null;
});

const MapClickHandler = React.memo(({ onClick }: { onClick: () => void }) => {
    useMapEvents({ click: onClick });
    return null;
});

const MapContainer: React.FC<MapContainerProps> = ({ dataSources, analysisResults, focusedResult, previewPoint, onLongPress, theme }) => {
  const [activeFeature, setActiveFeature] = useState<Feature<Geometry, any> | null>(null);

  useEffect(() => {
    if (focusedResult?.nearestFeature) {
        setActiveFeature(focusedResult.nearestFeature);
    } else {
        // Only clear if explicitly null passed (e.g. clear button), 
        // but preserve selection if focusedResult is just undefined during transitions if needed.
        // For now, syncing strict to focusedResult usually makes sense for navigation.
        if (focusedResult === null) setActiveFeature(null);
    }
  }, [focusedResult]);

  const popupStyles = useMemo(() => {
      const isDark = theme === 'dark';
      return {
          container: isDark ? "bg-slate-900/40 border-white/10" : "bg-white/40 border-white/30",
          text: isDark ? "text-slate-200" : "text-slate-800",
          label: isDark ? "text-slate-400" : "text-slate-500",
          row: isDark ? "hover:bg-white/5" : "hover:bg-blue-50/30"
      };
  }, [theme]);

  // Derived Data
  const analysisLayer = useMemo(() => ({ 
      type: "FeatureCollection", 
      features: analysisResults.map(r => r.nearestFeature).filter(Boolean) 
  } as FeatureCollection), [analysisResults]);

  const selectedLayer = useMemo(() => activeFeature ? { 
      type: "FeatureCollection", features: [activeFeature] 
  } as FeatureCollection : null, [activeFeature]);

  // Unique Key to force re-render of analysis highlight when results change
  const analysisKey = analysisResults.map(r => r.sourceId).join(',');

  const currentVisibleAttributes = useMemo(() => {
      if (!activeFeature?.properties?._sourceId) return [];
      return dataSources.find(ds => ds.id === activeFeature!.properties!._sourceId)?.visibleAttributes || [];
  }, [activeFeature, dataSources]);

  return (
    <div className="relative w-full h-full bg-slate-100">
      <LeafletMap center={[DEFAULT_CENTER.lat, DEFAULT_CENTER.lng]} zoom={DEFAULT_ZOOM} style={{ width: '100%', height: '100%' }} zoomControl={false} preferCanvas={true}>
        <MapClickHandler onClick={() => setActiveFeature(null)} />
        <LongPressHandler onLongPress={onLongPress} />
        
        <TileLayer 
            url={theme === 'light' ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"}
            attribution='&copy; CARTO'
        />
       
        <MapBoundsController dataSources={dataSources} />
        <ZoomController focusedResult={focusedResult} />
        <PreviewController point={previewPoint} />

        {dataSources.map(ds => ds.isActive && <OptimizedDataLayer key={ds.id} source={ds} onFeatureClick={setActiveFeature} />)}

        {analysisLayer.features.length > 0 && <GeoJSON key={analysisKey} data={analysisLayer} style={POLYGON_HIGHLIGHT_STYLE} pointToLayer={(_, ll) => L.circleMarker(ll, HIGHLIGHT_STYLE)} interactive={false} />}
        
        {selectedLayer && <GeoJSON key={activeFeature?.properties?._id || 'selected'} data={selectedLayer} style={CLICKED_POLYGON_STYLE} pointToLayer={(_, ll) => L.circleMarker(ll, {...HIGHLIGHT_STYLE, fillColor: '#F59E0B'})} interactive={false} />}

        {previewPoint && <CircleMarker center={[previewPoint.lat, previewPoint.lng]} {...{...SEARCH_MARKER_STYLE, fillColor: '#60A5FA'}} />}

        {analysisResults.map((res, i) => res.searchPoint && (
            <React.Fragment key={`res-${i}`}>
                <CircleMarker center={[res.searchPoint.lat, res.searchPoint.lng]} {...SEARCH_MARKER_STYLE} />
                {res.bearing !== null && res.nearestPoint && (
                    <Marker 
                        position={[(res.searchPoint.lat + res.nearestPoint.lat)/2, (res.searchPoint.lng + res.nearestPoint.lng)/2]} 
                        icon={createArrowIcon(res.bearing)} 
                        interactive={false} 
                    />
                )}
                {res.nearestPoint && <Polyline positions={[[res.searchPoint.lat, res.searchPoint.lng], [res.nearestPoint.lat, res.nearestPoint.lng]]} pathOptions={{ color: '#EF4444', dashArray: '6, 8', weight: 2 }} />}
            </React.Fragment>
        ))}
      </LeafletMap>

      {/* Optimized Popup */}
      {activeFeature?.properties && (
        <div className={`absolute bottom-6 right-6 z-[1000] w-80 rounded-2xl backdrop-blur-xl border shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-4 ${popupStyles.container}`}>
            <div className="flex justify-between items-center px-4 py-3 border-b border-white/10 bg-white/5">
                <span className={`font-bold text-sm ${popupStyles.text}`}>Details</span>
                <button onClick={() => setActiveFeature(null)} className="text-slate-400 hover:text-red-400">✕</button>
            </div>
            <div className="max-h-80 overflow-y-auto custom-scrollbar">
                <table className="w-full text-left text-xs">
                    <tbody className="divide-y divide-white/5">
                        {Object.entries(activeFeature.properties).map(([k, v]) => {
                            if (!currentVisibleAttributes.includes(k) || typeof v === 'object') return null;
                            return (
                                <tr key={k} className={popupStyles.row}>
                                    <td className={`py-2 px-4 font-bold ${popupStyles.label} w-1/3`}>{k}</td>
                                    <td className={`py-2 px-4 font-mono ${popupStyles.text}`}>{String(v)}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                {Object.keys(activeFeature.properties).filter(k => currentVisibleAttributes.includes(k)).length === 0 && (
                    <div className="p-6 text-center text-slate-500 italic text-xs">No visible attributes configured.</div>
                )}
            </div>
        </div>
      )}
    </div>
  );
};

export default MapContainer;