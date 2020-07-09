import { mapState, mapGetters } from 'vuex';
import vtkWidgetManager from 'vtk.js/Sources/Widgets/Core/WidgetManager';

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
    }),
    sceneSources() {
      return this.sceneObjectIDs
        .filter((id) => id in this.vizPipelines)
        .map((id) => this.vizPipelines[id].transformFilter);
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
  },

  mounted() {
    this.$eventBus.$on('resize', this.resizeLater);
    this.view = null;
    this.debouncedRender = null;
    this.remountView();
  },

  beforeDestroy() {
    this.$eventBus.$off('resize', this.resizeLater);
    this.view = null;
    this.remountView();
  },

  methods: {
    beforeViewUnmount() {},
    afterViewMount() {},

    remountView() {
      if (this.view) {
        this.beforeViewUnmount();
        this.view.setContainer(null);
      }

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
        const container = this.$refs.vtkContainer;
        this.view.setContainer(container);
        this.view.getRenderer().setBackground(0, 0, 0);

        if (!this.view.getReferenceByName('widgetManager')) {
          const widgetManager = vtkWidgetManager.newInstance();
          widgetManager.setUseSvgLayer(true);
          widgetManager.setRenderer(this.view.getRenderer());
          this.view.set({ widgetManager }, true);
        }

        this.updateOrientation();
        this.updateScene();

        // let vue rendering settle before resizing canvas
        this.$nextTick(() => {
          this.onResize();
          this.resetCamera();
          this.render();
          this.afterViewMount();
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
        this.view.addRepresentation(rep);
      });
    },

    resizeLater() {
      this.$nextTick(() => this.onResize());
    },

    // TODO use REsizeobserer instead of eventBus
    onResize() {
      if (this.view) {
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
