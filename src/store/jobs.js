import Vue from 'vue';

function noop() {}

export const JobState = {
  NotStarted: Symbol('NotStarted'),
  Running: Symbol('Running'),
  Finished: Symbol('Finished'),
  Errored: Symbol('Errored'),
  Cancelled: Symbol('Cancelled'),
};

export default () => ({
  namespaced: true,
  state: {
    jobs: [], // [job id]
    jobIndex: {}, // job id -> job info
  },

  mutations: {
    addJob(state, { jobID, entryFn, doneFn, errorFn }) {
      if (!(jobID in state.jobIndex)) {
        Vue.set(state.jobIndex, jobID, {
          state: JobState.NotStarted,
          cancel: false,
          entryFn,
          doneFn,
          errorFn,
        });
        state.jobs.push(jobID);
      }
    },

    removeJob(state, jobID) {
      const idx = state.jobs.indexOf(jobID);
      if (idx > -1) {
        state.jobs.splice(idx, 1);
      }
      delete state.jobIndex[jobID];
    },

    jobStarted(state, id) {
      if (id in state.jobIndex) {
        state.jobIndex[id].state = JobState.Running;
      }
    },

    jobFinished(state, id) {
      if (id in state.jobIndex) {
        state.jobIndex[id].state = JobState.Finished;
      }
    },

    jobErrored(state, id) {
      if (id in state.jobIndex) {
        state.jobIndex[id].state = JobState.Errored;
      }
    },

    jobCancelled(state, id) {
      if (id in state.jobIndex) {
        state.jobIndex[id].cancel = true;
        state.jobIndex[id].state = JobState.Cancelled;
      }
    },
  },

  actions: {
    /**
     * When creating a job, we need a finish hook. This will
     * invoke removeJob(jobID).
     *
     * Should this handle errors? There should be an error handler, and
     * then the job is removed.
     *
     * for cancelable jobs, we pass in a function isCancelled() for the
     * routine to check.
     */
    createJob({ commit }, info) {
      const { name = 'Job', entry = noop, done = noop, error = noop } = info;
      const jobID = `${name}-${+new Date()}`;
      commit('addJob', {
        jobID,
        entryFn: entry,
        doneFn: done,
        errorFn: error,
      });
      return jobID;
    },

    startJob({ state, commit, dispatch }, jobID) {
      const job = state.jobIndex[jobID];
      if (job) {
        commit('jobStarted', jobID);
        setTimeout(async () => {
          const { entryFn, doneFn, errorFn = noop } = job;
          const isCancelled = () => state[jobID]?.cancel;
          const done = async () => {
            commit('jobFinished', jobID);
            await doneFn();
          };
          try {
            commit('jobStarted', jobID);
            await entryFn(done, isCancelled);
          } catch (e) {
            console.error('job errored:', e);
            commit('jobErrored', jobID);
            await errorFn(jobID, e);
          } finally {
            await dispatch('removeJob', jobID);
          }
        }, 1);
      }
    },

    /**
     * Only applicable to cancelable jobs
     */
    cancelJob({ state, commit }, jobID) {
      if (jobID in state.jobIndex) {
        commit('jobCancelled', jobID);
      }
    },

    /**
     * Removes a job that is finished or cancelled.
     */
    removeJob({ state, commit }, jobID) {
      const job = state.jobIndex[jobID];
      if (job?.state !== JobState.Running) {
        commit('removeJob', jobID);
      }
    },
  },
});
