type HistogramPhase = 'ordinary' | 'adaptive';
type HistogramGate = {
  phase: HistogramPhase;
  posts: HistogramPhase[];
  held: Array<{
    phase: HistogramPhase;
    release: () => void;
  }>;
  restore: () => void;
};
type HistogramGateWindow = Window & { volumeHistogramGate: HistogramGate };

/** Hold real worker responses so histogram completion order is deterministic. */
export async function holdVolumeHistograms() {
  await browser.execute(() => {
    const original = window.Worker;
    let active = true;
    const gate: HistogramGate = {
      phase: 'ordinary',
      posts: [],
      held: [],
      restore() {
        active = false;
        window.Worker = original;
      },
    };
    (window as unknown as HistogramGateWindow).volumeHistogramGate = gate;
    window.Worker = new Proxy(original, {
      construct(target, args) {
        const worker = Reflect.construct(target, args) as Worker;
        let phase: HistogramPhase | undefined;
        let replaying = false;
        worker.addEventListener('message', (event) => {
          if (!active || !phase || replaying) return;
          event.stopImmediatePropagation();
          gate.held.push({
            phase,
            release() {
              replaying = true;
              worker.dispatchEvent(
                new MessageEvent('message', { data: event.data })
              );
              replaying = false;
            },
          });
        });
        const post = worker.postMessage.bind(worker);
        worker.postMessage = (
          message,
          transfers: Transferable[] | StructuredSerializeOptions = []
        ) => {
          const vtkHistogram =
            Array.isArray(message) && message[1]?.numberOfBins;
          const histogram = message?.path?.[0] === 'piecewiseHistogram';
          if (vtkHistogram || histogram) {
            phase = gate.phase;
            gate.posts.push(phase);
          }
          if (Array.isArray(transfers)) post(message, transfers);
          else post(message, transfers);
        };
        return worker;
      },
    });
  });
}

export async function waitForHistogram(phase: HistogramPhase) {
  await browser.waitUntil(
    () =>
      browser.execute((selectedPhase) => {
        const gate = (window as unknown as HistogramGateWindow)
          .volumeHistogramGate;
        const posts = gate.posts.filter((entry) => entry === selectedPhase);
        return (
          posts.length > 0 &&
          gate.held.filter((entry) => entry.phase === selectedPhase).length ===
            posts.length
        );
      }, phase),
    { timeoutMsg: `Expected the ${phase} histogram workers to finish` }
  );
}

export async function hasHistogramRequest(phase: HistogramPhase) {
  return browser.execute(
    (selectedPhase) =>
      (
        window as unknown as HistogramGateWindow
      ).volumeHistogramGate.posts.includes(selectedPhase),
    phase
  );
}

export async function releaseHistogram(phase: HistogramPhase) {
  await browser.execute((selectedPhase) => {
    (window as unknown as HistogramGateWindow).volumeHistogramGate.held
      .filter((entry) => entry.phase === selectedPhase)
      .forEach((entry) => entry.release());
  }, phase);
  await browser.executeAsync((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  });
}

export async function captureOpacityEditor() {
  return $('[data-testid="volume-opacity-editor"] canvas').execute((element) =>
    (element as HTMLCanvasElement).toDataURL()
  );
}

export async function selectAdaptiveHistogramPhase() {
  await browser.execute(() => {
    (window as unknown as HistogramGateWindow).volumeHistogramGate.phase =
      'adaptive';
  });
}

export async function restoreHistogramWorkers() {
  await browser.execute(() => {
    (window as unknown as HistogramGateWindow).volumeHistogramGate.restore();
  });
}
