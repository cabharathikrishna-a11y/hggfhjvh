// timer.worker.ts
// Phase-locked background worker to handle precise ticking, even when browser tab is throttled

let baseFocusTimeMs = 0;
let lastEventTsMs = 0;
let serverTimeOffsetMs = 0;
let isRunning = false;
let timerId: any = null;

function getUniversalTimeMs(): number {
  return Date.now() + serverTimeOffsetMs;
}

function tick() {
  if (!isRunning) return;

  const currentUniversal = getUniversalTimeMs();
  const elapsedMs = baseFocusTimeMs + (currentUniversal - lastEventTsMs);

  self.postMessage({
    type: "TICK",
    elapsedMs,
    currentUniversalTimeMs: currentUniversal
  });

  // Apply Phase-Lock math to align ticks close to 100ms boundaries
  const nextDelay = 100 - (getUniversalTimeMs() % 100);
  timerId = setTimeout(tick, nextDelay);
}

self.onmessage = (event: MessageEvent) => {
  const { type, payload, command } = event.data;

  if (type === "START") {
    isRunning = true;
    baseFocusTimeMs = payload.baseFocusTimeMs || 0;
    lastEventTsMs = payload.lastEventTsMs || 0;
    serverTimeOffsetMs = payload.serverTimeOffsetMs || 0;
    
    if (timerId) {
      clearTimeout(timerId);
    }
    tick();
  } else if (type === "STOP" || command === "STOP") {
    isRunning = false;
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  } else if (type === "UPDATE_OFFSET") {
    serverTimeOffsetMs = payload.serverTimeOffsetMs || 0;
  }
};
