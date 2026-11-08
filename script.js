(() => {
  const canvas = document.querySelector('#construction-canvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    document.body.classList.remove('construction-active');
    canvas.remove();
    return;
  }
  /* DEV_ONLY_START:PROFILE_EDITOR */
  const drawer = document.querySelector('#inspect-drawer');
  const profileForm = document.querySelector('#profile-form');
  const formField = name => profileForm.querySelector(`[name="${name}"]`);
  const profile = {
    name: formField('name').value,
    role: formField('role').value,
    bio: formField('bio').value,
    email: formField('email').value
  };
  /* DEV_ONLY_END:PROFILE_EDITOR */
  const reducePreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const isMobile = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const PALETTE = ['#f87171', '#38bdf8', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#22d3ee'];
  const AGENT_NAMES = ['pixel', 'nova', 'orbit', 'atlas', 'echo', 'byte', 'muse', 'flux', 'neo', 'zero', 'iris', 'node', 'sage', 'wave'];
  const palette = ['#ff4b36', '#58c8ff', '#b7e46d', '#ff91d4', '#ffd166', '#9e8bff', '#f7f3e8', '#ff8c42', '#45e0c0', '#f15bb5', '#a8dadc', '#e9ff70'];
  const callsigns = ['DESIGNER', 'FRONTEND', 'MOTION', 'CONTENT', 'GridRunner', 'TypeSmith', 'ShapeShifter', 'FrameForge', 'Redline_01', 'CanvasPilot', 'GlyphWorks', 'SnapLogic'];
  const leadColors = ['#ed402e', '#38bdf8', '#34d399', '#fb7185'];
  const INTRO_PLAN = [
    { section: 'navigation', target: '.topbar', label: 'NAV_BAR', offset: 0, parts: [{ selector: '.brand' }, { selector: 'nav a', stagger: 145 }, { selector: '.menu-toggle', delay: 740 }] },
    { section: 'hero', target: '.hero-meta', label: 'ROLE_TAG', offset: 260, parts: [{ selector: '.hero-meta' }] },
    { section: 'hero', target: '.hello', label: 'GREETING', offset: 420, parts: [{ selector: '.hello', text: '.', speed: 42 }] },
    { section: 'hero', target: '.hero-name', label: 'NAME_FRAME', offset: 620, parts: [{ selector: '.hero-name', text: '.hero-name', speed: 46 }] },
    { section: 'hero', target: '.portfolio-outline', label: 'PORTFOLIO_TYPE', offset: 990, parts: [{ selector: '.portfolio-outline', text: '.portfolio-outline', speed: 34 }] },
    { section: 'hero', target: '.hero-bottom', label: 'INTRO_COPY', offset: 1260, parts: [{ selector: '.hero-bottom', text: '.hero-bottom p', speed: 17 }, { selector: '.round-link', delay: 180 }] },
    { section: 'hero', target: '.hero-portrait-card', label: 'AVATAR_MODULE', offset: 1380, parts: [{ selector: '.hero-portrait-card' }] },
    { section: 'hero', target: '.hero-stamp', label: 'SEAL_MARK', offset: 1670, parts: [{ selector: '.hero-stamp' }] }
  ];
  const allowedCursorCounts = new Set([20, 56, 100]);

  const state = {
    count: 56,
    targetCount: 20,
    agentLimit: 56,
    mode: 'collab',
    phase: 'void',
    sound: true,
    audio: null,
    reduced: reducePreference.matches,
    clock: 0,
    lastFrameAt: null,
    delta: 16.7,
    fps: 60,
    fpsSamples: [],
    lastFpsCheck: 0,
    agents: [],
    ripples: [],
    introTasks: [],
    introStarted: false,
    scrollDirty: false,
    sectionQueue: [],
    sectionBuilds: new Map(),
    nextAgentPair: 0,
    typeJobs: new Map(),
    countJobs: new Map(),
    layoutCache: { anchors: null, clickTargets: null, wireTargets: null, dirty: true, updatedAt: -1000 },
    observer: null,
    fallbackScrollHandler: null,
    mouse: { x: innerWidth / 2, y: innerHeight / 2, active: false },
    typing: null,
    typeSources: new WeakMap(),
    typedElements: new Set(),
    frame: 0,
    cinematic: {
      active: true,
      interrupted: false,
      phase: 'hero',
      phaseStartClock: 0,
      currentStopIndex: 0,
      scrollStartY: 0,
      scrollTargetY: 0,
      scrollStartClock: 0,
      scrollDuration: 0,
      bottomPauseUntil: 0
    }
  };

  const byId = id => document.getElementById(id);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const easeInOut = value => {
    const t = clamp(value, 0, 1);
    return t * t * t * (t * (6 * t - 15) + 10);
  };
  const nowMs = () => state.clock;

  function assignBuildParts() {
    const plans = {
      about: ['.section-kicker', '.about-grid', '.portrait-wrap', '.about-copy', '.education', '.school-line', '.interest-line'],
      projects: ['.section-kicker', '.section-title-row', '.project-grid', '.project-card'],
      toolkit: ['.section-kicker', 'h2', '.skills-list', '.skill-row', '.credentials'],
      experience: ['.section-kicker', 'h2', '.experience-item'],
      contact: ['.section-kicker', '.hello', 'h2', '.contact-cta', '.contact-links'],
      footer: [':scope > *']
    };
    document.querySelectorAll('[data-build-piece]').forEach(el => { el.dataset.buildPieceState = 'dormant'; });
    for (const [sectionName, selectors] of Object.entries(plans)) {
      const section = document.querySelector(`[data-build-section="${sectionName}"]`);
      if (!section) continue;
      selectors.forEach((selector, index) => {
        section.querySelectorAll(selector).forEach((el, itemIndex) => {
          if (!el.hasAttribute('data-build-piece')) el.dataset.buildPiece = `${sectionName}-${index}-${itemIndex}`;
        });
      });
    }
    document.querySelectorAll('.project-info h3,.project-info p,.about-copy h2,.contact h2,.experience h2,.section-title-row h2,.section-title-row p,.toolkit h2').forEach(el => {
      if (!el.hasAttribute('data-build-text')) el.dataset.buildText = 'content';
    });
  }

  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function makeAgents(count) {
    if (!allowedCursorCounts.has(count)) return;
    const previous = new Map(state.agents.map(agent => [agent.id, agent]));
    state.agentLimit = state.reduced ? 24 : isMobile ? 3 : ((navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ? 36 : 100);
    const activeCount = Math.min(count, state.agentLimit);
    state.agents = Array.from({ length: activeCount }, (_, index) => {
      const old = previous.get(index);
      const name = `${AGENT_NAMES[index % AGENT_NAMES.length]}_${String(index + 1).padStart(2, '0')}`;
      const color = PALETTE[index % PALETTE.length];
      const seed = 2.399 * index;
      const fontSize = count > 80 ? 4.2 : count > 40 ? 5.4 : 7;
      const badgeName = name;
      ctx.font = `700 ${fontSize}px "DM Mono",monospace`;
      const badgeWidth = ctx.measureText(badgeName).width + 5;
      if (old) {
        old.fontSize = fontSize;
        old.badgeName = badgeName;
        old.badgeWidth = badgeWidth;
        old.name = name;
        old.color = color;
        old.seed = seed;
        return old;
      }
      const angle = seed;
      const r = 18 + (index % 7) * 7;
      return {
        id: index, name, color, seed,
        x: innerWidth / 2 + Math.cos(angle) * r,
        y: innerHeight / 2 + Math.sin(angle) * r,
        vx: 0, vy: 0,
        history: [], targetKey: -1, lastClick: -10000, motion: null, restUntil: 0, slot: index,
        fontSize, badgeName, badgeWidth, visit: 0, pendingRipple: null, action: null
      };
    });
    state.count = count;
  }

  function phaseTiming() { return state.reduced ? { voidEnd: 120 } : { voidEnd: 350 }; }

  function phaseLabel(phase) {
    document.body.classList.toggle('phase-ambient', phase === 'ambient');
    document.body.classList.toggle('phase-wireframe', phase === 'wireframe');
    document.body.classList.toggle('phase-materialize', phase === 'materialize');
    if (phase === 'ambient') startSectionObserver();
  }

  function getRect(element) {
    if (!element || !element.isConnected) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2 || rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) return null;
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  }

  function initializeIntroTimeline() {
    if (state.introStarted) return;
    state.introStarted = true;
    state.introTasks = INTRO_PLAN.map((plan, index) => {
      const target = document.querySelector(plan.target);
      if (!target || getComputedStyle(target).display === 'none') return null;
      const rect = getRect(target);
      if (!rect) return null;
      const leadId = (2 * index) % state.targetCount;
      const partnerId = (leadId + 1) % state.targetCount;
      const lead = state.agents[leadId] || state.agents[index % state.agents.length];
      const partner = state.agents[partnerId] || state.agents[(index + 1) % state.agents.length];
      const durationFactor = state.reduced ? .16 : 1;
      const leadStart = { x: clamp(rect.x - 8, 8, innerWidth - 24), y: clamp(rect.y - 8, 8, innerHeight - 24) };
      const leadEnd = { x: clamp(rect.x + rect.w - 8, 8, innerWidth - 24), y: clamp(rect.y + rect.h - 8, 8, innerHeight - 24) };
      const partnerPoint = { x: clamp(rect.x + rect.w - 8, 8, innerWidth - 24), y: clamp(rect.y - 8, 8, innerHeight - 24) };
      const distance = Math.hypot(leadStart.x - lead.x, leadStart.y - lead.y);
      const moveDuration = state.reduced ? 60 : Math.round(clamp(260 + distance * .16 + ((index * 43) % 90), 280, 560));
      return {
        kind: 'intro', index, plan, target, rect, lead, partner, leadStart, leadEnd, partnerPoint,
        status: 'queued', startAt: state.clock + (state.reduced ? index * 20 : Math.round(plan.offset * .35)),
        moveDuration: Math.round(moveDuration * durationFactor), dragDuration: state.reduced ? 80 : 340 + (index % 3) * 60,
        confirmDuration: state.reduced ? 60 : 120, partIndex: 0, materializeAt: null, revealItems: [],
        label: plan.label, color: PALETTE[index % PALETTE.length]
      };
    }).filter(Boolean);
    state.nextMaterializeIndex = 0;
    if (!state.introTasks.length) {
      startCinematicTourDown(state.clock);
      return;
    }
    const targetAgents = state.agents.slice(0, state.targetCount);
    targetAgents.forEach((agent, index) => {
      const fractionX = ((index * .61803398875) % 1);
      const fractionY = ((index * .75487766625) % 1);
      const target = { x: 16 + fractionX * Math.max(40, innerWidth - 76), y: 80 + fractionY * Math.max(40, innerHeight - 150) };
      agent.motion = { from: { x: agent.x, y: agent.y }, to: target, startAt: state.clock + Math.min(450, index * 7), duration: state.reduced ? 60 : 680 + (index % 6) * 75 };
    });
    state.phase = 'wireframe';
    phaseLabel('wireframe');
  }

  function snapRipple(element, color = '#f4f1ea') {
    const rect = getRect(element);
    if (!rect) return;
    state.ripples.push({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2, start: nowMs(), color });
    if (state.ripples.length > 24) state.ripples.splice(0, state.ripples.length - 24);
    mechanicalClick();
  }

  function revealSection(section, instant = false) {
    if (!section || section.classList.contains('section-built')) return;
    section.classList.remove('section-building');
    section.classList.add('section-built');
    section.querySelectorAll('[data-build-piece]').forEach(el => el.classList.remove('piece-built'));
    if (instant) section.querySelectorAll('[data-build-piece]').forEach(el => el.classList.add('piece-built'));
    snapRipple(section, '#ed402e');
    state.layoutCache.dirty = true;
  }

  function revealPiece(element) {
    if (!element || element.classList.contains('piece-built')) return;
    element.classList.add('piece-built');
    snapRipple(element, element.closest('.toolkit') ? '#f3f0e9' : '#ed402e');
    element.querySelectorAll('[data-count]').forEach(counter => {
      if (!counter.closest('[data-build-piece]:not(.piece-built)')) countUp(counter);
    });
    if (element.hasAttribute('data-count')) countUp(element);
    if (element.matches('.portrait-wrap,.hero-portrait-card')) element.classList.add('scan-in');
    state.layoutCache.dirty = true;
  }

  function buildPieces(section) {
    return [...section.querySelectorAll('[data-build-piece]')].filter(el => el.closest('[data-build-section]') === section);
  }

  function prepareTyped(element) {
    if (!element || state.typeSources.has(element)) return [...element.querySelectorAll('.typed-char')];
    state.typeSources.set(element, [...element.childNodes].map(node => node.cloneNode(true)));
    state.typedElements.add(element);
    const plain = element.textContent.trim();
    if (!element.hasAttribute('aria-label')) element.setAttribute('aria-label', plain);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    let charIndex = 0;
    for (const textNode of textNodes) {
      const value = textNode.nodeValue;
      if (!value || !value.trim()) continue;
      const fragment = document.createDocumentFragment();
      for (const character of Array.from(value)) {
        const span = document.createElement('span');
        span.className = 'typed-char';
        span.dataset.charIndex = String(charIndex++);
        span.textContent = character;
        fragment.appendChild(span);
      }
      textNode.replaceWith(fragment);
    }
    element.dataset.typedPrepared = 'true';
    return [...element.querySelectorAll('.typed-char')];
  }

  function restoreTyped() {
    for (const element of state.typedElements) {
      const original = state.typeSources.get(element);
      if (original !== undefined && element.isConnected) {
        element.replaceChildren(...original.map(node => node.cloneNode(true)));
      }
      delete element.dataset.typedPrepared;
      element.classList.remove('is-typing');
    }
    state.typedElements.clear();
    state.typeSources = new WeakMap();
    state.typing = null;
  }

  function startTypewrite(element, speed = 25, startAt = state.clock) {
    if (!element) return 0;
    const chars = prepareTyped(element);
    if (!chars.length) return 0;
    element.classList.add('is-typing');
    const interval = state.reduced ? 1 : speed;
    if (state.reduced) {
      chars.forEach(char => char.classList.add('typed-in'));
      element.classList.remove('is-typing');
      return 0;
    }
    state.typeJobs.set(element, { element, chars, interval, startAt, revealed: 0 });
    return chars.length * interval + 160;
  }

  function updateTypeJobs(now) {
    state.typing = null;
    for (const [element, job] of state.typeJobs) {
      if (!element.isConnected) { state.typeJobs.delete(element); continue; }
      const nextCount = clamp(Math.floor((now - job.startAt) / job.interval) + 1, 0, job.chars.length);
      while (job.revealed < nextCount) {
        const index = job.revealed++;
        job.chars[index].classList.add('typed-in');
        state.typing = { element, char: job.chars[index], color: '#f4f1ea' };
        if (index % 7 === 0) mechanicalClick(true);
      }
      if (job.revealed > 0 && job.revealed < job.chars.length) state.typing = { element, char: job.chars[job.revealed - 1], color: '#f4f1ea' };
      if (job.revealed >= job.chars.length) {
        element.classList.remove('is-typing');
        state.typeJobs.delete(element);
      }
    }
  }

  function countUp(element) {
    if (!element || element.dataset.countRunning === 'true') return;
    const display = element.querySelector('.count-value');
    if (!display) return;
    const target = Number(element.dataset.count);
    const decimals = String(element.dataset.count).includes('.') ? 2 : 0;
    const suffix = element.dataset.suffix || '';
    const start = nowMs();
    const duration = state.reduced ? 100 : 820;
    element.dataset.countRunning = 'true';
    state.countJobs.set(element, { element, display, target, decimals, suffix, start, duration });
  }

  function updateCountJobs(now) {
    for (const [element, job] of state.countJobs) {
      if (!element.isConnected) { state.countJobs.delete(element); continue; }
      const progress = clamp((now - job.start) / job.duration, 0, 1);
      job.display.textContent = `${(job.target * easeInOut(progress)).toFixed(job.decimals)}${job.suffix}`;
      if (progress >= 1) {
        delete element.dataset.countRunning;
        state.countJobs.delete(element);
      }
    }
  }

  function initializeAudio() {
    if (state.audio) return state.audio;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    state.audio = new AudioContextClass();
    state.audio.resume?.();
    return state.audio;
  }

  function mechanicalClick(soft = false) {
    if (!state.sound || !state.audio) return;
    const audio = state.audio;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime;
    oscillator.type = soft ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(soft ? 660 : 1120, start);
    oscillator.frequency.exponentialRampToValueAtTime(soft ? 440 : 780, start + 0.035);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(soft ? 0.008 : 0.025, start + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.065);
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.07);
  }

  function addRevealItem(items, element, typedElement, speed, due, durationPadding = 260) {
    if (!element || getComputedStyle(element).display === 'none') return due;
    const chars = typedElement ? [...typedElement.textContent].length : 0;
    items.push({ element, typedElement, speed, due, done: false });
    return due + (state.reduced ? 35 : Math.max(220, chars * speed + durationPadding));
  }

  function introRevealItems(task, now) {
    const section = document.querySelector(`[data-build-section="${task.plan.section}"]`);
    const items = [];
    let due = now + 120;
    for (const part of task.plan.parts) {
      const elements = [...(section?.querySelectorAll(part.selector) || [])];
      elements.forEach((element, index) => {
        due += (part.delay || 0) * (state.reduced ? .12 : 1);
        const typedElement = part.text === '.' ? element : part.text ? (element.matches(part.text) ? element : element.querySelector(part.text)) : null;
        due = addRevealItem(items, element, typedElement, part.speed || 24, due);
        due += (part.stagger || 0) * (state.reduced ? .12 : 1);
      });
    }
    return items;
  }

  function sectionTypeTargets(piece) {
    if (piece.matches('.about-copy')) return [[piece.querySelector('h2'), 34], [piece.querySelector('[data-build-text="bio"]'), 8]];
    if (piece.matches('.section-title-row')) return [[piece.querySelector('h2'), 32], [piece.querySelector('p'), 9]];
    if (piece.matches('.toolkit > h2')) return [[piece, 30]];
    if (piece.matches('.project-card')) return [[piece.querySelector('.project-info h3'), 23], [piece.querySelector('.project-info p'), 6]];
    if (piece.matches('.experience-item')) return [[piece.querySelector('[data-build-text]'), 8]];
    if (piece.matches('.contact-cta,.contact h2,.hello')) return [[piece, 23]];
    return [...piece.querySelectorAll(':scope > [data-build-text]')].map(element => [element, 8]);
  }

  function sectionRevealItems(section, now) {
    const items = [];
    let due = now + 100;
    for (const piece of buildPieces(section)) {
      const textTargets = sectionTypeTargets(piece).filter(([element]) => element);
      const estimated = textTargets.reduce((total, [element, speed]) => total + [...element.textContent].length * (state.reduced ? 0 : speed) + 130, 0);
      items.push({ element: piece, typedTargets: textTargets, due, done: false });
      due += Math.max(state.reduced ? 100 : 300, estimated + 220);
    }
    return items;
  }

  function fireRevealItem(item, now) {
    revealPiece(item.element);
    if (item.typedTargets) {
      let start = now + 100;
      for (const [element, speed] of item.typedTargets) {
        const duration = startTypewrite(element, speed, start);
        start += duration + (state.reduced ? 0 : 80);
      }
    } else if (item.typedElement) startTypewrite(item.typedElement, item.speed, now + 70);
    item.done = true;
  }

  function revealTaskComplete(task, now) {
    return task.revealItems.length === 0 || (task.revealItems.every(item => item.done) && now >= task.revealFinishAt);
  }

  function beginIntroMaterialization(task, now) {
    const section = document.querySelector(`[data-build-section="${task.plan.section}"]`);
    revealSection(section);
    task.revealItems = introRevealItems(task, now);
    task.revealFinishAt = task.revealItems.reduce((finish, item) => Math.max(finish, item.due + (item.typedElement ? [...item.typedElement.textContent].length * (state.reduced ? 0 : item.speed) + 180 : 380)), now);
    task.status = 'materializing';
    task.materializeAt = now;
  }

  function updateIntroMaterialization(now) {
    state.introTasks.forEach(task => {
      if (task.status === 'ready') beginIntroMaterialization(task, now);
      if (task.status === 'materializing') {
        task.revealItems.forEach(item => { if (!item.done && now >= item.due) fireRevealItem(item, now); });
        if (revealTaskComplete(task, now)) {
          task.status = 'done';
          task.completedAt = now;
          mechanicalClick();
        }
      }
    });
  }

  function checkScrollSections() {
    document.querySelectorAll('main > [data-build-section], footer[data-build-section]').forEach(section => {
      if (section.dataset.buildSection === 'hero' || section.classList.contains('section-built') || section.classList.contains('section-building')) return;
      const rect = section.getBoundingClientRect();
      if (rect.top <= innerHeight * 1.15 && rect.bottom >= -100) constructSection(section);
    });
  }

  function startSectionObserver() {
    if (state.observer || state.fallbackScrollHandler) return;
    const onScroll = () => { state.scrollDirty = true; };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    checkScrollSections();

    if (!('IntersectionObserver' in window)) {
      state.fallbackScrollHandler = onScroll;
      return;
    }
    state.observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const section = entry.target;
        if (!section.classList.contains('section-built') && !section.classList.contains('section-building')) constructSection(section);
        state.observer.unobserve(section);
      });
    }, { threshold: 0.04, rootMargin: '180px 0px 180px 0px' });
    document.querySelectorAll('main > [data-build-section], footer[data-build-section]').forEach(section => {
      if (!['hero'].includes(section.dataset.buildSection) && !section.classList.contains('section-built')) state.observer.observe(section);
    });
  }

  function constructSection(section) {
    if (!section || state.sectionBuilds.has(section) || section.classList.contains('section-built')) return;
    if (state.observer) {
      try { state.observer.unobserve(section); } catch (_) {}
    }
    const raw = section.getBoundingClientRect();
    const rect = getRect(section) || { x: 0, y: raw.top, w: Math.max(100, raw.width || innerWidth), h: Math.max(80, raw.height || 400) };
    const task = { kind: 'section', section, target: section, rect, label: section.dataset.buildSection.toUpperCase(), color: palette[(state.sectionQueue.length + 4) % palette.length], status: 'queued', startAt: state.clock, revealItems: [], revealFinishAt: 0, lastScrollY: window.scrollY };
    section.classList.add('section-building');
    state.sectionBuilds.set(section, task);
    state.sectionQueue.push(task);
    state.layoutCache.dirty = true;
  }

  function startQueuedSections(now) {
    if (!state.sectionQueue.length) return;
    const busyAgents = new Set();
    for (const build of state.sectionBuilds.values()) {
      if (['scheduled', 'moving', 'dragging', 'confirming', 'ready'].includes(build.status)) {
        if (build.lead) busyAgents.add(build.lead);
        if (build.partner) busyAgents.add(build.partner);
      }
    }
    const available = state.agents.filter(agent => !busyAgents.has(agent));
    while (state.sectionQueue.length && available.length >= 2) {
      const task = state.sectionQueue.shift();
      if (!task || !task.section.isConnected || task.section.classList.contains('section-built')) {
        if (task) state.sectionBuilds.delete(task.section);
        continue;
      }
      const lead = available.shift();
      const partner = available.shift();
      if (!lead || !partner || lead === partner) {
        if (lead) available.unshift(lead);
        state.sectionQueue.unshift(task);
        break;
      }
      busyAgents.add(lead);
      busyAgents.add(partner);
      task.lead = lead;
      task.partner = partner;
      const pairIndex = lead.id % 8;
      task.startAt = now;
      task.moveDuration = state.reduced ? 60 : 320 + (pairIndex % 4) * 50;
      task.dragDuration = state.reduced ? 80 : 340 + (pairIndex % 3) * 60;
      task.confirmDuration = state.reduced ? 60 : 120;
      task.status = 'scheduled';
      startTaskRoute(task, now);
    }
  }

  function refreshLayoutCache() {
    if (!state.layoutCache.dirty && state.clock - state.layoutCache.updatedAt < 250) return;
    const selector = state.cinematic.active
      ? 'main [data-build-piece], main [data-build-section], main .project-card, main .skill-row, main .experience-item, main .credential-grid > div, main .credential-img-link, main a, main button'
      : '[data-build-piece].piece-built, [data-build-section].section-built, [data-build-section].section-built a';
    const candidates = [...document.querySelectorAll(selector)];
    const seen = new Set();
    const anchors = [];
    for (const element of candidates) {
      if (!element || !element.isConnected || element.offsetParent === null) continue;
      if (!state.cinematic.active && element.closest('[data-build-section]:not(.section-built), [data-build-piece]:not(.piece-built)')) continue;
      const rect = getRect(element);
      if (!rect || rect.w < 12 || rect.h < 9) continue;
      if (element.hasAttribute('data-build-section') && !element.matches('a,button') && (rect.w > innerWidth * 0.7 || rect.h > 360)) continue;
      const key = `${Math.round(rect.x / 12)}:${Math.round(rect.y / 12)}:${Math.round(rect.w / 20)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push({ element, rect, key });
    }
    const elements = [...document.querySelectorAll('[data-build-section], [data-build-piece]')].filter(el => el.isConnected && el.offsetParent !== null);
    const wireSeen = new Set();
    const wireTargets = elements.map((element, index) => ({ element, index, label: element.dataset.buildSection?.toUpperCase() || element.dataset.buildPiece?.replaceAll('-', '_').toUpperCase() || 'NODE' }))
      .filter(item => {
        const rect = getRect(item.element);
        if (!rect || rect.w < 28 || rect.h < 18) return false;
        const key = `${Math.round(rect.x / 12)}:${Math.round(rect.y / 12)}:${Math.round(rect.w / 20)}:${Math.round(rect.h / 20)}`;
        if (wireSeen.has(key)) return false;
        wireSeen.add(key);
        item.rect = rect;
        return true;
      });
    state.layoutCache.anchors = anchors;
    state.layoutCache.clickTargets = anchors.filter(target => target.element.matches('a,button'));
    state.layoutCache.wireTargets = wireTargets;
    state.layoutCache.updatedAt = state.clock;
    state.layoutCache.dirty = false;
  }

  function getVisibleBuiltTargets() { refreshLayoutCache(); return state.layoutCache.anchors || []; }
  function getClickTargets() { refreshLayoutCache(); return state.layoutCache.clickTargets || []; }
  function getWireTargets() { refreshLayoutCache(); return state.layoutCache.wireTargets || []; }

  function drawRoundRect(x, y, width, height, radius) {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
    } else {
      ctx.beginPath(); ctx.rect(x, y, width, height);
    }
  }

  function playSnapSound() {
    try {
      const audio = initializeAudio();
      if (!audio) return;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const start = audio.currentTime;
      osc.frequency.setValueAtTime(750, start);
      osc.frequency.exponentialRampToValueAtTime(140, start + 0.06);
      gain.gain.setValueAtTime(0.04, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.06);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(start);
      osc.stop(start + 0.06);
    } catch (_) {}
  }

  function drawFrame(box, color, progress, opacity = 1, settled = false) {
    if (!box || !box.rect) return;
    const r = box.rect;
    const p = clamp(progress, 0, 1);
    const w = Math.max(4, r.w * p), h = Math.max(4, r.h * p);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = 'rgba(59,130,246,0.06)';
    ctx.fillRect(r.x, r.y, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(settled ? [] : [4, 4]);
    ctx.strokeRect(r.x + .5, r.y + .5, w, h);
    ctx.setLineDash([]);
    const handle = 6;
    ctx.fillStyle = '#fff';
    [[r.x, r.y], [r.x + w, r.y], [r.x, r.y + h], [r.x + w, r.y + h]].forEach(([x, y]) => {
      ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
      ctx.strokeRect(x - handle / 2, y - handle / 2, handle, handle);
    });
    ctx.font = '10px monospace';
    const text = `${box.label} ${Math.round(w)}×${Math.round(h)}`;
    const textWidth = ctx.measureText(text).width;
    const labelWidth = textWidth + 10;
    ctx.fillStyle = color;
    ctx.fillRect(r.x, Math.max(2, r.y - 17), labelWidth, 16);
    ctx.fillStyle = '#09090b';
    ctx.fillText(text, r.x + 5, Math.max(12, r.y - 5));
    // Center crosshairs
    ctx.strokeStyle = color;
    ctx.globalAlpha = .5;
    ctx.beginPath();
    ctx.moveTo(r.x + w / 2 - 6, r.y + h / 2);
    ctx.lineTo(r.x + w / 2 + 6, r.y + h / 2);
    ctx.moveTo(r.x + w / 2, r.y + h / 2 - 6);
    ctx.lineTo(r.x + w / 2, r.y + h / 2 + 6);
    ctx.stroke();
    ctx.restore();
  }

  function drawCursor(agent, now, showTrail = true) {
    if (isMobile) return;
    if (showTrail && agent.history.length > 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < agent.history.length; i++) {
        const p0 = agent.history[i - 1];
        const p1 = agent.history[i];
        const progress = i / agent.history.length;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = agent.color;
        ctx.globalAlpha = progress * 0.45;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.save();
    ctx.translate(agent.x, agent.y);
    ctx.shadowColor = '#0009';
    ctx.shadowBlur = 5;
    ctx.fillStyle = agent.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(4.5, 12);
    ctx.lineTo(8, 19);
    ctx.lineTo(11, 17);
    ctx.lineTo(7, 10);
    ctx.lineTo(14, 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (innerWidth > 600 || agent.id % 3 === 0) {
      ctx.font = 'bold 10px monospace';
      const label = agent.action ? `${agent.name} · ${agent.action}` : agent.name;
      const textWidth = ctx.measureText(label).width;
      const badgeWidth = textWidth + 10;
      ctx.fillStyle = agent.color;
      drawRoundRect(11, 12, badgeWidth, 17, 3);
      ctx.fill();
      ctx.fillStyle = '#09090b';
      ctx.fillText(label, 16, 24);
    }
    ctx.restore();
  }

  function drawVortex(elapsed) {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    const l = elapsed / 1000;
    const activeAgents = state.agents.slice(0, state.targetCount);
    activeAgents.forEach((agent, index) => {
      const angle = agent.seed + 2 * l;
      const radius = 18 + (index % 7) * 7 + 4 * Math.sin(4 * l + index);
      agent.x = cx + Math.cos(angle) * radius;
      agent.y = cy + Math.sin(angle) * radius;
      agent.history.length = 0;
      drawCursor(agent, elapsed, false);
    });
  }

  function updateParkedAgents(now) {
    state.agents.forEach(agent => {
      if (!agent.motion || now < agent.motion.startAt) return;
      const motion = agent.motion;
      const p = motion.duration === 0 ? 1 : clamp((now - motion.startAt) / motion.duration, 0, 1);
      const eased = easeInOut(p);
      agent.x = motion.from.x + (motion.to.x - motion.from.x) * eased;
      agent.y = motion.from.y + (motion.to.y - motion.from.y) * eased;
      if (p >= 1) agent.motion = null;
    });
  }

  function startTaskRoute(task, now) {
    if (!task.lead || !task.partner) return false;
    let rect = getRect(task.target);
    if (!rect && task.kind === 'section' && task.target?.isConnected) {
      const raw = task.target.getBoundingClientRect();
      if (raw.width >= 2 && raw.height >= 2) rect = { x: raw.left, y: raw.top, w: raw.width, h: raw.height };
    }
    if (!rect) return false;
    task.rect = rect;
    task.leadStart = { x: clamp(rect.x - 7, 7, innerWidth - 26), y: clamp(rect.y - 7, 7, innerHeight - 26) };
    task.leadEnd = { x: clamp(rect.x + rect.w - 8, 7, innerWidth - 26), y: clamp(rect.y + rect.h - 8, 7, innerHeight - 26) };
    task.partnerPoint = { x: clamp(rect.x + rect.w - 8, 7, innerWidth - 26), y: clamp(rect.y - 7, 7, innerHeight - 26) };
    task.moveFromLead = { x: task.lead.x, y: task.lead.y };
    task.moveFromPartner = { x: task.partner.x, y: task.partner.y };
    task.lead.motion = null; task.partner.motion = null;
    task.lead.vx = 0; task.lead.vy = 0; task.partner.vx = 0; task.partner.vy = 0;
    const distance = Math.max(Math.hypot(task.leadStart.x - task.lead.x, task.leadStart.y - task.lead.y), Math.hypot(task.partnerPoint.x - task.partner.x, task.partnerPoint.y - task.partner.y));
    if (!task.moveDuration) task.moveDuration = state.reduced ? 80 : Math.round(clamp(360 + distance * .24 + ((task.index * 61) % 150), 440, 1050));
    task.routeAt = now;
    task.lastScrollY = window.scrollY;
    task.status = 'moving';
    return true;
  }

  function updateConstructionTask(task, now) {
    if (task.kind === 'section' && task.status === 'queued') return;
    if ((task.status === 'queued' || task.status === 'scheduled') && now >= task.startAt && !startTaskRoute(task, now)) return;
    if (task.status === 'moving' || task.status === 'dragging' || task.status === 'confirming' || task.status === 'ready') {
      const scrollDelta = window.scrollY - (task.lastScrollY ?? window.scrollY);
      if (scrollDelta && task.kind === 'section') {
        if (task.rect) task.rect.y -= scrollDelta;
        if (task.leadStart) task.leadStart.y -= scrollDelta;
        if (task.leadEnd) task.leadEnd.y -= scrollDelta;
        if (task.partnerPoint) task.partnerPoint.y -= scrollDelta;
        if (task.moveFromLead) task.moveFromLead.y -= scrollDelta;
        if (task.moveFromPartner) task.moveFromPartner.y -= scrollDelta;
        if (task.lead) task.lead.y -= scrollDelta;
        if (task.partner) task.partner.y -= scrollDelta;
      }
      task.lastScrollY = window.scrollY;
    }
    if (task.status === 'moving') {
      const p = clamp((now - task.routeAt) / task.moveDuration, 0, 1);
      const eased = easeInOut(p);
      task.lead.x = task.moveFromLead.x + (task.leadStart.x - task.moveFromLead.x) * eased;
      task.lead.y = task.moveFromLead.y + (task.leadStart.y - task.moveFromLead.y) * eased;
      task.partner.x = task.moveFromPartner.x + (task.partnerPoint.x - task.moveFromPartner.x) * eased;
      task.partner.y = task.moveFromPartner.y + (task.partnerPoint.y - task.moveFromPartner.y) * eased;
      if (p >= 1) {
        task.lead.x = task.leadStart.x; task.lead.y = task.leadStart.y;
        task.partner.x = task.partnerPoint.x; task.partner.y = task.partnerPoint.y;
        task.status = 'dragging'; task.dragAt = now;
      }
    } else if (task.status === 'dragging') {
      const p = clamp((now - task.dragAt) / task.dragDuration, 0, 1);
      const eased = easeInOut(p);
      task.lead.x = task.leadStart.x + (task.leadEnd.x - task.leadStart.x) * eased;
      task.lead.y = task.leadStart.y + (task.leadEnd.y - task.leadStart.y) * eased;
      if (p >= 1) {
        task.lead.x = task.leadEnd.x; task.lead.y = task.leadEnd.y;
        task.status = 'confirming'; task.confirmAt = now;
        mechanicalClick();
      }
    } else if (task.status === 'confirming' && now - task.confirmAt >= task.confirmDuration) {
      task.status = 'ready'; task.readyAt = now;
      if (task.kind === 'section') beginSectionMaterialization(task, now);
    }
  }

  function beginSectionMaterialization(task, now) {
    revealSection(task.section);
    task.revealItems = sectionRevealItems(task.section, now);
    task.revealFinishAt = task.revealItems.reduce((finish, item) => {
      const typingDuration = (item.typedTargets || []).reduce((total, [element, speed]) => total + [...element.textContent].length * (state.reduced ? 0 : speed) + 180, 0);
      return Math.max(finish, item.due + typingDuration + 380);
    }, now);
    task.status = 'materializing';
    task.lead = null;
    task.partner = null;
  }

  function updateSectionMaterializations(now) {
    for (const task of state.sectionBuilds.values()) {
      if (task.status !== 'materializing') continue;
      task.revealItems.forEach(item => { if (!item.done && now >= item.due) fireRevealItem(item, now); });
      if (revealTaskComplete(task, now)) {
        task.status = 'done';
        state.sectionBuilds.delete(task.section);
        state.layoutCache.dirty = true;
        mechanicalClick();
      }
    }
  }

  function updateConstructionTasks(now) {
    if (state.phase === 'void' && now >= phaseTiming().voidEnd) initializeIntroTimeline();
    if (state.phase !== 'ambient') updateParkedAgents(now);
    startQueuedSections(now);
    state.introTasks.forEach(task => updateConstructionTask(task, now));
    for (const task of state.sectionBuilds.values()) updateConstructionTask(task, now);
    if (state.phase === 'wireframe' && state.introTasks.length && state.introTasks.every(task => task.status === 'ready')) {
      state.phase = 'materialize';
      phaseLabel('materialize');
    }
    if (state.phase === 'materialize') {
      updateIntroMaterialization(now);
      if (state.introTasks.length && state.introTasks.every(task => task.status === 'done')) {
        state.phase = 'ambient';
        phaseLabel('ambient');
      }
    }
    updateSectionMaterializations(now);
  }

  function drawConstructionTasks(now) {
    const tasks = [...state.introTasks, ...state.sectionBuilds.values()];
    const activeAgents = new Set();
    for (const task of tasks) {
      if (task.status === 'done' || task.status === 'queued' || task.status === 'scheduled') continue;
      if (!task.rect) continue;
      if (task.lead) activeAgents.add(task.lead);
      if (task.partner) activeAgents.add(task.partner);
      if (task.status === 'moving') {
        ctx.save(); ctx.globalAlpha = .7; ctx.strokeStyle = task.color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(task.rect.x - 4, task.rect.y - 10); ctx.lineTo(task.rect.x - 4, task.rect.y - 4); ctx.lineTo(task.rect.x + 2, task.rect.y - 4); ctx.stroke();
        ctx.font = '600 7px "DM Mono",monospace'; ctx.fillStyle = task.color; ctx.fillText(`TARGET ${task.label}`, task.rect.x + 3, Math.max(10, task.rect.y - 8)); ctx.restore();
      } else {
        const p = task.status === 'dragging' ? easeInOut((now - task.dragAt) / task.dragDuration) : 1;
        const settled = ['confirming', 'ready', 'materializing'].includes(task.status);
        const opacity = task.status === 'materializing' ? .5 : .92;
        drawFrame({ rect: task.rect, label: task.label }, task.color, p, opacity, settled);
        if (task.status === 'confirming') {
          const snap = easeInOut(clamp((now - task.confirmAt) / task.confirmDuration, 0, 1));
          const inset = (1 - snap) * 7;
          ctx.save(); ctx.globalAlpha = (1 - snap) * .65; ctx.strokeStyle = '#f4f1ea'; ctx.lineWidth = 1.2;
          ctx.strokeRect(task.rect.x - inset, task.rect.y - inset, task.rect.w + inset * 2, task.rect.h + inset * 2); ctx.restore();
        }
        if (task.status === 'dragging' && task.lead && task.leadStart && task.leadEnd) {
          task.lead.x = task.leadStart.x + (task.leadEnd.x - task.leadStart.x) * p;
          task.lead.y = task.leadStart.y + (task.leadEnd.y - task.leadStart.y) * p;
        } else if (settled) {
          if (task.lead && task.leadEnd) { task.lead.x = task.leadEnd.x; task.lead.y = task.leadEnd.y; }
          if (task.partner && task.partnerPoint) { task.partner.x = task.partnerPoint.x; task.partner.y = task.partnerPoint.y; }
        }
      }
    }
    if (state.cinematic.active) {
      const activeCount = Math.min(state.agents.length, state.targetCount);
      for (let i = 0; i < activeCount; i++) {
        drawCursor(state.agents[i], now, !state.reduced);
      }
    } else if (state.phase !== 'ambient') {
      state.agents.forEach(agent => { if (!activeAgents.has(agent)) drawCursor(agent, now, !state.reduced && state.count < 80); });
      activeAgents.forEach(agent => drawCursor(agent, now, !state.reduced));
    }
  }

  function targetPoint(agent, index, target, visit) {
    const rect = target.rect;
    const cols = rect.w > 360 ? 5 : (rect.w > 180 ? 3 : 2);
    const rows = rect.h > 120 ? 3 : (rect.h > 60 ? 2 : 1);
    const colSlot = (index + visit * 2) % cols;
    const rowSlot = Math.floor((index * 3 + visit) / cols) % rows;
    const slotX = ((colSlot + 0.5) / cols) * 0.74 + 0.13;
    const slotY = ((rowSlot + 0.5) / rows) * 0.70 + 0.15;
    agent.flipY = (rowSlot === 0 && rows > 1 && index % 2 === 1);
    return {
      x: clamp(rect.x + rect.w * slotX, 10, innerWidth - 32),
      y: clamp(rect.y + rect.h * slotY, 10, innerHeight - 26)
    };
  }

  function drawSelection(now, anchors) {
    if (state.mode !== 'collab' || state.reduced || !anchors.length) return;
    const slot = Math.floor(now / 3200) % anchors.length;
    const target = anchors[slot];
    const r = target.rect;
    const band = Math.max(28, Math.min(r.w * (.28 + ((Math.floor(now / 750) % 4) * .08)), r.w - 3));
    const lineHeight = Math.max(7, Math.min(13, r.h * .12));
    const y = r.y + Math.min(r.h - lineHeight, 5 + (Math.floor(now / 1100) % 3) * lineHeight * 1.2);
    ctx.fillStyle = 'rgba(59,130,246,0.18)';
    ctx.fillRect(r.x + 2, y, band, lineHeight);
  }

  function drawAmbient(now) {
    const anchors = getVisibleBuiltTargets();
    const clickTargets = getClickTargets();
    const buildingAgents = new Set();
    for (const build of state.sectionBuilds.values()) {
      if (['moving', 'dragging', 'confirming', 'ready', 'materializing'].includes(build.status)) { buildingAgents.add(build.lead); buildingAgents.add(build.partner); }
    }

    if (state.mode === 'wireframe') {
      getWireTargets().slice(0, state.agentLimit > 36 ? 90 : 48).forEach((item, index) => drawFrame({ rect: item.rect, label: `${item.label} ${Math.round(item.rect.x)},${Math.round(item.rect.y)}` }, palette[index % palette.length], 1, .4));
    }
    drawSelection(now, anchors);

    state.agents.forEach((agent, index) => {
      if (buildingAgents.has(agent)) return;
      if (state.mode === 'follow') {
        const centerX = state.mouse.active ? state.mouse.x : innerWidth * .5;
        const centerY = state.mouse.active ? state.mouse.y : innerHeight * .5;
        const angle = index * 2.39996;
        const ring = 18 + Math.sqrt(index) * (state.count > 60 ? 8 : 12);
        const point = { x: centerX + Math.cos(angle) * ring, y: centerY + Math.sin(angle) * ring * .65 };
        const dt = Math.min(.05, (state.delta || 16) / 1000);
        const spring = state.reduced ? 1 : 13.5;
        if (state.reduced) { agent.x = point.x; agent.y = point.y; }
        else {
          const damping = 2.1 * spring;
          const ax = (point.x - agent.x) * spring * spring - damping * agent.vx;
          const ay = (point.y - agent.y) * spring * spring - damping * agent.vy;
          agent.vx += ax * dt; agent.vy += ay * dt;
          agent.x += agent.vx * dt; agent.y += agent.vy * dt;
        }
      } else if (anchors.length && !state.reduced && !agent.motion && now >= agent.restUntil) {
        const pool = index % 13 === 0 && clickTargets.length ? clickTargets : anchors;
        agent.visit = (agent.visit || 0) + 1;
        const targetIndex = (index * 7 + agent.visit * 11) % pool.length;
        const activeTarget = pool[targetIndex];
        const point = targetPoint(agent, index, activeTarget, agent.visit);
        const distance = Math.hypot(point.x - agent.x, point.y - agent.y);
        const duration = clamp(440 + distance * .22 + ((index * 47 + agent.visit * 31) % 160), 480, 1150);
        agent.motion = { from: { x: agent.x, y: agent.y }, to: point, startAt: now, duration };
        agent.restUntil = now + duration + 550 + (index % 5) * 260;
        agent.targetKey = activeTarget.key;
        agent.pendingRipple = index % 13 === 0 && activeTarget.element.matches('a,button') ? activeTarget : null;
      } else if (agent.motion && now >= agent.motion.startAt) {
        const motion = agent.motion;
        const p = clamp((now - motion.startAt) / motion.duration, 0, 1);
        const eased = easeInOut(p);
        agent.x = motion.from.x + (motion.to.x - motion.from.x) * eased;
        agent.y = motion.from.y + (motion.to.y - motion.from.y) * eased;
        if (p >= 1) {
          agent.x = motion.to.x; agent.y = motion.to.y; agent.motion = null;
          if (agent.pendingRipple) {
            const rect = agent.pendingRipple.rect;
            state.ripples.push({ x: agent.x, y: agent.y, start: now, color: agent.color });
            if (state.ripples.length > 12) state.ripples.shift();
            mechanicalClick(true); agent.pendingRipple = null; agent.lastClick = now;
          }
        }
      }
      if (index % (state.agentLimit > 70 ? 4 : 2) === 0) {
        agent.history.push({ x: agent.x, y: agent.y, time: now });
        if (agent.history.length > 7) agent.history.shift();
      } else if (agent.history.length > 0 && now - agent.history[0].time > 160) agent.history.shift();
      drawCursor(agent, now, !state.reduced && index % 2 === 0);
    });

    if (state.typing?.char?.isConnected) {
      const r = state.typing.char.getBoundingClientRect();
      if (r.width || r.height) {
        const blink = Math.sin(now / 80) > -.35;
        if (blink) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(r.right + 1, r.top + 1, 1.5, Math.max(8, r.height - 2));
        }
      }
    }
  }

  function drawRipples(now) {
    if (state.reduced) { state.ripples = []; return; }
    state.ripples = state.ripples.filter(ripple => now - ripple.start < 650);
    for (const ripple of state.ripples) {
      const progress = (now - ripple.start) / 650;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, 4 + progress * 27, 0, Math.PI * 2);
      ctx.strokeStyle = ripple.color;
      ctx.globalAlpha = (1 - progress) * .7;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function updateFpsGovernor(now, delta) {
    state.fpsSamples.push(delta);
    if (now - state.lastFpsCheck > 500) {
      const avgDelta = state.fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, state.fpsSamples.length);
      const currentFps = Math.round(1000 / Math.max(1, avgDelta));
      state.fps = currentFps;
      state.fpsSamples.length = 0;
      state.lastFpsCheck = now;

      if (state.cinematic.active && state.cinematic.phase === 'tour-down') {
        if (currentFps < 45 && state.targetCount > 24) {
          state.targetCount = Math.max(24, state.targetCount - 8);
        } else if (currentFps >= 52 && state.targetCount < 56) {
          state.targetCount = Math.min(56, state.targetCount + 6);
        }
      }
    }
  }

  function ensureFrameLoop() {
    if (!state.frame && !document.hidden) state.frame = requestAnimationFrame(drawFrameLoop);
  }

  function drawFrameLoop(timestamp) {
    state.frame = 0;
    if (document.hidden) return;
    const delta = state.lastFrameAt === null ? 16.7 : clamp(timestamp - state.lastFrameAt, 0, 50);
    state.lastFrameAt = timestamp;
    state.delta = delta;
    state.clock += delta;
    updateFpsGovernor(state.clock, delta);
    if (state.scrollDirty) {
      state.scrollDirty = false;
      checkScrollSections();
    }
    updateTypeJobs(state.clock);
    updateCountJobs(state.clock);
    if (state.cinematic.active) {
      updateCinematicSequence(state.clock);
    } else {
      updateConstructionTasks(state.clock);
    }
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (state.cinematic.phase === 'complete') {
      drawRipples(state.clock);
    } else if (state.phase === 'void') {
      drawVortex(state.clock);
    } else {
      drawConstructionTasks(state.clock);
      if (!state.cinematic.active && state.phase === 'ambient') drawAmbient(state.clock);
    }
    drawRipples(state.clock);
    state.frame = requestAnimationFrame(drawFrameLoop);
  }

  function restoreBuildState() {
    state.observer?.disconnect();
    state.observer = null;
    if (state.fallbackScrollHandler) {
      window.removeEventListener('scroll', state.fallbackScrollHandler);
      window.removeEventListener('resize', state.fallbackScrollHandler);
      state.fallbackScrollHandler = null;
    }
    state.sectionQueue = [];
    state.sectionBuilds.clear();
    state.ripples = [];
    state.introTasks = [];
    state.introStarted = false;
    state.nextAgentPair = 0;
    state.typeJobs.clear();
    state.countJobs.clear();
    state.layoutCache = { anchors: null, clickTargets: null, wireTargets: null, dirty: true, updatedAt: -1000 };
    restoreTyped();
    document.body.classList.remove('phase-ambient', 'phase-wireframe', 'phase-materialize', 'cinematic-tour', 'cinematic-complete');
    document.documentElement.classList.remove('cinematic-tour', 'cinematic-complete');
    document.body.classList.add('construction-active');
    document.querySelectorAll('.section-built,.section-building,.piece-built,.scan-in').forEach(el => el.classList.remove('section-built', 'section-building', 'piece-built', 'scan-in'));
    document.querySelectorAll('[data-count-running="true"]').forEach(el => delete el.dataset.countRunning);
    document.querySelectorAll('[data-count] .count-value').forEach(el => { el.textContent = '0'; });
    /* DEV_ONLY_START:PROFILE_EDITOR */
    byId('inspect-drawer').hidden = true;
    byId('inspect-toggle').setAttribute('aria-expanded', 'false');
    /* DEV_ONLY_END:PROFILE_EDITOR */
    state.clock = 0;
    state.lastFrameAt = null;
    phaseLabel('void');
  }

  function revealAllInstantly() {
    document.querySelectorAll('main > [data-build-section], footer[data-build-section]').forEach(section => {
      section.classList.remove('section-building');
      section.classList.add('section-built');
      section.querySelectorAll('[data-build-piece]').forEach(piece => {
        piece.classList.add('piece-built');
        piece.querySelectorAll('[data-count]').forEach(c => {
          const val = c.dataset.count;
          const disp = c.querySelector('.count-value');
          const suffix = c.dataset.suffix || '';
          if (disp && val) disp.textContent = `${val}${suffix}`;
        });
        if (piece.hasAttribute('data-count')) {
          const val = piece.dataset.count;
          const disp = piece.querySelector('.count-value');
          const suffix = piece.dataset.suffix || '';
          if (disp && val) disp.textContent = `${val}${suffix}`;
        }
        if (piece.matches('.portrait-wrap,.hero-portrait-card')) {
          piece.classList.add('scan-in');
        }
      });
    });
    for (const [element, job] of state.typeJobs) {
      job.chars.forEach(char => char.classList.add('typed-in'));
      element.classList.remove('is-typing');
    }
    state.typeJobs.clear();
    state.countJobs.clear();
    state.sectionQueue = [];
    state.sectionBuilds.clear();
    state.introTasks.forEach(task => { task.status = 'done'; });
  }

  function ensureAllSectionsBuilt() {
    document.querySelectorAll('main > [data-build-section], footer[data-build-section]').forEach(section => {
      section.classList.remove('section-building');
      section.classList.add('section-built');
      section.querySelectorAll('[data-build-piece]').forEach(piece => {
        piece.classList.add('piece-built');
        piece.querySelectorAll('[data-count]').forEach(c => {
          const val = c.dataset.count;
          const disp = c.querySelector('.count-value');
          const suffix = c.dataset.suffix || '';
          if (disp && val) disp.textContent = `${val}${suffix}`;
        });
        if (piece.hasAttribute('data-count')) {
          const val = piece.dataset.count;
          const disp = piece.querySelector('.count-value');
          const suffix = piece.dataset.suffix || '';
          if (disp && val) disp.textContent = `${val}${suffix}`;
        }
        if (piece.matches('.portrait-wrap,.hero-portrait-card')) {
          piece.classList.add('scan-in');
        }
      });
    });
  }

  function startCinematicTourDown(now) {
    state.cinematic.phase = 'tour-down';
    state.cinematic.phaseStartClock = now;
    state.targetCount = 56;
    document.body.classList.add('cinematic-tour');
    document.documentElement.classList.add('cinematic-tour');
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    state.cinematic.scrollDuration = clamp(Math.round(maxScroll * 0.75), 3200, 6000);
    state.cinematic.scrollStartY = window.scrollY;
    state.cinematic.scrollTargetY = maxScroll;
  }

  function updateCinematicSwarm(now) {
    const l = now / 1000;
    const r = Math.min(state.delta / 16.67, 3);
    const activeCount = Math.min(state.agents.length, state.targetCount);

    const activeIntroTasks = state.introTasks.filter(t => ['moving', 'dragging', 'confirming', 'ready'].includes(t.status));
    const activeSectionTasks = [...state.sectionBuilds.values()].filter(t => ['moving', 'dragging', 'confirming', 'ready'].includes(t.status));
    const allActiveTasks = [...activeIntroTasks, ...activeSectionTasks];

    const assignedAgents = new Map();
    for (const task of allActiveTasks) {
      if (task.lead) assignedAgents.set(task.lead, { task, role: 'lead' });
      if (task.partner) assignedAgents.set(task.partner, { task, role: 'partner' });
    }

    const visibleBuilt = getVisibleBuiltTargets();

    for (let index = 0; index < activeCount; index++) {
      const agent = state.agents[index];
      let targetX, targetY;
      let action = null;
      let isAssigned = false;

      if (assignedAgents.has(agent)) {
        isAssigned = true;
        const { task, role } = assignedAgents.get(agent);
        const isTyping = (task.plan?.target === '.hello' || task.plan?.target === '.hero-name' || task.plan?.target === '.hero-bottom' || task.kind === 'section');

        if (role === 'lead') {
          action = isTyping ? 'typing' : 'resizing';
          if (task.status === 'dragging') {
            const p = easeInOut((now - task.dragAt) / task.dragDuration);
            if (isTyping) {
              const v = now - task.dragAt;
              targetX = task.rect.x + Math.min(task.rect.w - 12, 18 + (v / 800) * Math.min(task.rect.w - 30, 200));
              targetY = task.rect.y + Math.min(task.rect.h - 8, 22);
            } else {
              targetX = task.leadStart.x + (task.leadEnd.x - task.leadStart.x) * p;
              targetY = task.leadStart.y + (task.leadEnd.y - task.leadStart.y) * p;
            }
          } else if (task.status === 'moving') {
            targetX = task.leadStart.x;
            targetY = task.leadStart.y;
          } else {
            targetX = task.leadEnd.x;
            targetY = task.leadEnd.y;
          }
        } else {
          targetX = task.partnerPoint.x;
          targetY = task.partnerPoint.y;
        }
      } else if (l < 0.35) {
        const angle = agent.seed + 2 * l;
        const radius = 18 + (index % 7) * 7 + 4 * Math.sin(4 * l + index);
        targetX = innerWidth / 2 + Math.cos(angle) * radius;
        targetY = innerHeight / 2 + Math.sin(angle) * radius;
      } else {
        const pool = visibleBuilt.filter(t => !t.element.closest('.topbar'));
        const activePool = pool.length ? pool : visibleBuilt;
        const anchor = activePool.length ? activePool[index % activePool.length].rect : { x: innerWidth * 0.5, y: innerHeight * 0.5, w: 200, h: 100 };
        const iPhase = Math.floor(l / 5 + index / 8);
        const t = (Math.sin(91.7 * index + 17 * iPhase) + 1) / 2;
        const rVal = (Math.cos(43.3 * index + 11 * iPhase) + 1) / 2;
        targetX = anchor.x + anchor.w * t + 14 * Math.sin(0.8 * l + index);
        targetY = anchor.y + anchor.h * rVal + 12 * Math.cos(0.7 * l + index);
      }

      const interp = isAssigned ? 0.42 : (1 - Math.pow(l < 0.35 ? 0.82 : 0.965, r));
      agent.x += (targetX - agent.x) * interp;
      agent.y += (targetY - agent.y) * interp;
      agent.action = action;

      agent.history.push({ x: agent.x, y: agent.y, time: now });
      if (agent.history.length > 7) agent.history.shift();
    }
  }

  function updateCinematicSequence(now) {
    const l = now / 1000;
    if (l >= 0.35) {
      const initEl = document.getElementById('swarm-initializing');
      if (initEl && !initEl.classList.contains('init-hidden')) initEl.classList.add('init-hidden');
    }

    if (state.cinematic.phase === 'hero') {
      updateConstructionTasks(now);
      updateCinematicSwarm(now);
      if (state.introTasks.length && state.introTasks.every(task => task.status === 'done')) {
        startCinematicTourDown(now);
      }
      return;
    }
    if (state.cinematic.phase === 'tour-down') {
      const elapsed = now - state.cinematic.phaseStartClock;
      const progress = clamp(elapsed / state.cinematic.scrollDuration, 0, 1);
      const eased = easeInOut(progress);
      const currentMax = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const targetY = state.cinematic.scrollStartY + (currentMax - state.cinematic.scrollStartY) * eased;
      window.scrollTo(0, targetY);
      checkScrollSections();
      startQueuedSections(now);
      for (const task of state.sectionBuilds.values()) updateConstructionTask(task, now);
      updateSectionMaterializations(now);
      updateCinematicSwarm(now);
      if (progress >= 1) {
        window.scrollTo(0, currentMax);
        ensureAllSectionsBuilt();
        state.cinematic.phase = 'bottom-pause';
        state.cinematic.bottomPauseUntil = now + 650;
        playSnapSound();
        for (let i = 0; i < state.targetCount; i += 3) {
          const ag = state.agents[i];
          if (ag) state.ripples.push({ x: ag.x, y: ag.y, start: now, color: ag.color });
        }
      }
      return;
    }
    if (state.cinematic.phase === 'bottom-pause') {
      updateCinematicSwarm(now);
      if (now >= state.cinematic.bottomPauseUntil) {
        state.cinematic.phase = 'tour-up';
        state.cinematic.phaseStartClock = now;
        state.cinematic.scrollStartY = window.scrollY;
        state.cinematic.scrollDuration = 900;
      }
      return;
    }
    if (state.cinematic.phase === 'tour-up') {
      const elapsed = now - state.cinematic.phaseStartClock;
      const progress = clamp(elapsed / state.cinematic.scrollDuration, 0, 1);
      const eased = easeInOut(progress);
      const targetY = (1 - eased) * state.cinematic.scrollStartY;
      window.scrollTo(0, targetY);
      const activeCount = Math.min(state.agents.length, state.targetCount);
      for (let i = 0; i < activeCount; i++) {
        const ag = state.agents[i];
        ag.x += (innerWidth * (0.1 + (i % 8) * 0.11) - ag.x) * 0.12;
        ag.y += (innerHeight * 0.15 - ag.y) * 0.12;
        ag.history.push({ x: ag.x, y: ag.y, time: now });
        if (ag.history.length > 7) ag.history.shift();
      }
      if (progress >= 1) {
        window.scrollTo(0, 0);
        finishCinematicTour();
      }
      return;
    }
  }

  function finishCinematicTour() {
    state.cinematic.active = false;
    state.cinematic.phase = 'complete';
    document.body.classList.remove('cinematic-tour');
    document.documentElement.classList.remove('cinematic-tour');
    document.body.classList.add('cinematic-complete');
    document.body.classList.add('phase-ambient');
    state.agents.forEach(agent => {
      agent.history.length = 0;
      agent.vx = 0;
      agent.vy = 0;
      agent.motion = null;
    });
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    ensureAllSectionsBuilt();
    startSectionObserver();
  }

  function cancelCinematicIntro() {
    if (!state.cinematic.active) return;
    state.cinematic.active = false;
    state.cinematic.interrupted = true;
    document.getElementById('swarm-initializing')?.classList.add('init-hidden');
    revealAllInstantly();
    finishCinematicTour();
  }

  function onUserInterrupt(event) {
    if (!state.cinematic.active) return;
    if (event.type === 'keydown') {
      const navKeys = ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Space', ' ', 'Home', 'End'];
      if (!navKeys.includes(event.key)) return;
    }
    cancelCinematicIntro();
  }

  function startCinematicIntro() {
    state.cinematic.active = true;
    state.cinematic.interrupted = false;
    state.cinematic.phase = 'hero';
    state.cinematic.phaseStartClock = 0;
    state.targetCount = 20;
    state.phase = 'void';
    document.getElementById('swarm-initializing')?.classList.remove('init-hidden');
    state.agents.forEach(agent => {
      agent.x = innerWidth / 2;
      agent.y = innerHeight / 2;
      agent.vx = 0; agent.vy = 0; agent.motion = null; agent.restUntil = 0;
      agent.history.length = 0;
      agent.targetKey = -1;
      agent.lastClick = -10000;
      agent.pendingRipple = null;
      agent.action = null;
    });
    if (state.reduced || isMobile) {
      revealAllInstantly();
      finishCinematicTour();
      return;
    }
    ensureFrameLoop();
  }

  function replayBuild() {
    document.documentElement.classList.add('cinematic-tour');
    window.scrollTo(0, 0);
    restoreBuildState();
    startCinematicIntro();
  }

  /* DEV_ONLY_START:PROFILE_EDITOR */
  function updateProfile(next) {
    const fields = ['name', 'role', 'bio', 'email'];
    if (!fields.every(key => typeof next[key] === 'string')) return false;
    const normalized = Object.fromEntries(fields.map(key => [key, next[key].trim()]));
    if (!normalized.name || normalized.name.length > 60 || !normalized.role || normalized.role.length > 80 || !normalized.bio || normalized.bio.length > 420 || normalized.email.length > 254) return false;
    formField('email').value = normalized.email;
    if (!formField('email').checkValidity()) return false;
    Object.assign(profile, normalized);
    const parts = profile.name.split(/\s+/);
    const first = document.querySelector('.hero-name > span:first-child');
    const last = document.querySelector('.hero-name > span.name-red');
    first.textContent = (parts.shift() || '').toUpperCase();
    last.textContent = (parts.join(' ') || '').toUpperCase();
    last.hidden = !last.textContent;
    document.querySelector('.hero-name').setAttribute('aria-label', profile.name);
    document.querySelector('.topbar .brand').setAttribute('aria-label', `${profile.name} home`);
    document.querySelector('.hero-meta span:first-child').textContent = profile.role.toUpperCase();
    document.querySelector('.portrait-caption').textContent = `${profile.name.toUpperCase()} · ENGINEERING STUDENT`;
    document.querySelector('.footer > span:nth-child(2)').textContent = `DESIGNED & BUILT BY ${profile.name.toUpperCase()}`;
    document.querySelector('[data-build-text="bio"]').textContent = profile.bio;
    document.querySelector('[data-build-text="bio"]').setAttribute('aria-label', profile.bio);
    document.querySelector('meta[name="description"]').content = `${profile.name} — ${profile.role}, exploring cybersecurity, AI and software engineering.`;
    document.title = `${profile.name} — Portfolio`;
    document.querySelectorAll('a[href^="mailto:"]').forEach(link => {
      link.href = `mailto:${profile.email}`;
      if (!link.closest('.contact-links')) return;
      const textNode = [...link.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (textNode) textNode.nodeValue = `${profile.email.toUpperCase()} `;
    });
    formField('name').value = profile.name;
    formField('role').value = profile.role;
    formField('bio').value = profile.bio;
    formField('email').value = profile.email;
    return true;
  }
  /* DEV_ONLY_END:PROFILE_EDITOR */

  function applyReducedMotion() {
    if (!state.reduced) return;
    state.agents.forEach(agent => { agent.motion = null; agent.vx = 0; agent.vy = 0; agent.history.length = 0; });
    if (state.phase === 'ambient') {
      for (const task of state.sectionBuilds.values()) {
        if (['moving', 'dragging', 'confirming'].includes(task.status)) {
          task.moveDuration = 1; task.dragDuration = 1; task.confirmDuration = 1;
        }
      }
    }
  }

  /* DEV_ONLY_START:PROFILE_EDITOR */
  function openDrawer(open) {
    drawer.hidden = !open;
    byId('inspect-toggle').setAttribute('aria-expanded', String(open));
    if (open) formField('name').focus();
  }
  /* DEV_ONLY_END:PROFILE_EDITOR */

  assignBuildParts();
  makeAgents(56);
  resizeCanvas();
  window.addEventListener('resize', () => { resizeCanvas(); state.layoutCache.dirty = true; }, { passive: true });
  window.addEventListener('scroll', () => { state.layoutCache.dirty = true; }, { passive: true });
  window.addEventListener('load', () => { state.layoutCache.dirty = true; });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { state.layoutCache.dirty = true; });
  }
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => { state.layoutCache.dirty = true; });
    ro.observe(document.body);
  }
  document.addEventListener('error', event => {
    if (event.target && event.target.tagName === 'IMG') {
      event.target.classList.add('img-failed');
      state.layoutCache.dirty = true;
    }
  }, true);
  window.addEventListener('pointermove', event => {
    state.mouse.x = event.clientX;
    state.mouse.y = event.clientY;
    state.mouse.active = true;
  }, { passive: true });
  window.addEventListener('pointerleave', () => { state.mouse.active = false; });

  const menuToggle = document.querySelector('.menu-toggle');
  const topbar = document.querySelector('.topbar');
  if (menuToggle && topbar) {
    menuToggle.addEventListener('click', () => {
      const open = topbar.classList.toggle('nav-open');
      menuToggle.setAttribute('aria-expanded', String(open));
      menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });
    topbar.querySelectorAll('nav a').forEach(link => {
      link.addEventListener('click', () => {
        topbar.classList.remove('nav-open');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.setAttribute('aria-label', 'Open navigation');
        const hash = link.getAttribute('href');
        if (hash && hash.startsWith('#')) {
          const targetSection = document.querySelector(hash);
          if (targetSection && targetSection.hasAttribute('data-build-section')) {
            constructSection(targetSection);
            startQueuedSections(state.clock);
          }
        }
      });
    });
    document.addEventListener('click', event => {
      if (topbar.classList.contains('nav-open') && !topbar.contains(event.target)) {
        topbar.classList.remove('nav-open');
        menuToggle.setAttribute('aria-expanded', 'false');
        menuToggle.setAttribute('aria-label', 'Open navigation');
      }
    });
  }
  /* DEV_ONLY_START:PROFILE_EDITOR */
  byId('inspect-toggle').addEventListener('click', () => openDrawer(drawer.hidden));
  byId('inspect-close').addEventListener('click', () => openDrawer(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') openDrawer(false); });
  drawer.addEventListener('click', event => { if (event.target === drawer) openDrawer(false); });
  profileForm.addEventListener('submit', event => {
    event.preventDefault();
    ['name', 'role', 'bio', 'email'].forEach(name => {
      const field = formField(name);
      field.value = field.value.trim();
    });
    if (!profileForm.reportValidity()) return;
    const nextProfile = Object.fromEntries(new FormData(profileForm).entries());
    if (!['name', 'role', 'bio', 'email'].every(key => typeof nextProfile[key] === 'string')) return;
    restoreTyped();
    if (!updateProfile(nextProfile)) return;
    openDrawer(false);
    replayBuild();
  });
  /* DEV_ONLY_END:PROFILE_EDITOR */

  if (state.reduced) document.body.classList.add('motion-reduced');
  reducePreference.addEventListener('change', event => {
    state.reduced = event.matches;
    document.body.classList.toggle('motion-reduced', state.reduced);
    makeAgents(state.count);
    applyReducedMotion();
    if (state.phase !== 'ambient') replayBuild();
  });
  window.addEventListener('wheel', onUserInterrupt, { passive: true });
  window.addEventListener('touchmove', onUserInterrupt, { passive: true });
  window.addEventListener('pointerdown', onUserInterrupt, { passive: true });
  window.addEventListener('keydown', onUserInterrupt);

  phaseLabel('void');
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
      state.lastFrameAt = null;
    } else ensureFrameLoop();
  });

  if (state.reduced || isMobile) {
    revealAllInstantly();
    finishCinematicTour();
  } else {
    window.scrollTo(0, 0);
  }
  ensureFrameLoop();
})();
