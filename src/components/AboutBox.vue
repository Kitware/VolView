<template>
  <v-card>
    <v-card-title class="d-flex flex-row justify-center">
      <vol-view-full-logo />
    </v-card-title>
    <v-card-text>
      <p align="center">
        <img
          src="../assets/KitwareHeadAndNeck.jpg"
          alt="Head and neck CT rendering"
          style="width: 200px"
          align="center"
        /><br />
      </p>
      <p>
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://volview.kitware.com/"
        >
          VolView
        </a>
        is an open-source web application developed at
        <a
          rel="noopener noreferrer"
          target="_blank"
          href="https://kitware.com/"
        >
          Kitware
        </a>
        for visualizing and annotating medical images. It key features include:
      </p>

      <ul>
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
        itk-wasm
      </a>
      for DICOM I/O and image processing, and
      <a
        rel="noopener noreferrer"
        target="_blank"
        href="https://github.com/Kitware/vtk-js"
      >
        vtk.js
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
      <ul>
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
      <ul>
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
      <ul>
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
      <v-divider class="my-4" />
      <p>Current versions:</p>
      <ul>
        <li>VolView: {{ versions.volview }}</li>
        <li>vtk.js: {{ versions['vtk.js'] }}</li>
        <li>itk-wasm: {{ versions['itk-wasm'] }}</li>
      </ul>
    </v-card-text>
  </v-card>
</template>

<script>
import { defineComponent } from 'vue';
import pkgLock from '@/package-lock.json';
import VolViewFullLogo from './icons/VolViewFullLogo.vue';

export default defineComponent({
  name: 'AboutBox',
  components: {
    VolViewFullLogo,
  },
  setup() {
    return {
      versions: {
        volview: pkgLock.version,
        'vtk.js': pkgLock.dependencies['@kitware/vtk.js'].version,
        'itk-wasm': pkgLock.dependencies['itk-wasm'].version,
      },
    };
  },
});
</script>
