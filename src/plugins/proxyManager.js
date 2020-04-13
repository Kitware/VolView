function unsubscribeList(l = []) {
  while (l.length > 0) {
    l.pop().unsubscribe();
  }
}

export function ProxyManagerVuexPlugin(pxm) {
  const pxmSubs = [];
  const proxySubs = {};
  return (store) => {
    const dispatch = (action, payload) => {
      // hacky way to only dispatch actions that have been registered
      /* eslint-disable-next-line no-underscore-dangle */
      if (action in store._actions) {
        store.dispatch(action, payload);
      }
    };

    pxmSubs.push(
      pxm.onProxyRegistrationChange((info) => {
        const { action, proxyId, proxy } = info;
        if (action === 'register') {
          dispatch('pxmProxyCreated', info);
          proxySubs[proxyId] = proxy.onModified((p) => dispatch('pxmProxyModified', p));
        } else if (proxyId in proxySubs) {
          proxySubs[proxyId].unsubscribe();
          dispatch('pxmProxyDeleted', info);
        }
        dispatch('pxmProxyRegistrationChange', info);
      }),
    );

    pxmSubs.push(
      pxm.onActiveSourceChange((source) => dispatch('pxmActiveSourceChange', source)),
    );

    pxmSubs.push(
      pxm.onActiveViewChange((view) => dispatch('pxmActiveViewChange', view)),
    );
  };
}

const pxmSubsKey = Symbol('PXM_SUBS');
const proxySubsKey = Symbol('PROXY_SUBS');

export const ProxyManagerVuePlugin = {
  install(Vue) {
    Vue.mixin({
      beforeCreate() {
        const opts = this.$options;
        this.$proxyManager = opts.proxyManager || (opts.parent && opts.parent.$proxyManager);
      },
      mounted() {
        if (this.$options.proxyManagerHooks) {
          const pxmSubs = [];
          const proxySubs = {};

          const hooks = this.$options.proxyManagerHooks;

          if (
            hooks.onProxyCreated
            || hooks.onProxyModified
            || hooks.onProxyDeleted
            || hooks.onProxyRegistrationChange
          ) {
            if (hooks.onProxyModified) {
              // hook into all existing proxies
              // I hope this doesn't incur much perf issues
              const groups = this.$proxyManager.getProxyGroups();
              let proxies = [];
              for (let i = 0; i < groups.length; i += 1) {
                const name = groups[i];
                proxies = proxies.concat(
                  this.$proxyManager.getProxyInGroup(name),
                );
              }
              for (let i = 0; i < proxies.length; i += 1) {
                const proxy = proxies[i];
                proxySubs[proxy.getProxyId()] = proxy.onModified(
                  (p) => hooks.onProxyModified.call(this, p),
                );
              }
            }

            pxmSubs.push(
              this.$proxyManager.onProxyRegistrationChange((info) => {
                const { action, proxyId, proxy } = info;
                if (action === 'register') {
                  if (hooks.onProxyCreated) {
                    hooks.onProxyCreated.call(this, info);
                  }
                  if (hooks.onProxyModified) {
                    proxySubs[proxyId] = proxy.onModified(
                      (p) => hooks.onProxyModified.call(this, p),
                    );
                  }
                } else if (action === 'unregister') {
                  if (proxyId in proxySubs) {
                    proxySubs[proxyId].unsubscribe();
                    delete proxySubs[proxyId];
                  }
                  if (hooks.onProxyDeleted) {
                    hooks.onProxyDeleted.call(this, info);
                  }
                }
                if (hooks.onProxyRegistrationChange) {
                  hooks.onProxyRegistrationChange.call(this, info);
                }
              }),
            );
          }

          if (hooks.onActiveSourceChange) {
            pxmSubs.push(
              this.$proxyManager.onActiveSourceChange(
                (s) => hooks.onActiveSourceChange.call(this, s),
              ),
            );
          }

          if (hooks.onActiveViewChange) {
            pxmSubs.push(
              this.$proxyManager.onActiveViewChange((v) => hooks.onActiveViewChange.call(this, v)),
            );
          }

          this[pxmSubsKey] = pxmSubs;
          this[proxySubsKey] = proxySubs;
        }
      },
      beforeDestroy() {
        if (this[pxmSubsKey]) {
          unsubscribeList(this[pxmSubsKey]);
        }
        if (this[proxySubsKey]) {
          unsubscribeList(Object.values(this[proxySubsKey]));
          this[proxySubsKey] = {};
        }
      },
    });
  },
};
