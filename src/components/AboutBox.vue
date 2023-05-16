<template>
  <v-card class="py-4">
    <v-btn
      variant="text"
      class="close-button"
      icon="mdi-close"
      @click="$emit('close')"
    />
    <v-card-title class="d-flex flex-row justify-center">
      <vol-view-full-logo />
    </v-card-title>
    <v-card-text>
      <h2>Version Info</h2>
      <v-divider class="mb-2" />
      <ul class="pl-6">
        <li>
          <div class="d-flex flex-flow align-center text-no-wrap">
            <span>VolView:</span>
            <v-badge class="pl-1" inline :content="versions.volview" />
          </div>
        </li>
        <li>
          <div class="d-flex flex-flow align-center text-no-wrap">
            <span>vtk.js:</span>
            <v-badge class="pl-1" inline :content="versions['vtk.js']" />
          </div>
        </li>
        <li>
          <div class="d-flex flex-flow align-center text-no-wrap">
            <span>itk-wasm:</span>
            <v-badge class="pl-1" inline :content="versions['itk-wasm']" />
          </div>
        </li>
      </ul>
      <h2 class="mt-2">About</h2>
      <v-divider class="mb-2" />
      <p class="float-right">
        <v-img
          v-show="!mobile"
          src="../assets/KitwareHeadAndNeck.jpg"
          alt="Head and neck CT rendering"
          width="200px"
          class="ma-1"
          align="center"
        /><br />
      </p>
      <p>
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://volview.kitware.com/"
        >
          <span>VolView</span>
        </a>
        is an open-source web application developed at
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://kitware.com/"
        >
          <span>Kitware</span>
        </a>
        for visualizing and annotating medical images. It key features include:
      </p>

      <ul class="pl-6">
        <li>Fast: Drag-and-drop DICOM files for quick viewing</li>
        <li>
          Beautiful: Cinematic volume rendering to generate high-quality 3D
          visualizations
        </li>
        <li>
          Friendly: Familiar radiological image visualization and annotation
          tools
        </li>
        <li>
          Secure: Your data stays on your machine. No cloud services or data
          servers are used.
        </li>
      </ul>
      <br />
      VolView is freely available for research, educational, and commercial
      applications. It is built using a variety of open-source toolks created by
      Kitware, such as
      <a
        rel="noopener noreferrer"
        target="_blank"
        href="https://github.com/InsightSoftwareConsortium/itk-wasm/"
      >
        <span>itk-wasm</span>
      </a>
      for DICOM I/O and image processing, and
      <a
        rel="noopener noreferrer"
        target="_blank"
        href="https://github.com/Kitware/vtk-js"
      >
        <span>vtk.js</span>
      </a>
      for in-browser scientific visualization.
      <br />
      <br />
      Want help customizing VolView or creating a new web-based visualization
      application?
      <a
        rel-="noopener noreferrer"
        target="_blank"
        href="https://www.kitware.com/contact/project/"
        >Contact Kitware!</a
      >
      <br />
      <br />
      VolView source code:
      <ul class="pl-6">
        <li>
          <a
            rel="noopener noreferrer"
            target="_blank"
            href="https://github.com/Kitware/VolView"
          >
            https://github.com/Kitware/VolView
          </a>
        </li>
      </ul>
      <br />
      VolView bug reports and feature requests:
      <ul class="pl-6">
        <li>
          <a
            rel="noopener noreferrer"
            target="_blank"
            href="https://github.com/Kitware/VolView/issues"
          >
            https://github.com/Kitware/VolView/issues
          </a>
        </li>
      </ul>
      <br />
      This work was funded, in part, by the NIH via NIBIB and NIGMS R01EB021396,
      NIBIB R01EB014955, NCI R01CA220681, and NINDS R42NS086295
      <br />
      <br />
      Sample data provided by the following sources:
      <ul class="pl-6">
        <li>
          PROSTATEx Challenge Data: Geert Litjens, Oscar Debats, Jelle Barentsz,
          Nico Karssemeijer, and Henkjan Huisman. "ProstateX Challenge data",
          The Cancer Imaging Archive (2017). DOI: 10.7937/K9TCIA.2017.MURS5CL
          (<a
            rel="noopener noreferrer"
            target="_blank"
            href="https://wiki.cancerimagingarchive.net/pages/viewpage.action?pageId=23691656"
            >TCIA</a
          >)
        </li>
        <li>
          MRA Head and Neck: Test case 98890234 from the "Patient Contributed
          Image Repository" (<a
            rel="noopener noreferrer"
            target="_blank"
            href="http://www.pcir.org/researchers/98890234_20030505_MR.html"
            >PCIR.org</a
          >)
        </li>
        <li>
          3D ultrasound of a fetus: Sample data from
          <a
            rel="noopener noreferrer"
            target="_blank"
            href="http://tomovision.comi"
            >tomovision.com</a
          >
        </li>
      </ul>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.close-button {
  position: absolute;
  right: 12px;
  top: 12px;
}
</style>

<script>
import { defineComponent } from 'vue';
import { useDisplay } from 'vuetify';
import pkgLock from '@/package-lock.json';
import VolViewFullLogo from './icons/VolViewFullLogo.vue';

export default defineComponent({
  name: 'AboutBox',
  components: {
    VolViewFullLogo,
  },
  setup() {
    const display = useDisplay();

    return {
      mobile: display.xs,
      versions: {
        volview: pkgLock.version,
        'vtk.js': pkgLock.dependencies['@kitware/vtk.js'].version,
        'itk-wasm': pkgLock.dependencies['itk-wasm'].version,
      },
    };
  },
});
</script>
