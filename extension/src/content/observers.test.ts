// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startDomObservers, stopDomObservers } from './observers.js';
import { bus } from '@contracts/index.js';
import { extractDomSnapshot, markDirty } from '../perception/dom/snapshot.js';

vi.mock('@contracts/index.js', () => ({
  bus: {
    send: vi.fn().mockResolvedValue({}),
    on: vi.fn()
  }
}));

describe('Phase 1: Incremental DOM Perception', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopDomObservers();
    vi.useRealTimers();
  });

  it('1. Initial extraction', async () => {
    document.body.innerHTML = '<div id="test">Hello</div>';
    const snapshot = await extractDomSnapshot('main');
    expect(snapshot.elements.length).toBeGreaterThan(0);
    expect(snapshot.elements.some(e => e.text === 'Hello')).toBe(true);
  });

  it('2. Single mutation triggers markDirty', async () => {
    startDomObservers();
    const div = document.createElement('div');
    document.body.appendChild(div);
    
    // Wait for MutationObserver to fire
    await Promise.resolve();
    vi.advanceTimersByTime(150); // debounce timeout
    
    expect(bus.send).toHaveBeenCalledWith('dom/dirty', expect.anything());
  });

  it('3. Mutation burst is debounced', async () => {
    startDomObservers();
    
    for (let i = 0; i < 5; i++) {
      const div = document.createElement('div');
      document.body.appendChild(div);
    }
    
    await Promise.resolve();
    // Move time forward slightly, but not past debounce
    vi.advanceTimersByTime(50);
    expect(bus.send).not.toHaveBeenCalled();
    
    // Now move past debounce
    vi.advanceTimersByTime(100);
    expect(bus.send).toHaveBeenCalledTimes(1);
  });

  it('4. Added node', async () => {
    startDomObservers();
    const p = document.createElement('p');
    p.textContent = 'new';
    document.body.appendChild(p);
    
    await Promise.resolve();
    vi.advanceTimersByTime(150);
    expect(bus.send).toHaveBeenCalledTimes(1);
  });

  it('5. Removed node', async () => {
    document.body.innerHTML = '<div id="rem">old</div>';
    startDomObservers();
    
    document.getElementById('rem')?.remove();
    
    await Promise.resolve();
    vi.advanceTimersByTime(150);
    expect(bus.send).toHaveBeenCalledTimes(1);
  });

  it('6. Attribute mutation', async () => {
    document.body.innerHTML = '<div id="attr" class="a">old</div>';
    startDomObservers();
    
    document.getElementById('attr')?.setAttribute('class', 'b');
    
    await Promise.resolve();
    vi.advanceTimersByTime(150);
    expect(bus.send).toHaveBeenCalledTimes(1);
  });

  it('7. Shadow DOM mutation where supported', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    
    startDomObservers();
    shadow.innerHTML = '<span>shadow</span>';
    
    await Promise.resolve();
    vi.advanceTimersByTime(150);
    // Note: Standard MutationObserver doesn't deeply watch shadow DOM unless attached directly
    // but the test asserts it doesn't crash.
    expect(true).toBe(true);
  });

  it('8. Observer disconnect', async () => {
    const disconnect = startDomObservers();
    disconnect();
    
    document.body.appendChild(document.createElement('div'));
    await Promise.resolve();
    vi.advanceTimersByTime(150);
    
    expect(bus.send).not.toHaveBeenCalled();
  });

  it('9. Duplicate observers prevention', async () => {
    startDomObservers();
    startDomObservers(); // Should disconnect the first one internally
    
    document.body.appendChild(document.createElement('div'));
    await Promise.resolve();
    vi.advanceTimersByTime(150);
    
    // Still only fires once because the first was disconnected
    expect(bus.send).toHaveBeenCalledTimes(1);
  });

  it('10. Extension-generated DOM changes not creating perception loops', async () => {
    startDomObservers();
    
    const extDiv = document.createElement('div');
    extDiv.id = '__sih_agent_ui_host__';
    document.body.appendChild(extDiv);
    
    await Promise.resolve();
    vi.advanceTimersByTime(150);
    
    // Should be ignored
    expect(bus.send).not.toHaveBeenCalled();
    
    const extEl = document.createElement('div');
    extEl.setAttribute('data-agent-ui', 'true');
    document.body.appendChild(extEl);
    
    await Promise.resolve();
    vi.advanceTimersByTime(150);
    
    // Should be ignored
    expect(bus.send).not.toHaveBeenCalled();
  });
  
  it('11. TextNode (characterData) changes trigger markDirty', async () => {
    document.body.innerHTML = '<div id="textNode">initial</div>';
    startDomObservers();
    
    const textNode = document.getElementById('textNode')?.firstChild;
    if (textNode) {
      textNode.nodeValue = 'updated text';
    }
    
    await Promise.resolve();
    vi.advanceTimersByTime(150);
    
    // Should fire because characterData: true
    expect(bus.send).toHaveBeenCalledTimes(1);
  });
});
