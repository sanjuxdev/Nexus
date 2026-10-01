export interface RuntimeFlags {
  vision: 'stub' | 'real';
  privacy: 'stub' | 'real';
  server: 'mock' | 'live';
  includeImage: boolean;
  testHooks: boolean;
}

export const flags: RuntimeFlags = {
  vision: 'stub',
  privacy: 'stub',
  server: 'mock',
  includeImage: false,
  testHooks: typeof process !== 'undefined' ? process.env?.NODE_ENV === 'test' : true,
};
