/** localStorage wrapper from the prototype: never throws, falls back to the default. */
export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown): void {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable (private mode, blocked) */
    }
  },
};

export const today = (): string => new Date().toISOString().slice(0, 10);
