import React from "react";

/* One transport bar, shared by the static figure and the current-flow card,
   so the same controls look and behave the same on every topology. */
function PlayBar({ play, onPlay, spd, onSpd, phases, phase, onPhase, extra, pos, onPos }) {
  return (
    <>
      <div className="ctl" role="group" aria-label="Animation controls">
        <button className={play ? "on" : ""} onClick={onPlay} aria-pressed={play}
          aria-label={play ? "Pause animation" : "Play animation"}>
          <span aria-hidden="true">{play ? "❚❚" : "▶"}</span> {play ? "pause" : "play"}
        </button>
        {[0.5, 1, 2].map((v) => (
          <button key={v} className={spd === v && play ? "on" : ""} onClick={() => onSpd(v)}
            aria-pressed={spd === v && play} aria-label={"Speed " + v + " times"}>{v}×</button>
        ))}
        <span className="sp" />
        {phases.map((name, k) => (
          <button key={k} className={phase === k ? "on" : ""} onClick={() => onPhase(k)} aria-pressed={phase === k}>
            {name}
          </button>
        ))}
        {extra}
      </div>
      {/* Scrub. Stepping between named phases lands you in the middle of one;
          this walks the whole cycle so a transition can be inspected at the
          instant it happens. */}
      {onPos ? (
        <div className="scrub">
          <span>scrub</span>
          <input type="range" min="0" max="1" step="0.002" value={pos}
            aria-label="Scrub through the switching cycle"
            onChange={(e) => onPos(parseFloat(e.target.value))} />
        </div>
      ) : null}
    </>
  );
}

export { PlayBar };
