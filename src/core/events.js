// Tiny event bus. Every sim module talks to the outside through match.events.
export class EventBus {
  constructor() { this.handlers = new Map(); }
  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.off(name, fn);
  }
  off(name, fn) { this.handlers.get(name)?.delete(fn); }
  emit(name, payload) {
    const hs = this.handlers.get(name);
    if (hs) for (const fn of [...hs]) fn(payload);
    const all = this.handlers.get('*');
    if (all) for (const fn of [...all]) fn(name, payload);
  }
}
