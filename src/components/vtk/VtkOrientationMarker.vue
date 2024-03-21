<script setup lang="ts">
import { inject } from 'vue';
import { VtkViewContext } from '@/src/components/vtk/context';
import { useOrientationMarker } from '@/src/core/vtk/useOrientationMarker';
import vtkAnnotatedCubeActor from '@kitware/vtk.js/Rendering/Core/AnnotatedCubeActor';
import AnnotatedCubePresets from '@kitware/vtk.js/Rendering/Core/AnnotatedCubeActor/Presets';

const view = inject(VtkViewContext);
if (!view) throw new Error('No VtkView');

const actor = vtkAnnotatedCubeActor.newInstance();
AnnotatedCubePresets.applyPreset('default', actor); // applies color
AnnotatedCubePresets.applyPreset('lps', actor);

useOrientationMarker(actor, view.interactor);
</script>

<template><slot></slot></template>
