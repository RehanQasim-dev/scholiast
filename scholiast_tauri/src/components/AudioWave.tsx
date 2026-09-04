interface AudioWaveProps {
  bars?: number;
  className?: string;
}

export default function AudioWave({ bars = 4, className = "" }: AudioWaveProps) {
  return (
    <div
      className={`inline-flex items-center gap-0.5 h-4 ${className}`}
      aria-hidden="true"
      data-testid="audio-wave-visualizer"
    >
      {Array.from({ length: bars }).map((_, i) => (
        <span
          key={i}
          className="w-0.5 rounded-full bg-current transition-all duration-150"
          style={{
            height: `${8 + Math.sin((i + 1) * 1.3) * 6}px`,
            animation: "pulse 0.8s ease-in-out infinite alternate",
            animationDelay: `${i * 120}ms`,
          }}
        />
      ))}
    </div>
  );
}
