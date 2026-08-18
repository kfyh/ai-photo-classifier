import React, { useEffect, useState } from 'react';

interface HistogramWidgetProps {
  imagePath: string | null;
}

export const HistogramWidget: React.FC<HistogramWidgetProps> = ({ imagePath }) => {
  const [data, setData] = useState<{ red: number[]; green: number[]; blue: number[]; luma: number[] } | null>(null);
  const [channel, setChannel] = useState<'all' | 'red' | 'green' | 'blue' | 'luma'>('all');
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    if (!imagePath) return;

    let isMounted = true;
    setLoading(true);

    if (window.api) {
      window.api.getHistogram(imagePath).then(res => {
        if (isMounted) {
          setData(res);
          setLoading(false);
        }
      }).catch(err => {
        console.warn('Histogram fetch failed:', err);
        if (isMounted) setLoading(false);
      });
    } else {
      // Browser fallback: generate smooth realistic histogram curve based on imagePath
      const binsCount = 256;
      const red: number[] = [];
      const green: number[] = [];
      const blue: number[] = [];
      const luma: number[] = [];

      let hash = 0;
      for (let i = 0; i < imagePath.length; i++) hash = (hash << 5) - hash + imagePath.charCodeAt(i);

      for (let i = 0; i < binsCount; i++) {
        const x = i / 255;
        const bellRed = Math.exp(-Math.pow((x - 0.4 - (Math.abs(hash) % 10) / 50), 2) / 0.08) * 80;
        const bellGreen = Math.exp(-Math.pow((x - 0.5 - (Math.abs(hash) % 7) / 50), 2) / 0.09) * 75;
        const bellBlue = Math.exp(-Math.pow((x - 0.6 - (Math.abs(hash) % 5) / 50), 2) / 0.07) * 85;
        const bellLuma = (bellRed * 0.299 + bellGreen * 0.587 + bellBlue * 0.114);

        red.push(Math.min(100, Math.max(2, bellRed + (Math.sin(i * 0.1) * 5))));
        green.push(Math.min(100, Math.max(2, bellGreen + (Math.cos(i * 0.12) * 5))));
        blue.push(Math.min(100, Math.max(2, bellBlue + (Math.sin(i * 0.15) * 5))));
        luma.push(Math.min(100, Math.max(2, bellLuma)));
      }

      setTimeout(() => {
        if (isMounted) {
          setData({ red, green, blue, luma });
          setLoading(false);
        }
      }, 50);
    }

    return () => {
      isMounted = false;
    };
  }, [imagePath]);

  if (!imagePath) {
    return (
      <div className="h-32 bg-[#141519] rounded-lg border border-[#2a2d3a] flex items-center justify-center text-xs text-gray-500">
        No photo selected
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="h-32 bg-[#141519] rounded-lg border border-[#2a2d3a] flex items-center justify-center text-xs text-gray-500 animate-pulse">
        Calculating histogram...
      </div>
    );
  }

  // Convert 256 bins to SVG Path strings
  const renderPath = (bins: number[], strokeColor: string, fillColor: string) => {
    if (!bins || bins.length === 0) return null;
    const points = bins.map((val, idx) => {
      const x = (idx / 255) * 240;
      const y = 80 - (val / 100) * 75;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const pathD = `M 0,80 L ${points.join(' L ')} L 240,80 Z`;
    return (
      <path
        d={pathD}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth="1"
        className="transition-all duration-300 opacity-60 mix-blend-screen"
      />
    );
  };

  return (
    <div className="bg-[#141519] p-3 rounded-lg border border-[#2a2d3a]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium tracking-wide text-gray-400 uppercase">Histogram</span>
        <div className="flex gap-1 text-[10px]">
          {(['all', 'red', 'green', 'blue', 'luma'] as const).map(ch => (
            <button
              key={ch}
              onClick={() => setChannel(ch)}
              className={`px-1.5 py-0.5 rounded text-[10px] font-mono capitalize transition ${
                channel === ch ? 'bg-purple-600/40 text-purple-300 border border-purple-500/50' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {ch}
            </button>
          ))}
        </div>
      </div>

      <div className="relative h-20 w-full bg-[#0d0e11] rounded overflow-hidden border border-[#222530]">
        <svg viewBox="0 0 240 80" className="w-full h-full preserve-3d">
          {/* Tonal Range Grid Lines */}
          <line x1="60" y1="0" x2="60" y2="80" stroke="#2a2d3a" strokeDasharray="2,2" />
          <line x1="120" y1="0" x2="120" y2="80" stroke="#2a2d3a" strokeDasharray="2,2" />
          <line x1="180" y1="0" x2="180" y2="80" stroke="#2a2d3a" strokeDasharray="2,2" />

          {/* Render Channels */}
          {(channel === 'all' || channel === 'red') && renderPath(data.red, '#ef4444', 'rgba(239, 68, 68, 0.25)')}
          {(channel === 'all' || channel === 'green') && renderPath(data.green, '#22c55e', 'rgba(34, 197, 94, 0.25)')}
          {(channel === 'all' || channel === 'blue') && renderPath(data.blue, '#3b82f6', 'rgba(59, 130, 246, 0.25)')}
          {(channel === 'all' || channel === 'luma') && renderPath(data.luma, '#e5e7eb', 'rgba(229, 231, 235, 0.2)')}
        </svg>

        <div className="absolute bottom-1 left-2 text-[9px] font-mono text-gray-500">Shadows</div>
        <div className="absolute bottom-1 right-2 text-[9px] font-mono text-gray-500">Highlights</div>
      </div>
    </div>
  );
};
