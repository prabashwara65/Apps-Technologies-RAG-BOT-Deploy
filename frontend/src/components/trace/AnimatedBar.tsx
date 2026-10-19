import { useEffect, useState } from "react";

interface AnimatedBarProps {
  value: number;
  max: number;
  color: string;
  delayMs?: number;
}

export function AnimatedBar({
  value,
  max,
  color,
  delayMs = 0,
}: AnimatedBarProps) {
  const [width, setWidth] = useState(0);
  const safeValue = Number.isFinite(value) ? Math.max(0, value) : 0;
  const safeMax = Number.isFinite(max) && max > 0 ? max : 0;
  const targetWidth = safeMax === 0 ? 0 : Math.min(100, (safeValue / safeMax) * 100);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setWidth(targetWidth));
    return () => cancelAnimationFrame(frame);
  }, [targetWidth]);

  return (
    <div className="trace-bar-track" aria-hidden="true">
      <div
        className="trace-bar-fill"
        style={{
          width: `${width}%`,
          background: color,
          transitionDelay: `${delayMs}ms`,
          animationDelay: `${delayMs}ms`,
        }}
      />
    </div>
  );
}
