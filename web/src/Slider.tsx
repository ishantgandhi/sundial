import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Tick } from "./api";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// A slider with one stop per transaction, plus a last stop for "Now". Index === ticks.length means Now.
// While you drag, the handle follows your pointer smoothly; the chosen stop updates as you pass each one,
// and on release the handle glides to the nearest stop.
export default function Slider({ ticks, index, onChange }: { ticks: Tick[]; index: number; onChange: (i: number) => void }) {
  const max = ticks.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<number | null>(null); // handle position (0..1) while dragging, else null
  const stopPos = (i: number) => (max === 0 ? 1 : i / max); // where a stop sits along the track (0..1)
  const pos = drag ?? stopPos(index);

  const tick = ticks[index]; // undefined at Now
  const label = tick ? tick.committedAt : "Now";
  const count = tick ? `${tick.changeCount} ${tick.changeCount === 1 ? "change" : "changes"}` : "live table";

  // turn the pointer's x position into 0..1 along the track, then pick the nearest stop
  function follow(e: PointerEvent) {
    const r = trackRef.current!.getBoundingClientRect();
    const f = clamp((e.clientX - r.left) / r.width, 0, 1);
    setDrag(f);
    if (max > 0) onChange(Math.round(f * max));
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
    if (step !== undefined) onChange(clamp(index + step, 0, max));
    else if (e.key === "Home") onChange(0);
    else if (e.key === "End") onChange(max);
    else return;
    e.preventDefault();
  }

  return (
    <div
      className="slider"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        follow(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && follow(e)}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="track" ref={trackRef}>
        {Array.from({ length: max + 1 }, (_, i) => (
          <span key={i} className={i === max ? "mark now" : "mark"} style={{ left: `${stopPos(i) * 100}%` }} />
        ))}
        <div
          className={drag === null ? "handle" : "handle dragging"}
          style={{ left: `${pos * 100}%` }}
          role="slider"
          tabIndex={0}
          aria-label="Point in time"
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={index}
          aria-valuetext={`${label}, ${count}`}
          onKeyDown={onKeyDown}
        />
        {/* time and change count under the handle; the shift keeps the text inside the edges */}
        <div className={drag === null ? "handle-label" : "handle-label dragging"} style={{ left: `${pos * 100}%`, transform: `translateX(-${pos * 100}%)` }}>
          <div className="mono">{label}</div>
          <div className="dim">{count}</div>
        </div>
      </div>
    </div>
  );
}
