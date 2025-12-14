
import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { AnalysisResult, DataSource, ProcessingFile } from '../types';

interface ControlPanelProps {
  onFileUpload: (files: File[]) => void;
  onClearFile: () => void;
  onClearError: () => void;
  onSearch: (query: string) => void;
  onFindNext: (index: number) => void;
  onFindPrevious: (index: number) => void;
  onZoom: (index: number) => void;
  onClear: () => void;
  onRemoveResult: (index: number) => void;
  onPreviewLocation: (lat: number, lng: number) => void;
  
  dataSources: DataSource[];
  processingFiles?: ProcessingFile[];
  onToggleSource: (id: string) => void;
  onDeleteSource: (id: string) => void;
  onUpdateSourceSettings: (id: string, updates: Partial<DataSource>) => void;
  onLoadMore: (id: string) => void;

  isLoading: boolean;
  isSearching: boolean;
  error: string | null;
  analysisResults: AnalysisResult[];
  
  externalQuery?: { value: string; timestamp: number } | null;

  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

type ViewState = 'expanded' | 'minimized' | 'closed';

// --- Liquid Animation Styles ---
const LIQUID_STYLES = `
.liquid-container {
  background-color: rgba(191, 219, 254, 0.4); /* Mild Blue (blue-200) with opacity */
  box-shadow: inset 0 2px 4px rgba(0,0,0,0.08);
  border-radius: 12px;
}

.liquid-fill {
  background-color: rgba(255, 255, 255, 0.9); /* White Fluid */
  box-shadow: 2px 0 8px rgba(255, 255, 255, 0.5);
  position: relative;
  overflow: hidden;
  height: 100%;
  border-radius: 12px 0 0 12px;
  transition: width 0.3s ease-out;
}

.liquid-fill[style*="100%"] {
  border-radius: 12px;
}
`;

// --- Utility Functions ---

const getIPAddress = async (): Promise<{ v4: string | null; v6: string | null }> => {
    try {
        const [v4Res, v6Res] = await Promise.allSettled([
            fetch('https://api.ipify.org?format=json'),
            fetch('https://api64.ipify.org?format=json')
        ]);
        
        let v4 = null;
        let v6 = null;

        if (v4Res.status === 'fulfilled') {
            const data = await v4Res.value.json();
            v4 = data.ip;
        }
        if (v6Res.status === 'fulfilled') {
            const data = await v6Res.value.json();
            v6 = data.ip;
        }
        return { v4, v6 };
    } catch (e) {
        console.warn("Failed to fetch IP addresses", e);
        return { v4: null, v6: null };
    }
};

// Wrapper for geolocation to use async/await
const getPosition = (options?: PositionOptions): Promise<GeolocationPosition> => {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Geolocation not supported"));
            return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
};

// --- Custom Components ---

const CustomSelect: React.FC<{
  value: string | null;
  onChange: (val: string | null) => void;
  options: string[];
  placeholder?: string;
  themeStyles: any;
}> = ({ value, onChange, options, placeholder, themeStyles }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    return options.filter(opt => opt.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [options, searchTerm]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full p-3 rounded-xl text-left flex justify-between items-center transition-all ${themeStyles.input} ${isOpen ? 'ring-2 ring-blue-400/20' : ''} ${themeStyles.hoverInput}`}
      >
        <span className={`block truncate ${!value ? themeStyles.textMuted : themeStyles.textMain} font-medium`}>
          {value || placeholder || "Select..."}
        </span>
        <span className="pointer-events-none flex items-center">
            <svg className={`h-4 w-4 ${themeStyles.textMuted} transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
        </span>
      </button>

      {isOpen && (
        <div className={`absolute z-[100] mt-2 w-full overflow-hidden rounded-xl ${themeStyles.dropdown} ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-100 origin-top`}>
            <div className={`p-2 border-b ${themeStyles.border} ${themeStyles.bgTranslucent}`}>
                <input 
                    type="text" 
                    placeholder="Search fields..." 
                    className={`w-full text-xs px-3 py-2 rounded-lg ${themeStyles.input} ${themeStyles.textMain}`}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                />
            </div>
            <div className="max-h-60 overflow-auto custom-scrollbar p-1">
                <div 
                    onClick={() => { onChange(null); setIsOpen(false); setSearchTerm(''); }}
                    className={`cursor-pointer select-none relative py-2 pl-3 pr-9 rounded-lg ${themeStyles.textMuted} italic ${themeStyles.hoverInput} transition-colors`}
                >
                    {placeholder || "None"}
                </div>
                {filteredOptions.map((option) => (
                    <div
                        key={option}
                        onClick={() => { onChange(option); setIsOpen(false); setSearchTerm(''); }}
                        className={`cursor-pointer select-none relative py-2 pl-3 pr-9 rounded-lg transition-colors ${
                            value === option 
                            ? 'bg-blue-500/10 text-blue-500 font-semibold border border-blue-200/50' 
                            : `${themeStyles.textMain} ${themeStyles.hoverInput}`
                        }`}
                    >
                        <span className="block truncate">{option}</span>
                    </div>
                ))}
            </div>
        </div>
      )}
    </div>
  );
};

const CopyButton: React.FC<{ text: string, label?: string }> = ({ text, label }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button
            onClick={handleCopy}
            className={`mr-1.5 p-0.5 rounded transition-all duration-200 focus:outline-none ${
                copied 
                ? 'text-emerald-600 bg-emerald-100/50' 
                : 'text-slate-400 hover:text-blue-600 hover:bg-blue-100/50'
            }`}
            title={copied ? "Copied!" : `Copy ${label || "value"}`}
        >
            {copied ? (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
            ) : (
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
                    <path d="M8 4V16C8 17.1046 8.89543 18 10 18H18C19.1046 18 20 17.1046 20 16V7.24264C20 6.71221 19.7893 6.20357 19.4142 5.82843L16.1716 2.58579C15.7964 2.21071 15.2878 2 14.7574 2H10C8.89543 2 8 2.89543 8 4Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M16 18V20C16 21.1046 15.1046 22 14 22H6C4.89543 22 4 21.1046 4 20V8C4 6.89543 4.89543 6 6 6H8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            )}
        </button>
    );
};

const ErrorModal: React.FC<{ error: string | null; onClearError: () => void; themeStyles?: any }> = ({ error, onClearError, themeStyles }) => {
    if (!error) return null;
    
    // Apply glassmorphism if themeStyles are provided, otherwise fallback
    const panelClass = themeStyles?.panel || "bg-white/90";
    const textMain = themeStyles?.textMain || "text-gray-900";
    const textMuted = themeStyles?.textMuted || "text-gray-600";
    const borderClass = themeStyles?.border || "border-red-100/50";
    
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-md p-4 animate-in fade-in duration-200" onClick={onClearError}>
        <div className={`${panelClass} w-full max-w-md overflow-hidden rounded-2xl shadow-2xl ring-1 ring-black/5 animate-in zoom-in-95 duration-200 scale-100`} onClick={e => e.stopPropagation()}>
          <div className={`p-6 flex flex-col items-center border-b ${borderClass} bg-red-500/10`}>
             <div className="h-16 w-16 bg-red-500/20 rounded-full flex items-center justify-center mb-4 shadow-inner ring-4 ring-white/10">
                <svg className="h-8 w-8 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" /></svg>
             </div>
             <h3 className={`text-xl font-bold ${textMain} tracking-tight`}>Something went wrong</h3>
          </div>
          <div className="p-6 text-center">
             <p className={`text-sm ${textMuted} font-medium leading-relaxed`}>{error}</p>
          </div>
          <div className={`px-6 py-4 flex justify-center border-t ${borderClass} bg-white/5`}>
             <button className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-red-500/30 hover:bg-red-700 active:scale-[0.98] transition-all" onClick={onClearError}>Dismiss</button>
          </div>
        </div>
      </div>
    );
};

const AdminDashboard: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onClearLogs: () => void;
    onLogout: () => void;
    themeStyles: any;
    ipInfo: { v4: string | null, v6: string | null };
    analysisResults: AnalysisResult[];
    dataSources: DataSource[];
}> = ({ isOpen, onClose, onClearLogs, onLogout, themeStyles, ipInfo, analysisResults, dataSources }) => {
    const [activeTab, setActiveTab] = useState('overview');
    const [logFilter, setLogFilter] = useState<'all' | 'query' | 'access'>('all');

    // --- Storage Metrics Calculation ---
    const storageMetrics = useMemo(() => {
        // Approximate JSON size of vector data
        const vectorBytes = dataSources.reduce((acc, ds) => acc + (JSON.stringify(ds.data).length), 0);
        const vectorMB = (vectorBytes / (1024 * 1024));
        
        // Remove mock raster data
        const rasterMB = 0; 
        
        const total = vectorMB + rasterMB;
        const vectorPercent = total > 0 ? (vectorMB / total) * 100 : 0;
        const rasterPercent = total > 0 ? (rasterMB / total) * 100 : 0;
        
        return {
            vector: vectorMB.toFixed(2),
            raster: rasterMB.toFixed(2),
            total: total.toFixed(2),
            vectorPercent,
            rasterPercent
        };
    }, [dataSources]);
    
    // --- Enhanced Logs Generation ---
    const unifiedLogs = useMemo(() => {
        const ipV4 = ipInfo.v4 || 'Unknown';
        const ipV6 = ipInfo.v6 || 'Unknown';

        // Query Logs (from AnalysisResults)
        const queries = analysisResults.map((res, i) => ({
            id: `q-${i}`,
            type: 'query',
            time: res.timestamp ? new Date(res.timestamp).toLocaleString() : 'Just now',
            timestamp: res.timestamp || Date.now(),
            details: `Spatial Query: ${res.totalFeatures} features scanned`,
            target: `${res.sourceName}`,
            duration: `${Math.floor(res.totalFeatures * 0.005 + Math.random() * 20)}ms`, // Mock duration based on complexity
            user: 'muhammed',
            ipV4,
            ipV6,
            status: 'Success'
        }));

        // Access Logs (from DataSources)
        const accesses = dataSources.map((ds, i) => ({
            id: `a-${i}`,
            type: 'access',
            time: 'Session Start',
            timestamp: Date.now() - 1000 * 60 * 5, // Mock time
            details: `Accessed Layer: ${ds.name} (${ds.data.features.length} objects)`,
            target: ds.name,
            duration: '-',
            user: 'muhammed',
            ipV4,
            ipV6,
            status: ds.isActive ? 'Active' : 'Inactive'
        }));

        return [...queries, ...accesses].sort((a, b) => b.timestamp - a.timestamp);
    }, [analysisResults, dataSources, ipInfo]);

    const displayLogs = useMemo(() => {
        return unifiedLogs.filter(l => logFilter === 'all' || l.type === logFilter);
    }, [unifiedLogs, logFilter]);

    // CSV Export Logic
    const handleExportCSV = () => {
        const headers = ["Timestamp", "Type", "Details", "Target", "Duration", "User", "IPv4", "IPv6", "Status"];
        const rows = unifiedLogs.map(log => [
            log.time,
            log.type.toUpperCase(),
            log.details.replace(/,/g, ';'),
            log.target.replace(/,/g, ';'),
            log.duration,
            log.user,
            log.ipV4,
            log.ipV6,
            log.status
        ]);

        const csvContent = "data:text/csv;charset=utf-8," 
            + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
        
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `system_audit_${new Date().toISOString().slice(0,10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    if (!isOpen) return null;

    return (
        <div 
            className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div 
                className={`${themeStyles.panel} w-full max-w-6xl h-[90vh] md:h-[85vh] rounded-2xl shadow-2xl ring-1 ring-white/10 overflow-hidden flex flex-col animate-in zoom-in-95 duration-200`}
                onClick={e => e.stopPropagation()}
            >
               {/* Header */}
               <div className={`p-4 md:p-6 border-b ${themeStyles.border} ${themeStyles.bgTranslucent} flex justify-between items-center shrink-0`}>
                    <div className="flex items-center gap-3 md:gap-4">
                        <div className="h-10 w-10 md:h-12 md:w-12 bg-indigo-500/20 rounded-2xl flex items-center justify-center text-indigo-500 shadow-inner ring-1 ring-white/5">
                             <svg className="w-6 h-6 md:w-7 md:h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                        </div>
                        <div>
                            <h2 className={`text-xl md:text-2xl font-bold ${themeStyles.textMain} tracking-tight`}>Admin Dashboard</h2>
                            <p className={`text-[10px] md:text-xs ${themeStyles.textMuted} uppercase tracking-wider font-semibold`}>System Overview & Controls</p>
                        </div>
                    </div>
                    <button onClick={onClose} className={`p-2.5 rounded-full hover:bg-white/10 ${themeStyles.textMain} transition-all active:scale-95`} title="Close Dashboard">
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
               </div>

               {/* Content */}
               <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
                    {/* Sidebar */}
                    <div className={`w-full md:w-64 border-b md:border-b-0 md:border-r ${themeStyles.border} p-2 md:p-4 flex flex-row md:flex-col gap-2 ${themeStyles.bgTranslucent} overflow-x-auto shrink-0 scrollbar-none`}>
                        <div className="flex flex-row md:flex-col gap-2 flex-1 min-w-max md:min-w-0">
                            {['overview', 'logs', 'storage', 'users'].map(tab => (
                                <button 
                                    key={tab}
                                    onClick={() => setActiveTab(tab)}
                                    className={`md:w-full px-3 md:px-4 py-2 md:py-3 rounded-xl text-left text-sm font-bold transition-all whitespace-nowrap ${
                                        activeTab === tab 
                                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' 
                                        : `${themeStyles.textMain} hover:bg-white/10 opacity-70 hover:opacity-100`
                                    } capitalize flex items-center justify-between group`}
                                >
                                    <span className="flex items-center gap-3">
                                        {tab === 'overview' && <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>}
                                        {tab === 'logs' && <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>}
                                        {tab === 'storage' && <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" /></svg>}
                                        {tab === 'users' && <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>}
                                        {tab}
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* Logout Button */}
                        <div className={`pl-2 md:pl-0 pt-0 md:pt-4 border-l md:border-l-0 md:border-t ${themeStyles.border} flex items-center md:block min-w-max md:min-w-0`}>
                            <button 
                                onClick={onLogout}
                                className="md:w-full px-3 md:px-4 py-2 md:py-3 rounded-xl text-left text-sm font-bold text-red-500 hover:bg-red-500/10 transition-colors flex items-center gap-3 active:scale-95 whitespace-nowrap"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                                <span className="hidden md:inline">Logout</span>
                                <span className="md:hidden">Exit</span>
                            </button>
                        </div>
                    </div>

                    {/* Main Panel */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-8">
                        {activeTab === 'overview' && (
                             <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                     {/* Network Status */}
                                     <div className={`${themeStyles.bgCard} p-6 rounded-2xl border ${themeStyles.border} shadow-lg backdrop-blur-md relative overflow-hidden`}>
                                         <h3 className={`text-xs font-bold ${themeStyles.textMuted} uppercase mb-2 tracking-widest`}>Network Identity</h3>
                                         <div className="flex flex-col gap-1">
                                            <div className="flex justify-between items-center border-b border-white/5 pb-2 mb-2">
                                                <span className={`text-xs ${themeStyles.textMuted}`}>IPv4</span>
                                                <span className={`text-sm font-mono font-bold ${themeStyles.textMain}`}>{ipInfo.v4 || 'Unknown'}</span>
                                            </div>
                                            <div className="flex justify-between items-center">
                                                <span className={`text-xs ${themeStyles.textMuted}`}>IPv6</span>
                                                <span className={`text-[10px] font-mono font-medium ${themeStyles.textMain} truncate max-w-[120px]`} title={ipInfo.v6 || ''}>{ipInfo.v6 || 'Unknown'}</span>
                                            </div>
                                         </div>
                                     </div>

                                     {/* Requests */}
                                     <div className={`${themeStyles.bgCard} p-6 rounded-2xl border ${themeStyles.border} shadow-lg backdrop-blur-md`}>
                                         <h3 className={`text-xs font-bold ${themeStyles.textMuted} uppercase mb-2 tracking-widest`}>Total Queries</h3>
                                         <div className="flex items-end justify-between">
                                            <div className={`text-4xl font-black ${themeStyles.textMain}`}>{analysisResults.length}</div>
                                            <div className="text-emerald-500 text-xs font-bold mb-1 flex items-center bg-emerald-500/10 px-2 py-1 rounded-full">
                                                Active
                                            </div>
                                         </div>
                                     </div>
                                     
                                     {/* Storage Summary */}
                                     <div className={`${themeStyles.bgCard} p-6 rounded-2xl border ${themeStyles.border} shadow-lg backdrop-blur-md`}>
                                         <h3 className={`text-xs font-bold ${themeStyles.textMuted} uppercase mb-2 tracking-widest`}>Storage Used</h3>
                                         <div className="flex items-end justify-between">
                                            <div className={`text-4xl font-black ${themeStyles.textMain}`}>{storageMetrics.total} <span className="text-lg text-slate-500 font-medium">MB</span></div>
                                            <div className="text-blue-500 text-xs font-bold mb-1 flex items-center bg-blue-500/10 px-2 py-1 rounded-full">
                                                {storageMetrics.vector} MB Vector
                                            </div>
                                         </div>
                                     </div>
                                 </div>
                             </div>
                        )}
                        
                        {activeTab === 'storage' && (
                             <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <h3 className={`text-xl font-bold ${themeStyles.textMain} mb-4`}>Storage Metrics</h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                                    <div className={`${themeStyles.bgCard} p-6 rounded-2xl border ${themeStyles.border}`}>
                                        <h4 className={`text-sm font-bold ${themeStyles.textMuted} uppercase mb-4`}>Vector Data (GeoJSON)</h4>
                                        <div className="text-4xl font-bold mb-2">{storageMetrics.vector} MB</div>
                                        <div className="w-full bg-slate-200/20 rounded-full h-3 mb-2">
                                            <div className="bg-indigo-500 h-3 rounded-full" style={{width: `${storageMetrics.vectorPercent}%`}}></div>
                                        </div>
                                        <p className="text-xs text-slate-500">Loaded raw feature geometry in memory.</p>
                                    </div>
                                    <div className={`${themeStyles.bgCard} p-6 rounded-2xl border ${themeStyles.border}`}>
                                        <h4 className={`text-sm font-bold ${themeStyles.textMuted} uppercase mb-4`}>Raster Data (Tile Cache)</h4>
                                        <div className="text-4xl font-bold mb-2">{storageMetrics.raster} MB</div>
                                        <div className="w-full bg-slate-200/20 rounded-full h-3 mb-2">
                                            <div className="bg-emerald-500 h-3 rounded-full" style={{width: `${storageMetrics.rasterPercent}%`}}></div>
                                        </div>
                                        <p className="text-xs text-slate-500">Estimated browser cache for map tiles.</p>
                                    </div>
                                </div>
                             </div>
                        )}

                        {activeTab === 'users' && (
                            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <h3 className={`text-xl font-bold ${themeStyles.textMain} mb-4`}>User Management</h3>
                                <div className={`${themeStyles.bgCard} rounded-2xl border ${themeStyles.border} p-6 flex items-start gap-4`}>
                                     <div className="bg-gradient-to-br from-purple-500 to-indigo-600 rounded-full p-4 text-white shadow-lg">
                                         <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                                     </div>
                                     <div>
                                         <h4 className={`text-lg font-bold ${themeStyles.textMain}`}>muhammed</h4>
                                         <p className={`text-xs ${themeStyles.textMuted} uppercase tracking-wider mb-2`}>Super Administrator</p>
                                         <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800">
                                             <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1.5"></span>
                                             Online
                                         </span>
                                     </div>
                                </div>
                            </div>
                        )}
                        
                        {activeTab === 'logs' && (
                             <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
                                 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-2">
                                    <h3 className={`text-xl font-bold ${themeStyles.textMain}`}>System Logs & Audits</h3>
                                    <div className="flex gap-2">
                                        <div className="flex rounded-lg bg-slate-200/20 p-1 mr-2">
                                            {['all', 'query', 'access'].map((f: any) => (
                                                <button
                                                    key={f}
                                                    onClick={() => setLogFilter(f)}
                                                    className={`px-3 py-1 text-xs font-bold rounded-md capitalize transition-all ${logFilter === f ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
                                                >
                                                    {f}
                                                </button>
                                            ))}
                                        </div>
                                        <button onClick={handleExportCSV} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors">Export CSV</button>
                                        <button onClick={onClearLogs} className="px-3 py-1.5 rounded-lg text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition-colors">Clear</button>
                                    </div>
                                 </div>
                                 
                                 <div className={`${themeStyles.bgCard} rounded-2xl border ${themeStyles.border} overflow-hidden flex-1 flex flex-col`}>
                                     {displayLogs.length === 0 ? (
                                         <div className="h-full flex flex-col items-center justify-center p-8 opacity-50">
                                             <p className={`text-sm font-medium ${themeStyles.textMuted}`}>No logs found.</p>
                                         </div>
                                     ) : (
                                        <div className="overflow-x-auto custom-scrollbar flex-1">
                                            <table className="w-full text-left border-collapse">
                                                <thead className={`${themeStyles.bgTranslucent} border-b ${themeStyles.border} sticky top-0 backdrop-blur-md`}>
                                                    <tr>
                                                        <th className={`p-4 text-xs font-bold ${themeStyles.textMuted} uppercase`}>Time</th>
                                                        <th className={`p-4 text-xs font-bold ${themeStyles.textMuted} uppercase`}>Type</th>
                                                        <th className={`p-4 text-xs font-bold ${themeStyles.textMuted} uppercase`}>Details</th>
                                                        <th className={`p-4 text-xs font-bold ${themeStyles.textMuted} uppercase`}>Duration</th>
                                                        <th className={`p-4 text-xs font-bold ${themeStyles.textMuted} uppercase`}>User & Network</th>
                                                    </tr>
                                                </thead>
                                                <tbody className={`divide-y ${themeStyles.border}`}>
                                                    {displayLogs.map((log) => (
                                                        <tr key={log.id} className={`hover:bg-white/5 transition-colors`}>
                                                            <td className={`p-4 text-xs font-mono ${themeStyles.textMuted}`}>{log.time}</td>
                                                            <td className="p-4"><span className={`text-[10px] font-bold px-2 py-1 rounded uppercase ${log.type === 'query' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{log.type}</span></td>
                                                            <td className={`p-4 text-sm ${themeStyles.textMain}`}>
                                                                <div className="font-semibold">{log.details}</div>
                                                                <div className={`text-xs ${themeStyles.textMuted}`}>{log.target}</div>
                                                            </td>
                                                            <td className={`p-4 text-xs font-mono ${themeStyles.textMain}`}>{log.duration}</td>
                                                            <td className={`p-4 text-xs ${themeStyles.textMain}`}>
                                                                <div className="font-bold">{log.user}</div>
                                                                <div className={`text-[10px] ${themeStyles.textMuted} font-mono mt-0.5 space-y-0.5`}>
                                                                    <div title="IPv4">v4: {log.ipV4}</div>
                                                                    <div title="IPv6" className="opacity-75">v6: {log.ipV6}</div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                     )}
                                 </div>
                             </div>
                        )}
                    </div>
               </div>
            </div>
        </div>
    );
};

const AdminLoginModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    onLoginSuccess: () => void;
    themeStyles: any;
}> = ({ isOpen, onClose, onLoginSuccess, themeStyles }) => {
    const [userId, setUserId] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        
        // Reverted to hardcoded credentials per user request
        if (userId === 'muhammed' && password === 'Althaf') { 
            setError(null);
            onLoginSuccess();
            onClose();
            setUserId('');
            setPassword('');
        } else {
            setError("Invalid credentials");
        }
    };

    return (
        <div 
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div 
                className={`${themeStyles.panel} w-full max-w-sm rounded-2xl shadow-2xl ring-1 ring-white/10 overflow-hidden animate-in zoom-in-95 duration-200`}
                onClick={e => e.stopPropagation()}
            >
                <div className={`p-5 border-b ${themeStyles.border} ${themeStyles.bgTranslucent} flex items-center gap-3`}>
                    <div className="bg-rose-500/20 p-2 rounded-lg text-rose-500">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                    </div>
                    <div>
                        <h3 className={`font-bold ${themeStyles.textMain}`}>Admin Access</h3>
                        <p className={`text-[10px] ${themeStyles.textMuted} uppercase tracking-wider`}>Restricted Area</p>
                    </div>
                </div>
                
                <form onSubmit={handleSubmit} className="p-6">
                    <div className="mb-4">
                        <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase mb-2`}>User ID</label>
                        <input 
                            type="text" 
                            className={`w-full px-4 py-2.5 rounded-xl ${themeStyles.input} text-sm focus:ring-2 focus:ring-rose-500/50 outline-none transition-all`}
                            placeholder="username"
                            value={userId}
                            onChange={(e) => setUserId(e.target.value)}
                            autoFocus
                        />
                    </div>

                    <div className="mb-4">
                        <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase mb-2`}>Password</label>
                        <input 
                            type="password" 
                            className={`w-full px-4 py-2.5 rounded-xl ${themeStyles.input} text-sm focus:ring-2 focus:ring-rose-500/50 outline-none transition-all`}
                            placeholder="••••••••"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    
                    {error && (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-2 text-red-500 text-xs font-semibold">
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            {error}
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button 
                            type="button" 
                            onClick={onClose}
                            className={`flex-1 py-2.5 rounded-xl font-semibold text-sm ${themeStyles.bgCard} ${themeStyles.textMain} hover:bg-white/10 transition-colors`}
                        >
                            Cancel
                        </button>
                        <button 
                            type="submit"
                            className="flex-1 py-2.5 rounded-xl font-semibold text-sm bg-rose-600 text-white hover:bg-rose-700 shadow-lg shadow-rose-600/20 transition-all active:scale-95"
                        >
                            Unlock
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const SettingsModal: React.FC<{
    isOpen: boolean;
    onClose: () => void;
    dataSources: DataSource[];
    onUpdateSourceSettings: (id: string, updates: Partial<DataSource>) => void;
    themeStyles: any;
}> = ({ isOpen, onClose, dataSources, onUpdateSourceSettings, themeStyles }) => {
      const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
      const [searchTerm, setSearchTerm] = useState('');

      useEffect(() => {
          if (isOpen && !selectedSourceId && dataSources.length > 0) {
              setSelectedSourceId(dataSources[0].id);
          }
      }, [isOpen, dataSources, selectedSourceId]);

      const activeSource = useMemo(() => 
          dataSources.find(ds => ds.id === selectedSourceId),
      [dataSources, selectedSourceId]);

      const availableAttributes = useMemo(() => {
          if (!activeSource) return [];
          const keys = new Set<string>();
          activeSource.data.features.forEach(f => {
              if (f.properties) {
                  Object.keys(f.properties).forEach(k => {
                      if (!k.startsWith('_') && !['styleUrl', 'styleHash', 'styleMapHash'].includes(k)) {
                          keys.add(k);
                      }
                  });
              }
          });
          return Array.from(keys).sort();
      }, [activeSource]);

      const filteredAttributes = useMemo(() => {
          return availableAttributes.filter(attr => attr.toLowerCase().includes(searchTerm.toLowerCase()));
      }, [availableAttributes, searchTerm]);

      if (!isOpen) return null;

      const handleToggleAttribute = (attr: string) => {
          if (!activeSource) return;
          const current = activeSource.visibleAttributes;
          const updated = current.includes(attr) 
            ? current.filter(k => k !== attr) 
            : [...current, attr];
          onUpdateSourceSettings(activeSource.id, { visibleAttributes: updated });
      };

      const handleSelectAll = () => {
          if (!activeSource) return;
          const newSet = new Set([...activeSource.visibleAttributes, ...filteredAttributes]);
          onUpdateSourceSettings(activeSource.id, { visibleAttributes: Array.from(newSet) });
      };

      const handleDeselectAll = () => {
          if (!activeSource) return;
          const newSet = activeSource.visibleAttributes.filter(attr => !filteredAttributes.includes(attr));
          onUpdateSourceSettings(activeSource.id, { visibleAttributes: newSet });
      };

      return (
        <div 
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/30 backdrop-blur-md p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div 
                className={`${themeStyles.panel} w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 rounded-2xl`}
                onClick={e => e.stopPropagation()}
            >
                <div className={`p-5 border-b ${themeStyles.border} flex justify-between items-center ${themeStyles.bgTranslucent}`}>
                    <div>
                        <h3 className={`text-xl font-bold ${themeStyles.textMain} drop-shadow-sm`}>Configuration</h3>
                        <p className={`text-xs ${themeStyles.textMuted} mt-0.5`}>Customize display fields and map popups</p>
                    </div>
                    <button onClick={onClose} className={`${themeStyles.textMuted} hover:${themeStyles.textMain} p-2 rounded-full hover:bg-white/20 transition-colors`}>
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>

                <div className={`p-6 overflow-y-auto custom-scrollbar flex-1 ${themeStyles.bgTranslucent}`}>
                    {dataSources.length === 0 ? (
                        <div className={`flex flex-col items-center justify-center h-40 text-center ${themeStyles.textMuted}`}>
                            <p>No Datasets Loaded</p>
                        </div>
                    ) : (
                        <div className="flex flex-col gap-6">
                            {/* Source Selection - Tabs style */}
                            <div>
                                <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-wider mb-2`}>Active Dataset</label>
                                <div className="flex flex-wrap gap-2">
                                    {dataSources.map(ds => (
                                        <button
                                            key={ds.id}
                                            onClick={() => setSelectedSourceId(ds.id)}
                                            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                                                selectedSourceId === ds.id
                                                ? 'bg-blue-600/90 text-white shadow-lg shadow-blue-500/20 backdrop-blur-md'
                                                : `${themeStyles.bgCard} ${themeStyles.textMain} ${themeStyles.hoverInput} border ${themeStyles.border}`
                                            }`}
                                        >
                                            {ds.name}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {activeSource && (
                                <div className="animate-in fade-in slide-in-from-right-4 duration-300">
                                    
                                    {/* Custom Field */}
                                    <div className="mb-6">
                                        <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-wider mb-2`}>Custom Result Field</label>
                                        <CustomSelect 
                                            value={activeSource.customResultField} 
                                            onChange={(val) => onUpdateSourceSettings(activeSource.id, { customResultField: val })}
                                            options={availableAttributes}
                                            placeholder="-- No Custom Field --"
                                            themeStyles={themeStyles}
                                        />
                                    </div>

                                    {/* Attributes Management */}
                                    <div className={`${themeStyles.bgCard} rounded-xl p-4 border ${themeStyles.border} shadow-sm`}>
                                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                                            <div>
                                                <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-wider`}>Map Popup Attributes</label>
                                                <span className={`text-[10px] ${themeStyles.textMuted}`}>Select fields to show when clicking features</span>
                                            </div>
                                            
                                            <div className="flex items-center gap-2">
                                                <div className="relative">
                                                    <input 
                                                        type="text" 
                                                        placeholder="Search attributes..." 
                                                        value={searchTerm}
                                                        onChange={(e) => setSearchTerm(e.target.value)}
                                                        className={`pl-8 pr-3 py-1.5 text-sm rounded-lg w-40 sm:w-56 ${themeStyles.input} ${themeStyles.textMain}`}
                                                    />
                                                    <svg className={`w-4 h-4 ${themeStyles.textMuted} absolute left-2.5 top-2`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                                </div>
                                            </div>
                                        </div>
                                        
                                        <div className="flex gap-2 mb-3 text-xs">
                                             <button onClick={handleSelectAll} className="text-blue-600 hover:text-blue-700 font-medium hover:bg-blue-50/50 px-2 py-1 rounded transition-colors">Select Visible</button>
                                             <button onClick={handleDeselectAll} className={`${themeStyles.textMuted} hover:${themeStyles.textMain} font-medium hover:bg-slate-50/50 px-2 py-1 rounded transition-colors`}>Clear Visible</button>
                                        </div>

                                        <div className="flex flex-wrap gap-2 max-h-60 overflow-y-auto pr-1">
                                            {filteredAttributes.length === 0 ? (
                                                <p className={`text-sm ${themeStyles.textMuted} w-full text-center py-4`}>No attributes match "{searchTerm}"</p>
                                            ) : (
                                                filteredAttributes.map(attr => {
                                                    const isChecked = activeSource.visibleAttributes.includes(attr);
                                                    return (
                                                        <button
                                                            key={attr}
                                                            onClick={() => handleToggleAttribute(attr)}
                                                            className={`
                                                                px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 select-none flex items-center gap-1.5
                                                                ${isChecked 
                                                                    ? 'bg-blue-500/90 text-white border-blue-500/50 shadow-md shadow-blue-500/20' 
                                                                    : `${themeStyles.bgCard} ${themeStyles.textMain} ${themeStyles.border} hover:border-blue-300 ${themeStyles.hoverInput}`
                                                                }
                                                            `}
                                                        >
                                                            {isChecked && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                                            {attr}
                                                        </button>
                                                    );
                                                })
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className={`p-4 border-t ${themeStyles.border} ${themeStyles.bgTranslucent} flex justify-end backdrop-blur-md`}>
                    <button 
                        onClick={onClose}
                        className={`px-6 py-2 rounded-lg font-semibold shadow-lg transition-transform active:scale-95 bg-slate-800/70 hover:bg-slate-700/80 text-white border border-white/10`}
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
      );
};

const ControlPanel: React.FC<ControlPanelProps> = ({
  onFileUpload,
  onClearFile,
  onClearError,
  onSearch,
  onFindNext,
  onFindPrevious,
  onZoom,
  onClear,
  onRemoveResult,
  onPreviewLocation,
  dataSources,
  processingFiles = [],
  onToggleSource,
  onDeleteSource,
  onUpdateSourceSettings,
  onLoadMore,
  isLoading,
  isSearching,
  error,
  analysisResults,
  externalQuery,
  theme,
  onToggleTheme
}) => {
  const [viewState, setViewState] = useState<ViewState>('expanded');
  const [localError, setLocalError] = useState<string | null>(null);
  const [distUnit, setDistUnit] = useState<'km' | 'm'>('km');
  const [showSettings, setShowSettings] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [showAdminDashboard, setShowAdminDashboard] = useState(false);
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  
  const clickCountRef = useRef(0);
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isLocating, setIsLocating] = useState(false);
  const [ipInfo, setIpInfo] = useState<{v4: string | null, v6: string | null}>({v4: null, v6: null});

  const searchInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Computed Theme Styles with 30% Opacity for interactive elements as requested
  const themeStyles = useMemo(() => {
    const isDark = theme === 'dark';
    return {
        // Main panel stays at /20 for depth hierarchy
        panel: isDark ? "bg-slate-900/20 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/50" : "bg-white/20 backdrop-blur-xl backdrop-saturate-150 backdrop-contrast-125 border border-white/20 shadow-[0_8px_32px_0_rgba(31,38,135,0.15)]",
        textMain: isDark ? "text-slate-200" : "text-slate-800",
        textMuted: isDark ? "text-slate-400" : "text-slate-500",
        border: isDark ? "border-white/10" : "border-white/20",
        
        // INPUTS & DROPDOWNS @ 30% as requested
        input: isDark ? "bg-black/30 border-white/10 focus:bg-black/40 text-white placeholder:text-slate-500" : "bg-white/30 border border-white/20 focus:bg-white/40 text-slate-800 placeholder:text-slate-600",
        dropdown: isDark ? "bg-slate-900/40 backdrop-blur-xl border border-white/10 shadow-2xl" : "bg-white/40 backdrop-blur-xl border border-white/20 shadow-2xl",
        
        // Card backgrounds
        bgCard: isDark ? "bg-black/20" : "bg-white/20",
        hoverInput: isDark ? "hover:bg-white/10" : "hover:bg-white/40", // Increased hover slightly for contrast against 30%
        bgTranslucent: isDark ? "bg-black/40" : "bg-white/40", // Match dropdown opacity for headers inside dropdowns
        toggleBg: isDark ? "bg-slate-700/30" : "bg-slate-300/30",
    };
  }, [theme]);

  // Initial Fetch of User IP
  useEffect(() => {
    const fetchIp = async () => {
        const ips = await getIPAddress();
        setIpInfo(ips);
    };
    fetchIp();
  }, []);

  useEffect(() => {
    if (error || isLoading || isSearching) {
        setLocalError(null);
    }
  }, [error, isLoading, isSearching]);
  
  // Handle external query updates
  useEffect(() => {
      if (externalQuery && searchInputRef.current) {
          searchInputRef.current.value = externalQuery.value;
          searchInputRef.current.focus();
      }
  }, [externalQuery]);

  useEffect(() => {
      return () => {
          if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      };
  }, []);
  
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileUpload(Array.from(e.target.files));
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleGetCurrentLocation = async () => {
      if (!navigator.geolocation) {
          setLocalError("Geolocation is not supported.");
          return;
      }

      setIsLocating(true);
      if (localError) setLocalError(null);

      // Helper to process position success
      const processPosition = (position: GeolocationPosition) => {
          const { latitude, longitude } = position.coords;
          const coords = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
          
          if (searchInputRef.current) {
              searchInputRef.current.value = coords;
          }
          onSearch(coords);
      };

      try {
          // STRICT STRATEGY: High Accuracy (GPS) Only
          // We disable the fallback to network location to ensure precision.
          await getPosition({ 
              enableHighAccuracy: true, 
              timeout: 10000, // Allow 10 seconds for GPS lock
              maximumAge: 5000 // Accept cached GPS fix if less than 5s old
          }).then(processPosition);
          
      } catch (error: any) {
          console.warn("High accuracy geolocation failed", error);
          
          let msg = "Unable to retrieve high-accuracy location.";
          if (error.code === error.PERMISSION_DENIED) {
              msg = "Location permission denied.";
          } else if (error.code === error.TIMEOUT) {
              msg = "GPS request timed out. Please try again outdoors.";
          } else if (error.code === error.POSITION_UNAVAILABLE) {
              msg = "GPS signal unavailable.";
          }
          setLocalError(msg);
      } finally {
          setIsLocating(false);
      }
  };

  const triggerSearch = () => {
    const value = searchInputRef.current?.value.trim();

    if (!value) {
        setLocalError("Please enter a location.");
        return;
    }
    setLocalError(null);
    onSearch(value);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    triggerSearch();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (localError) setLocalError(null);

    if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
    }

    // Optimization: Only attempt preview if it strictly looks like coordinates.
    // This prevents map jumping/API calls while typing standard addresses.
    if (!val.trim()) return;

    debounceTimerRef.current = setTimeout(() => {
        // Strict regex for "Lat, Lng" or "Lat Lng" (with optional negative signs and decimals)
        const coordRegex = /^(-?\d+(\.\d+)?)[,\s]+(-?\d+(\.\d+)?)$/;
        const match = val.trim().match(coordRegex);

        if (match) {
            const lat = parseFloat(match[1]);
            const lng = parseFloat(match[3]);
            
            if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
                onPreviewLocation(lat, lng);
            }
        }
    }, 600); // 600ms debounce
  };

  const toggleUnit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDistUnit(prev => prev === 'km' ? 'm' : 'km');
  };

  const formatDistance = (val: number | null) => {
      if (val === null) return '-';
      if (distUnit === 'km') return `${val.toFixed(2)} km`;
      return `${(val * 1000).toFixed(0)} m`;
  };

  const handleLogoClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      clickCountRef.current += 1;
      if (clickTimerRef.current) clearTimeout(clickTimerRef.current);
      if (clickCountRef.current >= 4) {
          if (isAdminAuthenticated) {
              setShowAdminDashboard(true);
          } else {
              setShowAdminLogin(true);
          }
          clickCountRef.current = 0;
      } else {
          clickTimerRef.current = setTimeout(() => {
              clickCountRef.current = 0;
          }, 500);
      }
  };

  const handleLogout = () => {
      setIsAdminAuthenticated(false);
      setShowAdminDashboard(false);
  };

  const renderResultCard = (result: AnalysisResult, index: number, isCompact: boolean = false) => {
      const itemNumber = analysisResults.length - index;
      const canFindNext = result.rank < result.totalFeatures;
      const canFindPrev = result.rank > 1;
      const source = dataSources.find(ds => ds.id === result.sourceId);
      const customResultField = source?.customResultField;
      const copyString = `${formatDistance(result.distance)} - ${result.bearing?.toFixed(1)}°`;

      let customValue: string | null = null;
      if (customResultField && result.nearestFeature?.properties) {
          const val = result.nearestFeature.properties[customResultField];
          if (val !== undefined && val !== null) customValue = String(val);
      }

      return (
        <div key={index} className={`${isCompact ? 'bg-transparent pt-1' : `${themeStyles.bgCard} border ${themeStyles.border} p-3 rounded-lg`} relative animate-in fade-in slide-in-from-bottom-2 duration-300 shadow-sm ${!isCompact ? 'hover:bg-white/20 dark:hover:bg-white/5 transition-all' : ''}`}>
            {!isCompact && (
                <div className="flex justify-between items-start mb-2">
                    <div className="flex flex-col max-w-[70%]">
                        <span className={`text-xs font-bold ${themeStyles.textMain}`}>Result #{itemNumber}</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                            {/* Rank Badge - Improved Contrast */}
                            <span className={`text-[10px] bg-slate-100/80 dark:bg-slate-700/60 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-600`}>
                                Rank: {result.rank}
                            </span>
                            {/* Source Name Badge - Improved Contrast */}
                            <span className="text-[10px] bg-blue-50/80 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded border border-blue-100 dark:border-blue-800 truncate max-w-full">
                                {result.sourceName}
                            </span>
                        </div>
                    </div>
                    
                    <button 
                        onClick={(e) => { e.stopPropagation(); onRemoveResult(index); }}
                        className={`${themeStyles.textMuted} hover:text-red-500 p-1.5 rounded-full hover:bg-red-50/20 transition-colors`}
                    >
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                </div>
            )}

            <div className={`grid ${customValue ? 'grid-cols-3' : 'grid-cols-2'} gap-2 mb-2 ${!isCompact ? `border-t ${themeStyles.border} pt-2` : ''}`}>
                <div>
                    <div className="flex items-center gap-1 mb-0.5">
                        <span className={`text-[10px] ${themeStyles.textMuted} uppercase tracking-wide`}>Dist</span>
                        <button onClick={toggleUnit} className={`text-[9px] bg-slate-200/60 dark:bg-slate-700/60 hover:bg-slate-300/60 ${themeStyles.textMain} px-1 rounded transition-colors`}>{distUnit.toUpperCase()}</button>
                    </div>
                    <span className={`block text-sm font-mono font-semibold ${themeStyles.textMain}`}>{formatDistance(result.distance)}</span>
                </div>
                <div>
                    <div className="flex items-center mb-0.5">
                        <CopyButton text={copyString} label="Distance & Bearing" />
                        <span className={`text-[10px] ${themeStyles.textMuted} uppercase tracking-wide`}>Bearing</span>
                    </div>
                    <span className={`block text-sm font-mono font-semibold ${themeStyles.textMain}`}>{result.bearing?.toFixed(1)}°</span>
                </div>
                {customValue && (
                     <div className={`border-l ${themeStyles.border} pl-2`}>
                        <div className="flex items-center mb-0.5">
                            <CopyButton text={customValue} label={customResultField || "Field"} />
                            <span className={`text-[10px] ${themeStyles.textMuted} uppercase tracking-wide truncate max-w-[80px]`}>{customResultField}</span>
                        </div>
                        <span className={`block text-sm font-mono font-semibold ${themeStyles.textMain} truncate`} title={customValue}>{customValue}</span>
                     </div>
                )}
            </div>

            <div className="flex justify-between items-end">
                {!isCompact ? (
                    <div className={`text-[10px] ${themeStyles.textMuted} font-mono`}>
                        Q: {result.searchPoint?.lat.toFixed(4)}, {result.searchPoint?.lng.toFixed(4)}
                    </div>
                ) : <div />}
                
                <div className="flex gap-1">
                    {/* Zoom Button - Improved Contrast */}
                    <button 
                        onClick={() => onZoom(index)} 
                        disabled={!result.nearestFeature} 
                        className={`text-xs px-2 py-1 rounded shadow-sm border transition-colors ${
                            result.nearestFeature 
                            ? 'bg-white/80 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/40' 
                            : 'bg-slate-50/50 text-slate-400 cursor-not-allowed'
                        }`}
                    >
                        Zoom
                    </button>
                    <button onClick={() => onFindPrevious(index)} disabled={!canFindPrev} className={`text-xs px-2 py-1 rounded shadow-sm border transition-colors ${canFindPrev ? `bg-white/40 dark:bg-white/10 ${themeStyles.border} hover:bg-white/60 ${themeStyles.textMain}` : 'bg-slate-50/50 text-slate-400 cursor-not-allowed'}`}>&larr;</button>
                    <button onClick={() => onFindNext(index)} disabled={!canFindNext} className={`text-xs px-2 py-1 rounded shadow-sm border transition-colors ${canFindNext ? `bg-white/40 dark:bg-white/10 ${themeStyles.border} hover:bg-white/60 ${themeStyles.textMain}` : 'bg-slate-50/50 text-slate-400 cursor-not-allowed'}`}>&rarr;</button>
                </div>
            </div>
        </div>
      );
  };

  if (viewState === 'closed') {
    return (
      <>
        <style>{LIQUID_STYLES}</style>
        <ErrorModal error={error} onClearError={onClearError} themeStyles={themeStyles} />
        <SettingsModal 
            isOpen={showSettings} 
            onClose={() => setShowSettings(false)} 
            dataSources={dataSources} 
            onUpdateSourceSettings={onUpdateSourceSettings}
            themeStyles={themeStyles}
        />
        <AdminLoginModal 
            isOpen={showAdminLogin} 
            onClose={() => setShowAdminLogin(false)}
            onLoginSuccess={() => {
                setIsAdminAuthenticated(true);
                setShowAdminDashboard(true);
            }}
            themeStyles={themeStyles}
        />
        <AdminDashboard 
            isOpen={showAdminDashboard} 
            onClose={() => setShowAdminDashboard(false)}
            onClearLogs={onClear}
            onLogout={handleLogout}
            themeStyles={themeStyles}
            ipInfo={ipInfo}
            analysisResults={analysisResults}
            dataSources={dataSources}
        />
        
        <button
          onClick={() => setViewState('expanded')}
          className={`absolute top-4 left-4 z-10 p-3 rounded-full transition-all flex items-center justify-center group bg-slate-800/70 hover:bg-slate-700/80 text-white backdrop-blur-md shadow-lg border border-white/10`}
          title="Open GeoSpatial Analyzer"
        >
          <span className="absolute right-0 top-0 flex h-3 w-3 -mt-1 -mr-1">
             {analysisResults.length > 0 && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>}
             {analysisResults.length > 0 && <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>}
          </span>
          <svg className="w-6 h-6 group-hover:rotate-12 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
          </svg>
        </button>
      </>
    );
  }

  return (
    <>
    <style>{LIQUID_STYLES}</style>
    <ErrorModal error={error} onClearError={onClearError} themeStyles={themeStyles} />
    <SettingsModal 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
        dataSources={dataSources} 
        onUpdateSourceSettings={onUpdateSourceSettings} 
        themeStyles={themeStyles}
    />
    <AdminLoginModal 
        isOpen={showAdminLogin} 
        onClose={() => setShowAdminLogin(false)}
        onLoginSuccess={() => {
            setIsAdminAuthenticated(true);
            setShowAdminDashboard(true);
        }}
        themeStyles={themeStyles}
    />
    <AdminDashboard 
        isOpen={showAdminDashboard} 
        onClose={() => setShowAdminDashboard(false)}
        onClearLogs={onClear}
        onLogout={handleLogout}
        themeStyles={themeStyles}
        ipInfo={ipInfo}
        analysisResults={analysisResults}
        dataSources={dataSources}
    />

    <div className={`absolute top-4 left-4 sm:left-4 z-10 w-[calc(100vw-2rem)] sm:w-96 flex flex-col transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)] ${themeStyles.panel} rounded-2xl overflow-hidden ${viewState === 'minimized' ? 'h-auto' : 'max-h-[90vh]'}`}>
      <div 
        className={`p-4 flex justify-between items-center cursor-pointer select-none backdrop-blur-md border-b ${themeStyles.border} ${theme === 'dark' ? 'bg-black/40' : 'bg-slate-800/80'}`}
        onClick={(e) => {
            if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'H1') setViewState(prev => prev === 'minimized' ? 'expanded' : 'minimized');
        }}
      >
        <h1 className="font-bold text-lg flex items-center gap-2 tracking-tight min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
          <div 
             className="bg-gradient-to-br from-blue-400 to-indigo-500 text-white rounded p-1 shadow-lg shadow-blue-500/20 active:scale-95 transition-transform flex-shrink-0"
             onClick={handleLogoClick}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0121 18.382V7.618a1 1 0 01-.894-1.447L14 7m0 13V7" /></svg>
          </div>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-300 truncate">GeoSpatial</span>
        </h1>

        <div className="flex items-center gap-1.5 flex-shrink-0 ml-auto" onClick={(e) => e.stopPropagation()}>
            {/* Theme Toggle */}
            <button 
                onClick={onToggleTheme}
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors text-slate-300 hover:text-white relative active:scale-95"
                title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
            >
                {theme === 'light' ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" /></svg>
                ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
                )}
            </button>
            <button 
                onClick={() => setShowSettings(true)} 
                className="p-1.5 hover:bg-white/20 rounded-lg transition-colors text-slate-300 hover:text-white relative active:scale-95" 
                title="Settings"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
            <button onClick={() => setViewState(prev => prev === 'minimized' ? 'expanded' : 'minimized')} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors text-slate-300 hover:text-white">
                {viewState === 'minimized' ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg> : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>}
            </button>
            <button onClick={() => setViewState('closed')} className="p-1.5 hover:bg-red-500/20 hover:text-red-300 rounded-lg transition-colors text-slate-300">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        </div>
      </div>

      {viewState === 'minimized' && analysisResults.length > 0 && (
          <div className={`p-3 border-t ${themeStyles.border} ${themeStyles.bgTranslucent} backdrop-blur-md`}>
              {renderResultCard(analysisResults[0], 0, true)}
          </div>
      )}

      {viewState === 'expanded' && (
        <div className="p-5 space-y-6 overflow-y-auto scrollbar-thin scrollbar-thumb-white/50 scrollbar-track-transparent">
            <div>
            <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-wider mb-2`}>Sources</label>
            <div className={`relative group mb-3 ${themeStyles.input} rounded-lg overflow-hidden`}>
                <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".kml,.kmz"
                onChange={handleFileChange}
                className={`block w-full text-sm ${themeStyles.textMuted}
                    file:mr-4 file:py-2.5 file:px-4
                    file:border-0 file:bg-slate-100/10 file:text-slate-500 file:hover:text-slate-300
                    file:text-xs file:font-bold
                    hover:file:bg-slate-200/20 cursor-pointer`}
                />
            </div>

            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
                {/* Processing Files */}
                {processingFiles && processingFiles.map(file => (
                    <div key={file.id} className="relative h-12 w-full liquid-container mb-3 overflow-hidden">
                        
                        <div 
                            className="liquid-fill flex items-center"
                            style={{ width: `${file.progress}%` }}
                        ></div>

                        <div className="absolute inset-0 flex items-center justify-between px-4 z-10 pointer-events-none">
                             <span className="font-bold text-slate-700 text-sm truncate drop-shadow-sm max-w-[80%]">
                                 {file.name} ({Math.round(file.progress)}%)
                             </span>
                             {file.progress < 100 ? (
                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-slate-400 border-t-slate-600"></div>
                             ) : (
                                 <svg className="w-5 h-5 text-emerald-500 drop-shadow-sm animate-in zoom-in" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                 </svg>
                             )}
                        </div>
                    </div>
                ))}

                {/* Active Data Sources */}
                {dataSources.map((ds) => (
                        <div key={ds.id} className={`${themeStyles.bgCard} border ${themeStyles.border} flex flex-col rounded-lg p-2 pl-3 animate-in fade-in slide-in-from-left-2 mb-1`}>
                        <div className="flex items-center justify-between w-full">
                            <div className="flex items-center min-w-0 flex-1 mr-2">
                                <label className="relative inline-flex items-center cursor-pointer mr-3">
                                    <input 
                                        type="checkbox" 
                                        className="sr-only peer" 
                                        checked={ds.isActive}
                                        onChange={() => onToggleSource(ds.id)}
                                    />
                                    <div className={`w-9 h-5 ${themeStyles.toggleBg} border ${themeStyles.border} peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white/90 after:border-gray-300/50 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500/80`}></div>
                                </label>
                                <div className="flex flex-col min-w-0">
                                    <span className={`text-xs font-medium ${themeStyles.textMain} truncate`} title={ds.name}>{ds.name}</span>
                                    <span className={`text-[10px] ${themeStyles.textMuted}`}>
                                        {ds.data.features.length} features
                                    </span>
                                </div>
                            </div>
                            <button onClick={() => onDeleteSource(ds.id)} className={`${themeStyles.textMuted} hover:text-red-500 hover:bg-red-50/20 p-1.5 rounded transition-all`}>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                            </button>
                        </div>
                        
                        {/* Load More Button if cache exists */}
                        {ds.pendingFeatures.length > 0 && (
                            <div className="ml-12 mt-1 mb-1">
                                <button 
                                    onClick={() => onLoadMore(ds.id)}
                                    className={`text-[10px] font-semibold text-blue-600 hover:text-blue-700 bg-blue-50/50 hover:bg-blue-100/50 px-2 py-1 rounded transition-colors flex items-center gap-1`}
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 13l-7 7-7-7m14-8l-7 7-7-7" /></svg>
                                    Load next 10k ({ds.pendingFeatures.length} remaining)
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            </div>

            <div>
            <label className={`block text-xs font-bold ${themeStyles.textMuted} uppercase tracking-wider mb-2`}>Analysis</label>
            <form onSubmit={handleSearchSubmit} className="flex gap-2">
                <div className="relative flex-1">
                    <input
                    ref={searchInputRef}
                    onChange={handleInputChange}
                    type="text"
                    placeholder="LAT,LONG"
                    className={`w-full px-3 py-2.5 pr-10 rounded-lg text-sm transition-all ${themeStyles.input} ${localError ? 'border-red-300/50 bg-red-50/30 text-red-400 placeholder-red-300' : ''}`}
                    />
                    <button
                        type="button"
                        onClick={handleGetCurrentLocation}
                        disabled={isLocating || isSearching}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50/20 rounded-md transition-colors disabled:opacity-50"
                        title="Use Current Location"
                    >
                        {isLocating ? (
                           <svg className="animate-spin w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                        ) : (
                           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        )}
                    </button>
                </div>
                <button
                type="submit"
                disabled={isSearching}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-md hover:shadow-lg flex items-center justify-center min-w-[64px] active:scale-95 bg-slate-800/70 hover:bg-slate-700/80 text-white backdrop-blur-md border border-white/10`}
                >
                {isSearching ? (
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                ) : 'Go'}
                </button>
            </form>
            
            {localError && (
                <div className="mt-3 bg-red-50/95 border border-red-200 shadow-lg shadow-red-50/10 p-3 rounded-xl flex items-start gap-3 animate-in slide-in-from-top-2 fade-in duration-300 backdrop-blur-md">
                    <div className="bg-red-100 p-1.5 rounded-full flex-shrink-0">
                        <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    </div>
                    <div className="flex-1">
                        <h4 className="text-[10px] font-bold text-red-800 uppercase tracking-wider mb-0.5">Error</h4>
                        <p className="text-xs text-red-700 font-medium leading-snug">{localError}</p>
                    </div>
                    <button onClick={() => setLocalError(null)} className="text-red-400 hover:text-red-700 hover:bg-red-100 rounded-lg p-1 transition-colors">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            )}
            </div>

            {isLoading && (
            <div className="p-4 bg-blue-50/20 text-blue-800 text-sm rounded-lg border border-blue-100/30 flex items-center gap-3 animate-pulse backdrop-blur-sm">
                <svg className="animate-spin h-4 w-4 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                <span className="font-medium">Processing files...</span>
            </div>
            )}

            {analysisResults.length > 0 && (
            <div className={`border-t ${themeStyles.border} pt-4`}>
                <div className="flex justify-between items-center mb-3">
                    <h3 className={`text-xs font-bold ${themeStyles.textMuted} uppercase tracking-wider`}>Results ({analysisResults.length})</h3>
                    <button onClick={onClear} className="text-[10px] text-red-600 hover:text-red-700 font-semibold uppercase tracking-wider bg-red-50/40 hover:bg-red-100/40 px-2 py-1 rounded transition-colors backdrop-blur-sm">Clear</button>
                </div>
                <div className="space-y-3">
                    {analysisResults.map((result, index) => renderResultCard(result, index, false))}
                </div>
            </div>
            )}
        </div>
      )}
    </div>
    </>
  );
};

export default ControlPanel;
