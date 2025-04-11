# VolView Technical Guidelines

## State Management

- Use Pinia stores (`defineStore`) for global state management
- Prefer composition API with `setup()` or `<script setup>` in Vue components
- Use `ref` and `computed` for reactive state
- Use the store pattern in `/src/store` directory for domain-specific state

## Typescript Types

- Create interfaces and types in domain-specific files
- Use the `Maybe<T>` type for nullable/undefined values
- Prefer explicit return types for functions

## Error Handling

- Use try/catch blocks for async operations
- Provide meaningful error messages
- Consider using the notification system for user-facing errors

## VTK.js Patterns

- Follow the vtk.js factory pattern for creating VTK objects
- Handle memory management properly by disposing of unused VTK objects
- Store VTK object references in non-reactive variables when appropriate

## ITK-Wasm Usage

- Use async/await when calling ITK-Wasm functions
- Convert between VTK and ITK image formats using `vtkITKHelper`
- Remember to set pipeline URLs for ITK modules
- Handle large data processing in web workers when possible

## Component Design

- Keep components focused on a single responsibility
- Use props for component configuration
- Emit events for parent communication
- Use composables for reusable logic
- Follow the existing component structure
