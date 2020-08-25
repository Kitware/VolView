import { mapState, mapGetters } from 'vuex';
import vtkWidgetManager from 'vtk.js/Sources/Widgets/Core/WidgetManager';

export function attachResizeObserver(container, cb) {
  const observer = new ResizeObserver((entries) => {
    if (entries.length === 1) {
      cb();
    }
  });
  observer.observe(container);
  return observer;
}

export const VtkContainerMap = new WeakMap();

function createContainer() {
  const container = document.createElement('div');
  container.className = 'vtk-view';
  return container;
}

export default {
  props: {
    active: Boolean,
    viewType: String,
    viewName: String,
    // TODO these 3 props should be determined by viewType
    axis: {
      type: Number,
      default: 0,
      validator(v) {
        return v === 0 || v === 1 || v === 2;
      },
    },
    orientation: {
      type: Number,
      default: 1,
      validator(v) {
        return v === -1 || v === 1;
      },
    },
    viewUp: {
      type: Array,
      default: () => [0, 0, 1],
      validator(v) {
        return v.length === 3;
      },
    },
  },

  computed: {
    ...mapGetters(['sceneObjectIDs']),
    ...mapState({
      vizPipelines: (state) => state.visualization.pipelines,
      worldOrientation: (state) => state.visualization.worldOrientation,
      colorBy: (state) => state.visualization.colorBy,
    }),
    sceneSources() {
      return this.sceneObjectIDs
        .filter((id) => id in this.vizPipelines)
        .map((id) => this.vizPipelines[id].last);
    },
  },

  watch: {
    viewType() {
      this.remountView();
    },
    viewName() {
      this.remountView();
    },
    axis() {
      this.updateOrientation();
    },
    orientation() {
      this.updateOrientation();
    },
    viewUp() {
      this.updateOrientation();
    },
    sceneSources() {
      this.updateScene();
    },
    worldOrientation() {
      this.updateScene();
    },
    colorBy() {
      this.updateColorBy();
    },
  },

  mounted() {
    this.view = null;
    this.debouncedRender = null;
    this.remountView();
  },

  beforeDestroy() {
    this.unmountView();
  },

  methods: {
    beforeViewUnmount() {},
    afterViewMount() {},

    unmountView() {
      if (this.view) {
        this.beforeViewUnmount();
        const container = VtkContainerMap.get(this.view);
        if (this.$refs.containerParent === container.parentElement) {
          this.$refs.containerParent.removeChild(container);
        }
        this.view = null;
      }
    },

    remountView() {
      this.unmountView();

      this.view = this.$proxyManager
        .getViews()
        .find(
          (v) =>
            v.getProxyName() === this.viewType && v.getName() === this.viewName
        );
      if (!this.view) {
        this.view = this.$proxyManager.createProxy('Views', this.viewType, {
          name: this.viewName,
        });
      }

      if (this.view) {
        if (!VtkContainerMap.has(this.view)) {
          const container = createContainer();
          VtkContainerMap.set(this.view, container);
          this.view.setContainer(container);
        }

        // remove from prev parent, if any
        const container = VtkContainerMap.get(this.view);
        if (container.parentElement) {
          container.parentElement.removeChild(container);
        }
        this.$refs.containerParent.appendChild(container);

        this.view.getRenderer().setBackground(0, 0, 0);

        if (!this.view.getReferenceByName('widgetManager')) {
          this.view.set(
            { widgetManager: vtkWidgetManager.newInstance() },
            true
          );
        }

        const widgetManager = this.view.getReferenceByName('widgetManager');
        widgetManager.setRenderer(this.view.getRenderer());
        widgetManager.setUseSvgLayer(true);

        this.updateOrientation();
        this.updateScene();

        // let vue rendering settle before resizing canvas
        this.$nextTick(() => {
          if (this.view) {
            this.onResize();
            this.resetCamera();
            this.render();
            this.afterViewMount();
          }
        });
      }
    },

    updateOrientation() {
      if (this.view) {
        this.view.updateOrientation(this.axis, this.orientation, this.viewUp);
      }
    },

    updateScene() {
      this.view
        .getRepresentations()
        .forEach((rep) => this.view.removeRepresentation(rep));

      this.sceneSources.forEach((source) => {
        const rep = this.$proxyManager.getRepresentation(source, this.view);
        if (rep) {
          if (rep.setTransform) {
            rep.setTransform(...this.worldOrientation.worldToIndex);
          }
          this.view.addRepresentation(rep);
        }
      });
    },

    updateColorBy() {
      const colorInfo = this.sceneObjectIDs.map((id) => this.colorBy[id]);
      this.sceneSources.forEach((source, idx) => {
        const srcColorBy = colorInfo[idx];
        const rep = this.$proxyManager.getRepresentation(source, this.view);
        if (rep && srcColorBy) {
          const { array, location } = srcColorBy;
          rep.setColorBy(array, location);
        }
      });
    },

    resizeLater() {
      this.$nextTick(() => this.onResize());
    },

    onResize() {
      if (this.view && this.view.getContainer()) {
        // re-implemented from ViewProxy, since we don't
        // want camera reset from view.renderLater()
        const container = this.view.getContainer();
        const glrw = this.view.getOpenglRenderWindow();
        const dims = container.getBoundingClientRect();
        if (dims.width > 0 && dims.height > 0) {
          const pixelRatio = window.devicePixelRatio ?? 1;
          const width = Math.max(10, Math.floor(pixelRatio * dims.width));
          const height = Math.max(10, Math.floor(pixelRatio * dims.height));
          glrw.setSize(width, height);
          this.view.invokeResize({ width, height });
          this.render();
        }
      }
    },

    resetCamera() {
      if (this.view) {
        this.view.resetCamera();
      }
    },

    render() {
      this.view.getRenderWindow().render();
    },
  },
};
