import React from 'react';

interface LoadingOverlayProps {
  isVisible: boolean;
  message?: string;
}

const LoadingOverlay: React.FC<LoadingOverlayProps> = ({ isVisible, message }) => {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-500">
      
      {/* Globe Container */}
      <div className="relative w-20 h-20 mb-5">
        
        {/* Outer Ring (Orbit) */}
        <div className="absolute -inset-4 rounded-full border border-white/5 animate-[spin_8s_linear_infinite]">
            <div className="absolute top-1/2 -right-1 w-1.5 h-1.5 bg-cyan-400 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.8)]"></div>
        </div>

        {/* The Globe Sphere */}
        <div className="absolute inset-0 rounded-full bg-gradient-to-br from-white/10 via-transparent to-black/20 shadow-[inset_0_0_20px_rgba(255,255,255,0.05)] border border-white/10 backdrop-blur-sm overflow-hidden">
            
            {/* World Network SVG */}
            <svg 
                className="absolute inset-0 w-full h-full animate-[spin_20s_linear_infinite]" 
                viewBox="0 0 100 100" 
                fill="none"
                style={{ animationDirection: 'reverse' }}
            >
                {/* Longitude/Latitude Grid (Faint) */}
                <g stroke="white" strokeWidth="0.2" strokeOpacity="0.2">
                    <ellipse cx="50" cy="50" rx="48" ry="48" />
                    <ellipse cx="50" cy="50" rx="25" ry="48" />
                    <line x1="2" y1="50" x2="98" y2="50" />
                    <path d="M2 50 Q 50 80 98 50" fill="none" />
                    <path d="M2 50 Q 50 20 98 50" fill="none" />
                </g>

                {/* Connecting Nodes & Lines (Simulated Network) */}
                <g stroke="white" strokeWidth="0.5" strokeOpacity="0.6" fill="white">
                    {/* Abstract 'Continents' connections */}
                    <path d="M30,35 L45,25 L60,30 L50,50 L30,60 L20,45 Z" fill="white" fillOpacity="0.05" stroke="none" />
                    <path d="M60,60 L80,55 L75,75 L60,80 Z" fill="white" fillOpacity="0.05" stroke="none" />

                    {/* Connection Lines */}
                    <line x1="30" y1="35" x2="45" y2="25" />
                    <line x1="45" y1="25" x2="60" y2="30" />
                    <line x1="60" y1="30" x2="50" y2="50" />
                    <line x1="50" y1="50" x2="30" y2="60" />
                    <line x1="30" y1="60" x2="20" y2="45" />
                    <line x1="20" y1="45" x2="30" y2="35" />
                    
                    {/* Cross-continent Links */}
                    <path d="M50,50 Q 65,55 70,65" strokeDasharray="2,1" strokeOpacity="0.4" />
                    <path d="M60,30 Q 70,40 80,55" strokeDasharray="2,1" strokeOpacity="0.4" />

                    {/* Nodes with Pulse */}
                    <circle cx="30" cy="35" r="1.5" className="animate-pulse" fill="cyan" />
                    <circle cx="45" cy="25" r="1.5" className="animate-pulse" />
                    <circle cx="60" cy="30" r="1.5" className="animate-pulse" fill="cyan" />
                    <circle cx="50" cy="50" r="2" className="animate-pulse" />
                    <circle cx="30" cy="60" r="1.5" className="animate-pulse" />
                    <circle cx="20" cy="45" r="1.5" className="animate-pulse" />
                    
                    <circle cx="80" cy="55" r="1.5" className="animate-pulse" fill="cyan" />
                    <circle cx="70" cy="65" r="1.5" className="animate-pulse" />
                </g>
            </svg>
            
            {/* Gloss/Reflection */}
            <div className="absolute top-0 left-0 w-full h-1/2 bg-gradient-to-b from-white/10 to-transparent rounded-t-full pointer-events-none"></div>
        </div>
      </div>

      {/* Loading Text */}
      <div className="relative text-center z-10 space-y-2">
        <h3 className="text-[10px] font-bold text-cyan-100 tracking-[0.3em] uppercase drop-shadow-md">
            {message || "SYSTEM INITIALIZING"}
        </h3>
        {/* Connecting dots animation below text */}
        <div className="flex justify-center gap-1.5 opacity-60">
            <div className="w-1 h-1 bg-cyan-400 rounded-full animate-[bounce_1s_infinite_-0.3s]"></div>
            <div className="w-1 h-1 bg-cyan-400 rounded-full animate-[bounce_1s_infinite_-0.15s]"></div>
            <div className="w-1 h-1 bg-cyan-400 rounded-full animate-[bounce_1s_infinite]"></div>
        </div>
      </div>

    </div>
  );
};

export default LoadingOverlay;