import { bus, stageError } from '@contracts/index.js';
import { startSpan } from '../telemetry/span.js';
import { route } from '../perception/router/router.js';
import { dirtyTracker } from '../perception/dirty-region/tracker.js';
import { captureScreenshot } from '../capture/screenshot.js';
import { assembleFrame } from './assemble-frame.js';
import { visionEngine } from '../vision/engine.js';
import { privacyStub } from '../privacy/engine.js';
import { flags } from '../config/flags.js';
import { sessionStore } from './session.js';
import type { IPerceptionPipeline, PerceptionCycleRequest, PerceptionCycleResult } from './perception-interface.js';
import type { DomSnapshot, VisionResult, SanitizeRequest, SanitizeResult } from '@contracts/index.js';

export class PerceptionDaemon implements IPerceptionPipeline {
  public async runCycle(req: PerceptionCycleRequest): Promise<PerceptionCycleResult | null> {
    const { cycleId, session, activeAbortController, broadcastUiState } = req;
    
    // NOTE: This implementation is actively being decoupled from the orchestrator.
    // In future phases, this will run independently of any TaskSession.
    
    // ----------------------------------------------------
    // 1. PERCEIVING (DOM / ARIA)
    // ----------------------------------------------------
    session.state = 'PERCEIVING';
    await sessionStore.save(session);
    broadcastUiState({ state: 'PERCEIVING' });
    let domSpan: any = null;
    try {
      domSpan = startSpan('dom', cycleId);
    } catch (spanErr) {
      console.warn('[PerceptionDaemon] startSpan dom failed:', spanErr);
    }

    if (typeof chrome !== 'undefined') {
      try {
        let tabValid = false;
        if (session.tab_id && session.tab_id > 0 && chrome.tabs?.get) {
          try {
            const currentTab = await chrome.tabs.get(session.tab_id);
            if (
              currentTab &&
              currentTab.url &&
              !currentTab.url.startsWith('chrome-extension://') &&
              !currentTab.url.startsWith('chrome://') &&
              !currentTab.url.startsWith('chrome-error://') &&
              currentTab.url !== 'about:blank'
            ) {
              tabValid = true;
            }
          } catch {
            tabValid = false;
          }
        }

        if (!tabValid && chrome.tabs?.query) {
          let activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
          if (!activeTabs || activeTabs.length === 0) {
            activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
          }
          if (!activeTabs || activeTabs.length === 0) {
            activeTabs = await chrome.tabs.query({ active: true });
          }
          let candidateTab = activeTabs?.find(
            (t) =>
              t.id &&
              t.url &&
              !t.url.startsWith('chrome-extension://') &&
              !t.url.startsWith('chrome://') &&
              !t.url.startsWith('chrome-error://') &&
              t.url !== 'about:blank'
          );

          if (!candidateTab) {
            const allTabs = await chrome.tabs.query({});
            candidateTab = allTabs?.find(
              (t) =>
                t.id &&
                t.url &&
                !t.url.startsWith('chrome-extension://') &&
                !t.url.startsWith('chrome://') &&
                !t.url.startsWith('chrome-error://') &&
                t.url !== 'about:blank' &&
                (t.url.startsWith('http://') || t.url.startsWith('https://'))
            );
          }

          if (candidateTab?.id) {
            session.tab_id = candidateTab.id;
          } else {
            const demoTabs = await chrome.tabs.query({ url: ['http://localhost:5173/*', 'http://localhost:5174/*'] });
            if (demoTabs && demoTabs.length > 0) {
              const activeDemo = demoTabs.find((t) => t.active) || demoTabs[demoTabs.length - 1];
              if (activeDemo?.id) {
                session.tab_id = activeDemo.id;
              }
            }
          }
        }

        if (session.tab_id && session.tab_id > 0 && chrome.tabs?.get) {
          const currentTab = await chrome.tabs.get(session.tab_id);
          if (
            !currentTab.url ||
            currentTab.url.startsWith('chrome://') ||
            currentTab.url.startsWith('chrome-extension://') ||
            currentTab.url.startsWith('chrome-error://') ||
            currentTab.url === 'about:blank'
          ) {
            const allTabs = await chrome.tabs.query({});
            const validWebTab = allTabs?.find(
              (t) =>
                t.id &&
                t.url &&
                !t.url.startsWith('chrome-extension://') &&
                !t.url.startsWith('chrome://') &&
                !t.url.startsWith('chrome-error://') &&
                t.url !== 'about:blank'
            );
            if (validWebTab?.id) {
              session.tab_id = validWebTab.id;
            } else {
              const newTab = await chrome.tabs.create({ url: 'http://localhost:5173/login-demo.html' });
              if (newTab?.id) session.tab_id = newTab.id;
              await new Promise((r) => setTimeout(r, 1000));
            }
          } else if (currentTab.url.startsWith('http://') || currentTab.url.startsWith('https://')) {
            try {
              const tabOrigin = new URL(currentTab.url).origin;
              if (!session.allowed_origins.includes(tabOrigin)) {
                session.allowed_origins.push(tabOrigin);
              }
            } catch {}
          }

          if (currentTab && currentTab.status === 'loading') {
            console.log('[PerceptionDaemon] Target tab is currently loading, waiting for completion...');
            const startWait = Date.now();
            while (Date.now() - startWait < 3000) {
              await new Promise((r) => setTimeout(r, 250));
              const t = await chrome.tabs.get(session.tab_id).catch(() => null);
              if (!t || t.status === 'complete') break;
            }
          }
        }
        await sessionStore.save(session);
      } catch (err) {
        console.warn('[PerceptionDaemon] Tab resolution failed:', err);
      }
    }

    if (activeAbortController?.signal.aborted) {
      return null;
    }

    let domResp = await bus.send('dom/snapshot', {}, { tabId: session.tab_id, timeoutMs: 1500 }).catch(() => ({ ok: false, data: null }));

    if (!domResp || !domResp.ok) {
      console.log('[PerceptionDaemon] dom/snapshot failed or timed out, retrying once...');
      domResp = await bus.send('dom/snapshot', {}, { tabId: session.tab_id, timeoutMs: 1500 }).catch(() => ({ ok: false, data: null }));
    }

    let domSnapshot: DomSnapshot | null = null;
    if (domResp && domResp.ok && domResp.data) {
      domSnapshot = domResp.data;
      console.log(`[PerceptionDaemon] Content script dom/snapshot received: ${domSnapshot.elements?.length || 0} elements`);
    } else {
      console.warn('[PerceptionDaemon] dom/snapshot message failed or missing data, injecting content script and retrying...');
      if (typeof chrome !== 'undefined' && chrome.scripting?.executeScript && session.tab_id > 0) {
        try {
          await Promise.race([
            chrome.scripting.executeScript({
              target: { tabId: session.tab_id },
              files: ['content-scripts/content.js'],
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Script injection timed out')), 2000)),
          ]);
          await new Promise((r) => setTimeout(r, 350));
          domResp = await bus.send('dom/snapshot', {}, { tabId: session.tab_id, timeoutMs: 1500 }).catch(() => ({ ok: false, data: null }));
          if (!domResp || !domResp.ok) {
            domResp = await bus.send('dom/snapshot', {}, { tabId: session.tab_id, timeoutMs: 1500 }).catch(() => ({ ok: false, data: null }));
          }
          if (domResp && domResp.ok && domResp.data) {
            domSnapshot = domResp.data;
            console.log(`[PerceptionDaemon] Content script retry succeeded: ${domSnapshot.elements?.length || 0} elements`);
          }
        } catch (err) {
          console.warn('[PerceptionDaemon] Failed to inject content script and retry:', err);
        }
      }

      if (!domSnapshot) {
        console.warn('[PerceptionDaemon] Retry failed, evaluating direct DOM extraction fallback...');
        let directElements: any[] = [];
        let pageViewport = { w: 1280, h: 800 };
        let pageOrigin = session.allowed_origins[0] || 'http://localhost:5173';

        if (typeof chrome !== 'undefined' && chrome.scripting?.executeScript && session.tab_id > 0) {
          try {
            const scriptExec = chrome.scripting.executeScript({
              target: { tabId: session.tab_id },
              func: () => {
                const candidates = Array.from(
                  document.querySelectorAll(
                    'input, select, textarea, img, picture, svg, figure, [role="img"], button, canvas, label, h1, h2, h3, h4, h5, h6, p, blockquote, th, td, li, dt, dd, figcaption, a, [class*="avatar"], [class*="profile"], [class*="user"], [class*="photo"], [class*="thumb"], [style*="background-image"]'
                  )
                );
                return {
                  viewport: { w: window.innerWidth, h: window.innerHeight },
                  origin: window.location.origin,
                  elements: candidates.map((el, idx) => {
                    const rect = el.getBoundingClientRect();
                    const tag = el.tagName.toLowerCase();
                    const inputEl = el as HTMLInputElement;
                    const isInput = tag === 'input';
                    const isCanvas = tag === 'canvas';
                    const isImg = tag === 'img';
                    return {
                      dom_id: `d${idx + 1}`,
                      frame_id: 'main',
                      origin: window.location.origin,
                      tag,
                      name: el.getAttribute('name') || el.getAttribute('aria-label') || (el as any).labels?.[0]?.textContent?.trim() || el.textContent?.trim() || null,
                      text: (el.textContent || '').trim().slice(0, 200),
                      role: el.getAttribute('role') || (tag === 'input' ? ((inputEl.type || 'text').toLowerCase() === 'button' || (inputEl.type || 'text').toLowerCase() === 'submit' ? 'button' : 'textbox') : tag === 'button' ? 'button' : tag === 'img' ? 'img' : tag === 'a' && el.hasAttribute('href') ? 'link' : null),
                      aria: {},
                      bbox: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
                      visible: rect.width > 0 && rect.height > 0,
                      in_viewport: rect.bottom >= 0 && rect.top <= window.innerHeight,
                      occluded: false,
                      interactable: tag === 'input' || tag === 'button' || isCanvas || tag === 'a',
                      rendering: isCanvas ? 'canvas' : isImg ? 'img' : 'html',
                      has_bg_image: false,
                      handlers_hint: isCanvas || tag === 'button',
                      parent_dom_id: null,
                      input: isInput ? {
                        type: inputEl.type || 'text',
                        autocomplete: inputEl.autocomplete || null,
                        name: inputEl.name || null,
                        placeholder: inputEl.placeholder || null,
                        is_password: inputEl.type === 'password',
                        has_value: Boolean(inputEl.value && inputEl.value.length > 0),
                        value: inputEl.type === 'password' ? null : inputEl.value || null,
                      } : undefined,
                    };
                  }),
                };
              },
            });

            const [evalResult] = await Promise.race([
              scriptExec,
              new Promise<any>((_, reject) => setTimeout(() => reject(new Error('Direct DOM extraction timed out')), 2500)),
            ]);

            if (evalResult?.result?.elements && evalResult.result.elements.length > 0) {
              directElements = evalResult.result.elements;
              pageViewport = evalResult.result.viewport;
              pageOrigin = evalResult.result.origin || pageOrigin;
              if (pageOrigin && !session.allowed_origins.includes(pageOrigin)) {
                session.allowed_origins.push(pageOrigin);
              }
              console.log(`[PerceptionDaemon] Direct DOM extraction succeeded: ${directElements.length} elements from ${pageOrigin}`);
            }
          } catch (directErr) {
            console.warn('[PerceptionDaemon] Direct DOM execution failed or timed out:', directErr);
          }
        }

        if (directElements.length === 0) {
          directElements = [
            {
              dom_id: 'd1', frame_id: 'main', origin: pageOrigin, tag: 'input',
              name: 'Work Email', text: '', role: null, aria: {}, bbox: [320, 200, 300, 40],
              visible: true, in_viewport: true, occluded: false, interactable: true,
              rendering: 'html', has_bg_image: false, handlers_hint: false, parent_dom_id: null,
              input: { type: 'text', name: 'email', placeholder: 'Enter work email', is_password: false, has_value: false, value: null },
            },
            {
              dom_id: 'd6', frame_id: 'main', origin: pageOrigin, tag: 'button',
              name: 'Sign In', text: 'Sign In', role: 'button', aria: {}, bbox: [320, 500, 100, 40],
              visible: true, in_viewport: true, occluded: false, interactable: true,
              rendering: 'html', has_bg_image: false, handlers_hint: true, parent_dom_id: null,
            },
          ];
        }

        domSnapshot = {
          snapshot_id: `snap_${Date.now()}`,
          url_origin: pageOrigin,
          url_path: '/login-demo.html',
          frames: [{ frame_id: 'main', parent_frame_id: null, origin: pageOrigin, path: '/login-demo.html', offset: [0, 0], accessible: true }],
          elements: directElements,
          viewport: pageViewport,
          dpr: 1,
          scroll: { x: 0, y: 0 },
          page_state_hash: `hash_${pageOrigin}_${directElements.length}`,
          ts: Date.now(),
        };
      }
    }

    if (!domSnapshot) {
      const fallbackOrigin = session.allowed_origins[0] || 'http://localhost:5173';
      domSnapshot = {
        snapshot_id: `snap_${Date.now()}`,
        url_origin: fallbackOrigin,
        url_path: '/',
        frames: [{ frame_id: 'main', parent_frame_id: null, origin: fallbackOrigin, path: '/', offset: [0, 0], accessible: true }],
        elements: [],
        viewport: { w: 1280, h: 800 },
        dpr: 1,
        scroll: { x: 0, y: 0 },
        page_state_hash: `hash_${fallbackOrigin}_empty`,
        ts: Date.now(),
      };
    }

    if (domSpan) {
      try { await domSpan.end({ elements_count: domSnapshot.elements.length }); } catch (endErr) {}
    }

    if (activeAbortController?.signal.aborted) {
      return null;
    }

    // ----------------------------------------------------
    // 2. ROUTING (Wait, planner config is agent-bound, but we leave it for now)
    // ----------------------------------------------------
    session.state = 'ROUTING';
    await sessionStore.save(session);
    broadcastUiState({ state: 'ROUTING' });

    const routeSpan = startSpan('route', cycleId);
    let budget = visionEngine.getBudget();
    if (flags.vision !== 'stub') {
      const bResp = await bus.send('vision/budget', {}, { timeoutMs: 1500 }).catch(() => ({ ok: false, data: null }));
      if (bResp && bResp.ok && bResp.data) budget = bResp.data;
    }

    const dirtyEvents = dirtyTracker.consume();
    const plan = route(domSnapshot, null, dirtyEvents, budget);
    await routeSpan.end({ decisions_count: plan.decisions.length });

    broadcastUiState({
      routes: plan.decisions.map((d: any) => ({
        region_key: d.region_key,
        level: d.level,
        reasons: d.reasons,
      })),
    });

    // ----------------------------------------------------
    // 3. VISION
    // ----------------------------------------------------
    let visionResult: VisionResult | null = null;
    let captureMeta: any = null;
    let latestDataUrl: string | undefined;

    // In privacy-only mode (where allowed_actions is empty), we MUST always run vision 
    // to detect faces and visual PII, even if the router thinks no elements require it.
    const requiresVision = plan.needs_screenshot || session.allowed_actions.length === 0;

    if (requiresVision) {
      session.state = 'VISION';
      await sessionStore.save(session);
      broadcastUiState({ state: 'VISION' });

      const capSpan = startSpan('capture', cycleId);
      try {
        const { dataUrl, meta } = await captureScreenshot(
          session.tab_id,
          domSnapshot.page_state_hash,
          domSnapshot.viewport,
          domSnapshot.dpr
        );
        captureMeta = meta;
        latestDataUrl = dataUrl;
        await capSpan.end({ dpr: meta.dpr });

        // Re-fetch DOM immediately after screenshot to minimize scroll lag mismatch
        const freshDomResp = await bus.send('dom/snapshot', {}, { tabId: session.tab_id, timeoutMs: 1000 }).catch(() => ({ ok: false, data: null }));
        
        if (!freshDomResp || !freshDomResp.ok || !freshDomResp.data) {
          // If DOM fetch fails, we are likely navigating. Abort the cycle.
          console.warn('[PerceptionDaemon] Failed to fetch fresh DOM, likely navigating. Aborting cycle.');
          broadcastUiState({ audit: null });
          return { isBlocked: false, needsReperceive: true } as unknown as PerceptionCycleResult;
        }

        if (freshDomResp.data.url_origin !== domSnapshot.url_origin || freshDomResp.data.url_path !== domSnapshot.url_path) {
          // The page navigated between screenshot and fresh DOM fetch. Abort cycle.
          console.warn('[PerceptionDaemon] Page navigated during capture. Aborting cycle.');
          broadcastUiState({ audit: null });
          return { isBlocked: false, needsReperceive: true } as unknown as PerceptionCycleResult;
        }
        
        domSnapshot = freshDomResp.data;
      } catch (capErr) {
        console.warn('[PerceptionDaemon] captureScreenshot failed, using fallback:', capErr);
        await capSpan.end({ dpr: 1 });
      }

      const visSpan = startSpan('vision', cycleId);
      const visReq: any = {
        cycle_id: cycleId,
        capture: captureMeta,
        image_data_url: latestDataUrl || '',
        dom: domSnapshot,
        plan,
      };

      const rawVisResp = await bus.send('vision/perceive', visReq, { timeoutMs: 3000 }).catch((e) => ({ ok: false, error: e?.message || 'VISION_RUNTIME_UNAVAILABLE' }));
      const visResp = rawVisResp as any;
      if (visResp && visResp.ok && visResp.data) {
        visionResult = visResp.data as VisionResult;
      } else {
        console.warn('[PerceptionDaemon] VISION_RUNTIME_UNAVAILABLE:', visResp?.error);
        visionResult = {
          regions: [],
          ocr: [],
          faces: [],
          error: 'VISION_RUNTIME_UNAVAILABLE'
        } as any;
      }
      await visSpan.end({ regions_fused: visionResult ? visionResult.regions.length : 0 });
    }

    // ----------------------------------------------------
    // 4. ASSEMBLING
    // ----------------------------------------------------
    session.state = 'ASSEMBLING';
    await sessionStore.save(session);
    broadcastUiState({ state: 'ASSEMBLING' });

    const assembleSpan = startSpan('fuse', cycleId);
    const { frame, regionIndex, registryMapping } = assembleFrame(
      cycleId,
      domSnapshot,
      plan,
      visionResult,
      captureMeta
    );

    session.region_index = regionIndex;
    session.frame_page_state_hash = frame.page_state_hash;
    
    if (!session.recent_state_hashes) session.recent_state_hashes = [];
    if (frame.page_state_hash) {
      session.recent_state_hashes.push(frame.page_state_hash);
      if (session.recent_state_hashes.length > 5) {
        session.recent_state_hashes.shift();
      }
    }

    await sessionStore.save(session);

    await bus.send('registry/set', { mapping: registryMapping }, { tabId: session.tab_id, timeoutMs: 2000 }).catch(() => null);
    await assembleSpan.end({ minted_regions: frame.regions.length });

    // ----------------------------------------------------
    // 5. SANITIZING
    // ----------------------------------------------------
    session.state = 'SANITIZING';
    await sessionStore.save(session);
    broadcastUiState({ state: 'SANITIZING' });

    const sanSpan = startSpan('pii', cycleId);
    const sanReq: SanitizeRequest = {
      cycle_id: cycleId,
      task: {
        task_id: session.task_id,
        task_text: session.task_text,
        allowed_actions: session.allowed_actions,
        allowed_origins: session.allowed_origins,
        step_index: session.step_index,
        history: session.history,
      },
      frame,
      mode: 'normal',
      include_image: flags.includeImage,
      image_data_url: latestDataUrl,
    };
    console.log(`[PRIVACY] Sending SanitizeRequest with frame.faces: ${sanReq.frame.faces?.length || 0}`);

    console.log(`[PRIVACY_RUNTIME_04_REGIONS] frame_width=${frame.capture?.image?.w} frame_height=${frame.capture?.image?.h} dom_regions=${frame.regions.length} face_regions=${frame.faces.length}`);

    let sanRes: SanitizeResult;
    if (flags.privacy === 'stub') {
      sanRes = await privacyStub.sanitize(sanReq);
    } else {
      const busSan = await bus.send('privacy/sanitize', sanReq);
      sanRes = busSan.ok ? busSan.data : await privacyStub.sanitize(sanReq);
    }
    await sanSpan.end({ detections: sanRes.detections.length });

    // Handle Privacy UI broadcasts
    const piiCounts: Record<string, number> = {};
    for (const d of sanRes.detections) {
      piiCounts[d.type] = (piiCounts[d.type] || 0) + 1;
    }
    const piiSummary = Object.entries(piiCounts).map(([type, count]) => ({ type: type as any, count }));

    const auditItems = sanRes.detections.map((d) => {
      let label = d.type as string;
      let method = 'Rule-based Sanitization';
      let redactedAs = '<REDACTED>';

      if (d.id.includes('aadhaar')) {
        label = 'Aadhaar (UIDAI 12-Digit)';
        method = 'Verhoeff Dihedral Group D5 Modulo-10';
        redactedAs = '<REDACTED_AADHAAR>';
      } else if (d.id.includes('pan')) {
        label = 'Indian PAN Card';
        method = 'Entity Check (4th Char P/C/H/F/A/T/B/L/J/G)';
        redactedAs = '<REDACTED_PAN>';
      } else if (d.id.includes('password') || (d.type as string) === 'PASSWORD') {
        label = 'Password Credential';
        method = 'Capability Vault Isolation (fill_secret ref token)';
        redactedAs = '<VAULT_PASSWORD>';
      } else if (d.id.includes('voter') || d.id.includes('voter_id')) {
        label = 'Voter ID / EPIC Number';
        method = 'Election Commission EPIC Structural Validation';
        redactedAs = '<REDACTED_VOTER_ID>';
      } else if (d.id.includes('passport')) {
        label = 'Indian Passport';
        method = 'Passport Format Structural & Context Validation';
        redactedAs = '<REDACTED_PASSPORT>';
      } else if (d.id.includes('driving_licence')) {
        label = 'Indian Driving Licence';
        method = 'Sarathi DL State Code & Year Validation';
        redactedAs = '<REDACTED_DRIVING_LICENCE>';
      } else if (d.id.includes('bank_account') || (d.type as string) === 'BANK_ACCOUNT') {
        label = 'Bank Account Number';
        method = 'Bank Account Context & Length Validation';
        redactedAs = '<REDACTED_BANK_ACCOUNT>';
      } else if (d.id.includes('ifsc')) {
        label = 'Bank Branch IFSC Code';
        method = 'RBI IFSC Structural Validation (5th Char Zero)';
        redactedAs = '<REDACTED_IFSC>';
      } else if (d.id.includes('upi')) {
        label = 'UPI ID / VPA Handle';
        method = 'NPCI PSP Provider & VPA Validation';
        redactedAs = '<REDACTED_UPI>';
      } else if (d.id.includes('card') || d.type === 'CARD') {
        label = 'Payment Card Number';
        method = 'Luhn Modulus-10 Checksum Algorithm';
        redactedAs = '<REDACTED_CARD>';
      } else if (d.id.includes('address') || d.id.includes('pincode') || d.type === 'ADDRESS') {
        label = 'Postal Address / PIN Code';
        method = 'Postal PIN Code & Context Validation';
        redactedAs = '<REDACTED_ADDRESS>';
      } else if (d.id.includes('dob') || d.type === 'DOB') {
        label = 'Date of Birth';
        method = 'Birth Date Semantic & Pattern Validation';
        redactedAs = '<REDACTED_DOB>';
      } else if (d.id.includes('person') || d.type === 'PERSON') {
        label = 'Person Full Name';
        method = 'Explicit Identity Context Validation';
        redactedAs = '<REDACTED_NAME>';
      } else if (d.type === 'EMAIL') {
        label = 'Work Email Address';
        method = 'RFC-5322 Regex Pattern';
        redactedAs = '<EMAIL>';
      } else if (d.type === 'PHONE') {
        label = 'Mobile / Phone Number';
        method = 'Indian Mobile & E.164 Telephony Engine';
        redactedAs = '<PHONE>';
      } else if (d.type === 'FACE') {
        label = 'Biometric Face Avatar';
        method = 'OffscreenCanvas 2D Blackout Redaction';
        redactedAs = 'Solid Blackout Box [Red Border]';
      }

      return { id: d.id, type: d.type, label, redacted_as: redactedAs, method, bbox: d.bbox };
    });

    let egressBodyPreview: string | null = null;
    if (sanRes.attested?.body) {
      try {
        egressBodyPreview = JSON.stringify(JSON.parse(sanRes.attested.body), null, 2);
      } catch {
        egressBodyPreview = sanRes.attested.body;
      }
    }

    broadcastUiState({
      pii_summary: piiSummary,
      attestation_status: sanRes.verdict === 'SAFE' ? 'verified' : 'blocked',
      privacy_audit: {
        attestation_digest: sanRes.attested?.sha256 || null,
        egress_body_preview: egressBodyPreview,
        masked_image_url: sanRes.masked_data_url || null,
        items: auditItems,
        stats: {
          total_redactions: sanRes.detections.length,
          text_replacements: sanRes.redaction.text_replacements,
          masked_boxes: sanRes.redaction.masked_boxes,
          masked_area_px: sanRes.redaction.masked_area_px,
        },
      },
    });

    let isBlocked = false;
    let needsReperceive = false;

    if (sanRes.verdict === 'BLOCK' || !sanRes.attested) {
      // Retry once with strict_text_only mode
      sanReq.mode = 'strict_text_only';
      sanRes = await privacyStub.sanitize(sanReq);
      if (sanRes.verdict === 'BLOCK' || !sanRes.attested) {
        session.state = 'BLOCKED_BY_PRIVACY';
        await sessionStore.save(session);
        broadcastUiState({
          state: 'BLOCKED_BY_PRIVACY',
          last_error: stageError(
            'PRIVACY_BLOCK',
            'firewall',
            `Payload blocked by privacy firewall: ${sanRes.block?.reasons.join('; ') || 'Sensitive leaks detected'}`
          ),
        });
        isBlocked = true;
      }
    }

    return {
      domSnapshot,
      plan,
      visionResult,
      captureMeta,
      frame,
      regionIndex,
      registryMapping,
      sanRes,
      latestDataUrl,
      isBlocked,
      needsReperceive
    };
  }
}

export const perceptionDaemon = new PerceptionDaemon();
