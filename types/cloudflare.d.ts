// Minimal typing for the Worker runtime module (bindings and secrets).
declare module 'cloudflare:workers' {
  export const env: Record<string, any>;
}
