// Windows temporarily needs this file, https://github.com/module-federation/vite/issues/68

const importMap = {
  '@vueuse/core': async () => {
    let pkg = await import(
      '__mf__virtual/volview_remote__prebuild___mf_0_vueuse_mf_1_core__prebuild__.js'
    );
    return pkg;
  },
  pinia: async () => {
    let pkg = await import(
      '__mf__virtual/volview_remote__prebuild__pinia__prebuild__.js'
    );
    return pkg;
  },
  vue: async () => {
    let pkg = await import(
      '__mf__virtual/volview_remote__prebuild__vue__prebuild__.js'
    );
    return pkg;
  },
  vuetify: async () => {
    let pkg = await import(
      '__mf__virtual/volview_remote__prebuild__vuetify__prebuild__.js'
    );
    return pkg;
  },
};
const usedShared = {
  '@vueuse/core': {
    name: '@vueuse/core',
    version: '12.8.2',
    scope: ['default'],
    loaded: false,
    from: 'volview_remote',
    async get() {
      usedShared['@vueuse/core'].loaded = true;
      const { '@vueuse/core': pkgDynamicImport } = importMap;
      const res = await pkgDynamicImport();
      const exportModule = { ...res };
      // All npm packages pre-built by vite will be converted to esm
      Object.defineProperty(exportModule, '__esModule', {
        value: true,
        enumerable: false,
      });
      return function () {
        return exportModule;
      };
    },
    shareConfig: {
      singleton: true,
      requiredVersion: '^12.8.2',
    },
  },
  pinia: {
    name: 'pinia',
    version: '2.3.1',
    scope: ['default'],
    loaded: false,
    from: 'volview_remote',
    async get() {
      usedShared['pinia'].loaded = true;
      const { pinia: pkgDynamicImport } = importMap;
      const res = await pkgDynamicImport();
      const exportModule = { ...res };
      // All npm packages pre-built by vite will be converted to esm
      Object.defineProperty(exportModule, '__esModule', {
        value: true,
        enumerable: false,
      });
      return function () {
        return exportModule;
      };
    },
    shareConfig: {
      singleton: true,
      requiredVersion: '^2.3.1',
    },
  },
  vue: {
    name: 'vue',
    version: '3.5.13',
    scope: ['default'],
    loaded: false,
    from: 'volview_remote',
    async get() {
      usedShared['vue'].loaded = true;
      const { vue: pkgDynamicImport } = importMap;
      const res = await pkgDynamicImport();
      const exportModule = { ...res };
      // All npm packages pre-built by vite will be converted to esm
      Object.defineProperty(exportModule, '__esModule', {
        value: true,
        enumerable: false,
      });
      return function () {
        return exportModule;
      };
    },
    shareConfig: {
      singleton: true,
      requiredVersion: '^3.5.13',
    },
  },
  vuetify: {
    name: 'vuetify',
    version: '3.7.18',
    scope: ['default'],
    loaded: false,
    from: 'volview_remote',
    async get() {
      usedShared['vuetify'].loaded = true;
      const { vuetify: pkgDynamicImport } = importMap;
      const res = await pkgDynamicImport();
      const exportModule = { ...res };
      // All npm packages pre-built by vite will be converted to esm
      Object.defineProperty(exportModule, '__esModule', {
        value: true,
        enumerable: false,
      });
      return function () {
        return exportModule;
      };
    },
    shareConfig: {
      singleton: true,
      requiredVersion: '^3.7.18',
    },
  },
};
const usedRemotes = [];
export { usedShared, usedRemotes };
