// Generic "initial launch data load complete" signal. App.vue signals once
// after the launch-time `loadUrls` resolves; feature modules subscribe from
// their own entry points, keeping App.vue blind to feature startup steps.
//
// A subscriber registered after the signal already fired runs immediately,
// and a failing subscriber never breaks boot or starves other subscribers.
// Dependency-free on purpose: subscriptions run at module evaluation from
// feature entry points, and any import here could turn that into a cycle.

type LaunchLoadSubscriber = () => void | Promise<void>;

const subscribers = new Set<LaunchLoadSubscriber>();
let completed = false;

const run = async (subscriber: LaunchLoadSubscriber) => {
  try {
    await subscriber();
  } catch (err) {
    console.error('Launch-load subscriber failed', err);
  }
};

export const onLaunchLoadComplete = (subscriber: LaunchLoadSubscriber) => {
  if (completed) {
    run(subscriber);
    return;
  }
  subscribers.add(subscriber);
};

export const signalLaunchLoadComplete = async () => {
  if (completed) return;
  completed = true;
  await Promise.all([...subscribers].map(run));
  subscribers.clear();
};
