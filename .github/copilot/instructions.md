# VolView Project Context

## Project Description

VolView is a web-based medical imaging application for 3D and multi-planar volume rendering, segmentation, and analysis. The application uses Vue.js for the UI, VTK.js for 3D rendering, and ITK-Wasm for image processing.

## Coding Guidelines

- Use TypeScript for type safety
- Follow Vue 3 Composition API patterns
- Maintain code organization with the existing store/components structure
- Use Pinia for state management
- Follow the existing naming conventions and code style
- Use async/await pattern for asynchronous operations
- Only add comments that describe why the code is there, not what the code is doing

## Key Technologies

- Vue.js (Vue 3)
- TypeScript
- Pinia for state management
- VTK.js for visualization
- ITK-Wasm for image processing
- Vite as the build tool

## File Structure Orientation

- `/src/components`: Vue components
- `/src/store`: Pinia stores
- `/src/actions`: Application actions
- `/src/vtk`: VTK.js related code
- `/src/io`: Data loading and processing
- `/src/types`: TypeScript definitions
- `/src/utils`: Utility functions

## Important Domain Concepts

- Label maps: 3D image masks used for segmentation
- Segment groups: Collections of label maps
- Volume rendering: 3D visualization of volumetric data
- Image processing: Operations on 3D medical images
- Medical imaging: DICOM, NIfTI, and other medical imaging formats

## Common Patterns

- Stores expose reactive state and actions
- Components use composables for shared functionality
- Image data is processed using ITK-Wasm pipelines
- Visualization is handled through VTK.js objects
