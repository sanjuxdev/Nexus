const domElementMap = new Map<string, WeakRef<Element>>();
const regionToDomMap = new Map<string, string>();

export const elementRegistry = {
  register(domId: string, el: Element): void {
    domElementMap.set(domId, new WeakRef(el));
  },

  get(domId: string): Element | null {
    const ref = domElementMap.get(domId);
    if (!ref) return null;
    const el = ref.deref();
    if (!el || !el.isConnected) {
      domElementMap.delete(domId);
      return null;
    }
    return el;
  },

  setRegionMapping(mapping: Record<string, string>): void {
    for (const [regionId, domId] of Object.entries(mapping)) {
      regionToDomMap.set(regionId, domId);
    }
  },

  getByRegionId(regionId: string): Element | null {
    const domId = regionToDomMap.get(regionId);
    if (!domId) return null;
    return this.get(domId);
  },

  clear(): void {
    domElementMap.clear();
    regionToDomMap.clear();
  },
};
