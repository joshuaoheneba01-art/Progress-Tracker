// Focus timer, built on timestamps rather than counted ticks: elapsed time is
// always (now − startedAt − time spent paused). A throttled background tab, a
// sleeping phone or a reload can't make it drift. Pure functions only.
//
// focus = { blockId, date: "YYYY-MM-DD" (study day), startedAt, pausedAt | null, pausedMs, durationMin }

const MIN_FOCUS = 5;           // minutes

// Started during the block: run until the block ends. Otherwise (early, or
// catching up later): the block's full length.
export function startFocus(block, studyDate, minuteNow, nowMs) {
  const inside = minuteNow >= block.start && minuteNow < block.end;
  const durationMin = Math.max(MIN_FOCUS, inside ? block.end - minuteNow : block.end - block.start);
  return { blockId: block.id, date: studyDate, startedAt: nowMs, pausedAt: null, pausedMs: 0, durationMin };
}

export function elapsedMs(f, nowMs) {
  const until = f.pausedAt ?? nowMs;
  return Math.max(0, until - f.startedAt - f.pausedMs); // clock set back → 0, never negative
}

export const remainingMs = (f, nowMs) => Math.max(0, f.durationMin * 60000 - elapsedMs(f, nowMs));
export const isDone = (f, nowMs) => remainingMs(f, nowMs) === 0;
export const progress = (f, nowMs) => Math.min(1, elapsedMs(f, nowMs) / (f.durationMin * 60000));

export function pauseFocus(f, nowMs) {
  return f.pausedAt === null ? { ...f, pausedAt: Math.max(nowMs, f.startedAt) } : f;
}

export function resumeFocus(f, nowMs) {
  if (f.pausedAt === null) return f;
  return { ...f, pausedMs: f.pausedMs + Math.max(0, nowMs - f.pausedAt), pausedAt: null };
}

// 2_534_000 → "42:14", 3_725_000 → "1:02:05"
export function fmtClock(ms) {
  const t = Math.ceil(ms / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = n => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
