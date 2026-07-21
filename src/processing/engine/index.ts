// ---------------------------------------------------------------------------
// Processing engine.
//
// ONE engine, ZERO per-backend client code. It renders the parameter form from
// a server-emitted, zod-validated task spec and routes all HTTP through the
// bearer-aware `$fetch` over the paired backend's one fixed set of routes. The
// provider factory composes a provider from these pieces; core VolView consumes
// the provider contract only.
// ---------------------------------------------------------------------------

export * from './transport';
export * from './taskSpec';
export * from './formModel';
export * from './mintInput';
export * from './bounds';
export * from './resultToIntent';
