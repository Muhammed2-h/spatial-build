
import React, { useState, useEffect, useCallback } from 'react';
import MapContainer from './components/MapContainer';
import ControlPanel from './components/ControlPanel';
import LoadingOverlay from './components/LoadingOverlay';
import ErrorBoundary from './components/ErrorBoundary';
import { parseGeoFile } from './services/fileService';
import { performSpatialAnalysis, parseCoordinateString } from './services/spatialService';
import { resolveLocationWithGemini } from './services/geminiService';
import { saveSession, loadSession } from './services/storageService';
import { GeoState, AnalysisResult, DataSource, ProcessingFile } from './types';
import { Feature, Geometry } from 'geojson';

// Limit initial render to prevent browser freeze with large datasets (e.g. 1 Lak features)
const MAX_RENDER_LIMIT = 50000;
const LOAD_MORE_BATCH = 10000;

const App: React.FC = () => {
  const [geoState, setGeoState] = useState<GeoState>({
    dataSources: [],
    isLoading: true, // Start loading to check for persisted data
    error: null,
  });

  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);
  const [analysisResults, setAnalysisResults] = useState<AnalysisResult[]>([]);
  const [focusedResult, setFocusedResult] = useState<AnalysisResult | null>(null);
  const [previewPoint, setPreviewPoint] = useState<{lat: number, lng: number} | null>(null);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  
  // State to hold coordinates from map long-press (Object with timestamp to force updates)
  const [externalQuery, setExternalQuery] = useState<{ value: string; timestamp: number } | null>(null);

  // Load persisted session on mount
  useEffect(() => {
      const restoreSession = async () => {
          try {
              // Restore Theme
              const savedTheme = localStorage.getItem('geoAnalyzerTheme');
              if (savedTheme === 'dark' || savedTheme === 'light') {
                  setTheme(savedTheme);
              }

              const savedData = await loadSession();
              if (savedData && savedData.length > 0) {
                  // Sanitize data to ensure pendingFeatures exists (migration safety)
                  const sanitizedData = savedData.map(ds => ({
                      ...ds,
                      opacity: ds.opacity ?? 0.5, // Default opacity if missing
                      pendingFeatures: Array.isArray(ds.pendingFeatures) ? ds.pendingFeatures : []
                  }));

                  setGeoState(prev => ({
                      ...prev,
                      dataSources: sanitizedData,
                      isLoading: false
                  }));
              } else {
                  setGeoState(prev => ({ ...prev, isLoading: false }));
              }
          } catch (e) {
              console.error("Session restore error", e);
              setGeoState(prev => ({ ...prev, isLoading: false }));
          } finally {
              setIsRestoring(false);
          }
      };
      restoreSession();
  }, []);

  // Auto-save session when dataSources change (Debounced)
  useEffect(() => {
      if (isRestoring) return; // Don't save while restoring

      const timer = setTimeout(() => {
          saveSession(geoState.dataSources);
      }, 2000); // 2s debounce to avoid thrashing IDB on rapid toggles

      return () => clearTimeout(timer);
  }, [geoState.dataSources, isRestoring]);

  const handleToggleTheme = () => {
      const newTheme = theme === 'light' ? 'dark' : 'light';
      setTheme(newTheme);
      localStorage.setItem('geoAnalyzerTheme', newTheme);
  };

  const handleFileUpload = async (files: File[]) => {
    setSearchError(null);
    
    // Create placeholders for processing files
    const newProcessItems: ProcessingFile[] = files.map(f => ({
        id: Math.random().toString(36).substring(2, 9),
        name: f.name,
        progress: 0
    }));

    setProcessingFiles(prev => [...prev, ...newProcessItems]);

    // Process each file individually to update progress
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const procItem = newProcessItems[i];
        
        // Start progress simulation
        let progress = 0;
        const progressInterval = setInterval(() => {
            setProcessingFiles(current => current.map(item => {
                if (item.id === procItem.id && item.progress < 90) {
                    // Slow down as we get higher
                    const inc = Math.max(1, (90 - item.progress) / 10);
                    return { ...item, progress: item.progress + inc };
                }
                return item;
            }));
        }, 200);

        try {
            // Actual Heavy Lifting
            const geoData = await parseGeoFile(file);
            
            clearInterval(progressInterval);
            
            // Set 100%
            setProcessingFiles(current => current.map(item => 
                item.id === procItem.id ? { ...item, progress: 100 } : item
            ));

            // Short delay to let user see 100%
            await new Promise(r => setTimeout(r, 600));

            // Implement Chunking / Caching
            let initialFeatures = geoData.features;
            let pendingFeatures: Feature<Geometry>[] = [];

            if (geoData.features.length > MAX_RENDER_LIMIT) {
                initialFeatures = geoData.features.slice(0, MAX_RENDER_LIMIT);
                pendingFeatures = geoData.features.slice(MAX_RENDER_LIMIT);
            }

            const activeData: any = { ...geoData, features: initialFeatures };
            const newSource: DataSource = {
                id: procItem.id, // Reuse ID
                name: file.name,
                data: activeData,
                isActive: true,
                opacity: 0.5, // Default opacity
                visibleAttributes: [], 
                customResultField: null,
                pendingFeatures: pendingFeatures
            };

            setGeoState(prev => ({
                ...prev,
                dataSources: [...prev.dataSources, newSource]
            }));

        } catch (e: any) {
            clearInterval(progressInterval);
            console.error(e);
            setGeoState(prev => ({ ...prev, error: `Error loading ${file.name}: ${e.message}` }));
        } finally {
            // Remove from processing list
            setProcessingFiles(current => current.filter(item => item.id !== procItem.id));
        }
    }
  };

  const handleLoadMore = (sourceId: string) => {
      setGeoState(prev => ({
          ...prev,
          dataSources: prev.dataSources.map(ds => {
              if (ds.id === sourceId && ds.pendingFeatures.length > 0) {
                  const nextBatch = ds.pendingFeatures.slice(0, LOAD_MORE_BATCH);
                  const remaining = ds.pendingFeatures.slice(LOAD_MORE_BATCH);
                  return {
                      ...ds,
                      data: { ...ds.data, features: [...ds.data.features, ...nextBatch] },
                      pendingFeatures: remaining
                  };
              }
              return ds;
          })
      }));
  };

  const handleClearAllFiles = () => {
    setGeoState({
      dataSources: [],
      isLoading: false,
      error: null,
    });
    setAnalysisResults([]);
    setSearchError(null);
    setFocusedResult(null);
    setPreviewPoint(null);
  };

  const handleToggleSource = (id: string) => {
      setGeoState(prev => ({
          ...prev,
          dataSources: prev.dataSources.map(ds => 
              ds.id === id ? { ...ds, isActive: !ds.isActive } : ds
          )
      }));
  };

  const handleDeleteSource = (id: string) => {
      setGeoState(prev => ({
          ...prev,
          dataSources: prev.dataSources.filter(ds => ds.id !== id)
      }));
      setAnalysisResults(prev => prev.filter(r => r.sourceId !== id));
  };

  const handleUpdateSourceSettings = (id: string, updates: Partial<DataSource>) => {
    setGeoState(prev => ({
        ...prev,
        dataSources: prev.dataSources.map(ds => 
            ds.id === id ? { ...ds, ...updates } : ds
        )
    }));
  };

  const handleClearError = () => {
    setGeoState(prev => ({ ...prev, error: null }));
    setSearchError(null);
  };

  const handlePreviewLocation = (lat: number, lng: number) => {
      setPreviewPoint({ lat, lng });
  };

  const handleMapLongPress = useCallback((lat: number, lng: number) => {
      const query = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      setExternalQuery({ value: query, timestamp: Date.now() });
      setPreviewPoint({ lat, lng }); // Show the point immediately on map
  }, []);

  const handleSearch = async (query: string) => {
    setIsSearching(true);
    setSearchError(null);
    setPreviewPoint(null);
    
    // Reset external query if user manually searches with a different query
    if (externalQuery && query !== externalQuery.value) {
        setExternalQuery(null);
    }

    try {
      // 1. Try standard parser (via regex)
      let coords = parseCoordinateString(query);

      // 2. Fallback: Simple split parsing to ensure robustness for "Use Current Location" input
      // This handles "Lat, Lng" format even if the strict regex in spatialService fails
      if (!coords && query.includes(',')) {
        const parts = query.split(',').map(s => s.trim());
        if (parts.length === 2) {
            const lat = parseFloat(parts[0]);
            const lng = parseFloat(parts[1]);
            if (!isNaN(lat) && !isNaN(lng)) {
                coords = { lat, lng };
            }
        }
      }

      if (!coords) {
         try {
             coords = await resolveLocationWithGemini(query);
         } catch (e: any) {
             setSearchError(e.message || "Location resolution failed.");
             setIsSearching(false);
             return;
         }
      }

      if (!coords) {
        throw new Error("Could not determine location. Please check the spelling or enter coordinates (Lat, Lng).");
      }

      const activeSources = geoState.dataSources.filter(ds => ds.isActive);
      
      if (activeSources.length === 0) {
          setPreviewPoint({ lat: coords.lat, lng: coords.lng });
          setIsSearching(false);
          return;
      }

      const newResults: AnalysisResult[] = [];
      
      activeSources.forEach(ds => {
          try {
              const fullFeatures = ds.pendingFeatures 
                ? [...ds.data.features, ...ds.pendingFeatures] 
                : ds.data.features;

              const tempAnalysisData: any = {
                  type: 'FeatureCollection',
                  features: fullFeatures
              };

              const result = performSpatialAnalysis(coords!.lat, coords!.lng, tempAnalysisData, 1);
              result.sourceId = ds.id;
              result.sourceName = ds.name;
              newResults.push(result);
          } catch (e) {
              console.warn(`Analysis failed for source ${ds.name}`, e);
          }
      });

      if (newResults.length === 0) {
          setPreviewPoint({ lat: coords.lat, lng: coords.lng });
          setIsSearching(false);
          return;
      }

      newResults.sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));

      setAnalysisResults(prev => [...newResults, ...prev]);
      
      if (newResults.length > 0) {
          setFocusedResult(newResults[0]);
      }

    } catch (err: any) {
      setSearchError(err.message || "An error occurred during search.");
    } finally {
      setIsSearching(false);
    }
  };

  const handleFindNext = (resultIndex: number) => {
    const current = analysisResults[resultIndex];
    if (!current || !current.searchPoint) return;

    const source = geoState.dataSources.find(ds => ds.id === current.sourceId);
    if (!source) return;

    const nextRank = current.rank + 1;
    if (nextRank > current.totalFeatures) return;

    try {
        const fullFeatures = source.pendingFeatures 
            ? [...source.data.features, ...source.pendingFeatures] 
            : source.data.features;

        const tempAnalysisData: any = {
            type: 'FeatureCollection',
            features: fullFeatures
        };

        const newResult = performSpatialAnalysis(
            current.searchPoint.lat,
            current.searchPoint.lng,
            tempAnalysisData, 
            nextRank
        );
        newResult.sourceId = source.id;
        newResult.sourceName = source.name;

        setAnalysisResults(prev => {
            const newResults = [...prev];
            newResults[resultIndex] = newResult;
            return newResults;
        });
        setFocusedResult(newResult); 
    } catch (e) {
        console.error("Could not find next nearest", e);
    }
  };

  const handleFindPrevious = (resultIndex: number) => {
    const current = analysisResults[resultIndex];
    if (!current || !current.searchPoint) return;

    const source = geoState.dataSources.find(ds => ds.id === current.sourceId);
    if (!source) return;

    const prevRank = current.rank - 1;
    if (prevRank < 1) return;

    try {
        const fullFeatures = source.pendingFeatures 
            ? [...source.data.features, ...source.pendingFeatures] 
            : source.data.features;

        const tempAnalysisData: any = {
            type: 'FeatureCollection',
            features: fullFeatures
        };

        const newResult = performSpatialAnalysis(
            current.searchPoint.lat,
            current.searchPoint.lng,
            tempAnalysisData, 
            prevRank
        );
        newResult.sourceId = source.id;
        newResult.sourceName = source.name;

        setAnalysisResults(prev => {
            const newResults = [...prev];
            newResults[resultIndex] = newResult;
            return newResults;
        });
        setFocusedResult(newResult); 
    } catch (e) {
        console.error("Could not find previous nearest", e);
    }
  };

  const handleZoomToResult = (index: number) => {
    const result = analysisResults[index];
    if (result) {
      setFocusedResult({ ...result });
    }
  };

  const handleRemoveResult = (index: number) => {
    setAnalysisResults(prev => prev.filter((_, i) => i !== index));
  };

  const handleClearAnalysis = () => {
    setAnalysisResults([]);
    setSearchError(null);
    setFocusedResult(null);
  };

  // Only show global loading for Search or Initial Restore
  const isGlobalLoading = (geoState.isLoading || isSearching) && processingFiles.length === 0;
  const loadingMessage = geoState.isLoading 
      ? (isRestoring ? "Restoring Session..." : "Initializing...") 
      : "Analyzing Location...";

  return (
    <ErrorBoundary>
        <div className="relative w-full h-full overflow-hidden">
        <LoadingOverlay isVisible={isGlobalLoading} message={loadingMessage} />
        
        <ControlPanel
            onFileUpload={handleFileUpload}
            onClearFile={handleClearAllFiles}
            onClearError={handleClearError}
            onSearch={handleSearch}
            onFindNext={handleFindNext}
            onFindPrevious={handleFindPrevious}
            onZoom={handleZoomToResult}
            onClear={handleClearAnalysis}
            onRemoveResult={handleRemoveResult}
            onPreviewLocation={handlePreviewLocation}
            
            dataSources={geoState.dataSources}
            processingFiles={processingFiles} 
            onToggleSource={handleToggleSource}
            onDeleteSource={handleDeleteSource}
            onUpdateSourceSettings={handleUpdateSourceSettings}
            onLoadMore={handleLoadMore}

            isLoading={geoState.isLoading}
            isSearching={isSearching}
            error={geoState.error || searchError}
            analysisResults={analysisResults}
            
            externalQuery={externalQuery} // Pass external query from map long-press

            theme={theme}
            onToggleTheme={handleToggleTheme}
        />
        <MapContainer 
            dataSources={geoState.dataSources}
            analysisResults={analysisResults} 
            focusedResult={focusedResult}
            previewPoint={previewPoint}
            onLongPress={handleMapLongPress} // Pass long-press handler
            theme={theme}
        />
        </div>
    </ErrorBoundary>
  );
};

export default App;
