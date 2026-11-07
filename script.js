(() => {
  const canvas = document.querySelector('#construction-canvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    document.body.classList.remove('construction-active');
    canvas.remove();
    document.querySelector('.construction-status')?.remove();
    return;
  }
  const status = document.querySelector('.construction-status span');
  const dockPhase = document.querySelector('#dock-phase');
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
  const palette = ['#ff4b36', '#58c8ff', '#b7e46d', '#ff91d4', '#ffd166', '#9e8bff', '#f7f3e8', '#ff8c42', '#45e0c0', '#f15bb5', '#a8dadc', '#e9ff70'];
  const callsigns = ['DESIGNER', 'FRONTEND', 'MOTION', 'CONTENT', 'GridRunner', 'TypeSmith', 'ShapeShifter', 'FrameForge', 'Redline_01', 'CanvasPilot', 'GlyphWorks', 'SnapLogic'];
  const leadColors = ['#ed402e', '#67c8ff', '#c5dd78', '#ff9cce'];
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
    agentLimit: 56,
    mode: 'collab',
    phase: 'void',
    sound: false,
    audio: null,
    reduced: reducePreference.matches,
    clock: 0,
    lastFrameAt: null,
    delta: 16.7,
    agents: [],
    ripples: [],
    introTasks: [],
    introStarted: false,
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
    frame: 0
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
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
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
      const name = callsigns[index] || `Agent_${String(index + 1).padStart(2, '0')}`;
      const fontSize = count > 80 ? 4.2 : count > 40 ? 5.4 : 7;
      const badgeName = count > 80 && index > 11 ? `A${String(index + 1).padStart(2, '0')}` : name;
      ctx.font = `700 ${fontSize}px "DM Mono",monospace`;
      const badgeWidth = ctx.measureText(badgeName).width + 5;
      if (old) { old.fontSize = fontSize; old.badgeName = badgeName; old.badgeWidth = badgeWidth; return old; }
      const fractionX = (index * .61803398875) % 1;
      const fractionY = (index * .75487766625) % 1;
      return {
        id: index, name, color: index < 4 ? leadColors[index] : palette[index % palette.length],
        x: innerWidth * (.1 + fractionX * .8), y: innerHeight * (.12 + fractionY * .75), vx: 0, vy: 0,
        history: [], targetKey: -1, lastClick: -10000, motion: null, restUntil: 0, slot: index,
        fontSize, badgeName, badgeWidth, visit: 0, pendingRipple: null
      };
    });
    state.count = count;
    document.querySelectorAll('[data-count-choice]').forEach(button => {
      const selected = Number(button.dataset.countChoice) === count;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

  function phaseTiming() { return state.reduced ? { voidEnd: 420 } : { voidEnd: 1150 }; }

  function phaseLabel(phase) {
    const labels = {
      void: ['PHASE 0 / VOID', `INITIALIZING ${state.agents.length} COLLABORATIVE AGENTS...`],
      wireframe: ['PHASE 1 / WIREFRAME', 'MAPPING LIVE COMPONENT FRAMES...'],
      materialize: ['PHASE 2 / MATERIALIZE', 'SNAPPING ELEMENTS INTO PLACE...'],
      ambient: ['PHASE 3 / AMBIENT', 'COLLABORATION SQUAD ONLINE']
    };
    dockPhase.textContent = labels[phase][0];
    status.textContent = labels[phase][1];
    document.body.classList.toggle('phase-ambient', phase === 'ambient');
    document.body.classList.toggle('phase-wireframe', phase === 'wireframe');
    document.body.classList.toggle('phase-materialize', phase === 'materialize');
    updateLeadActivity(phase);
    if (phase === 'ambient') startSectionObserver();
  }

  function updateLeadActivity(phase, sectionName = '') {
    const section = sectionName.replaceAll('-', ' ').toUpperCase();
    let tasks;
    if (phase === 'void') tasks = [['Orbiting the center vortex', 'WAIT'], ['Mapping navigation bounds', 'MAP'], ['Calibrating cursor paths', 'TUNE'], ['Preparing text sequence', 'QUEUE']];
    else if (phase === 'wireframe') tasks = [['Dragging hero frame', 'LAYOUT'], ['Positioning navigation', 'BUILD'], ['Sizing image and motion', 'FRAME'], ['Placing copy regions', 'COPY']];
    else if (phase === 'materialize') tasks = [['Setting editorial type', 'TYPE'], ['Snapping UI components', 'SNAP'], ['Revealing image layers', 'REVEAL'], ['Typing profile details', 'WRITE']];
    else if (section) tasks = [[`Tuning ${section} layout`, 'EDIT'], [`Assembling ${section} UI`, 'BUILD'], [`Applying ${section} motion`, 'MOTION'], [`Typing ${section} copy`, 'WRITE']];
    else tasks = [['Inspecting section rhythm', 'EDIT'], ['Checking project cards', 'BUILD'], ['Tracking scroll reveals', 'MOTION'], ['Reviewing content details', 'WRITE']];
    ['designer', 'frontend', 'motion', 'content'].forEach((role, index) => {
      const row = document.querySelector(`[data-role-activity="${role}"]`);
      if (!row) return;
      row.querySelector('small').textContent = tasks[index][0];
      row.querySelector('span').textContent = tasks[index][1];
      row.classList.toggle('working', phase !== 'void');
    });
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
      const rect = getRect(target);
      if (!target || !rect) return null;
      const leadId = index < 4 ? index : 8 + (index - 4) * 2;
      const partnerId = index < 4 ? 4 + index : leadId + 1;
      const lead = state.agents[leadId] || state.agents[index % state.agents.length];
      const partner = state.agents[partnerId] || state.agents[(index + 1) % state.agents.length];
      const durationFactor = state.reduced ? .16 : 1;
      const leadStart = { x: clamp(rect.x - 8, 8, innerWidth - 24), y: clamp(rect.y - 8, 8, innerHeight - 24) };
      const leadEnd = { x: clamp(rect.x + rect.w - 8, 8, innerWidth - 24), y: clamp(rect.y + rect.h - 8, 8, innerHeight - 24) };
      const partnerPoint = { x: clamp(rect.x + rect.w - 8, 8, innerWidth - 24), y: clamp(rect.y - 8, 8, innerHeight - 24) };
      const distance = Math.hypot(leadStart.x - lead.x, leadStart.y - lead.y);
      const moveDuration = state.reduced ? 80 : Math.round(clamp(360 + distance * .24 + ((index * 67) % 130), 440, 920));
      return {
        kind: 'intro', index, plan, target, rect, lead, partner, leadStart, leadEnd, partnerPoint,
        status: 'queued', startAt: state.clock + (state.reduced ? index * 24 : Math.round(plan.offset * .65)),
        moveDuration: Math.round(moveDuration * durationFactor), dragDuration: state.reduced ? 100 : 480 + (index % 3) * 90,
        confirmDuration: state.reduced ? 80 : 180, partIndex: 0, materializeAt: null, revealItems: [],
        label: plan.label, color: palette[(index * 3) % palette.length]
      };
    }).filter(Boolean);
    state.nextMaterializeIndex = 0;
    state.agents.forEach((agent, index) => {
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
    return task.revealItems.length === 0 || (task.revealItems.every(item => item.done) && now >= task.revealFinishAt && state.typeJobs.size === 0);
  }

  function beginIntroMaterialization(task, now) {
    const section = document.querySelector(`[data-build-section="${task.plan.section}"]`);
    revealSection(section);
    task.revealItems = introRevealItems(task, now);
    task.revealFinishAt = task.revealItems.reduce((finish, item) => Math.max(finish, item.due + (item.typedElement ? [...item.typedElement.textContent].length * (state.reduced ? 0 : item.speed) + 180 : 380)), now);
    task.status = 'materializing';
    task.materializeAt = now;
    updateLeadActivity('materialize', task.plan.section);
  }

  function updateIntroMaterialization(now) {
    let task = state.introTasks.find(item => item.status === 'materializing');
    if (!task) {
      task = state.introTasks.find(item => item.status === 'ready');
      if (task) beginIntroMaterialization(task, now);
    }
    if (!task) return;
    task.revealItems.forEach(item => { if (!item.done && now >= item.due) fireRevealItem(item, now); });
    if (revealTaskComplete(task, now)) {
      task.status = 'done';
      task.completedAt = now;
      mechanicalClick();
      if (state.introTasks.every(item => item.status === 'done')) status.textContent = 'PORTFOLIO ASSEMBLED · SCROLL TO BUILD MORE';
    }
  }

  function startSectionObserver() {
    if (state.observer || state.fallbackScrollHandler) return;
    if (!('IntersectionObserver' in window)) {
      state.fallbackScrollHandler = () => {
        document.querySelectorAll('main > [data-build-section], footer[data-build-section]').forEach(section => {
          if (section.dataset.buildSection === 'hero' || section.classList.contains('section-built') || section.classList.contains('section-building')) return;
          const rect = section.getBoundingClientRect();
          if (rect.top < innerHeight * .86 && rect.bottom > 76) constructSection(section);
        });
      };
      window.addEventListener('scroll', state.fallbackScrollHandler, { passive: true });
      window.addEventListener('resize', state.fallbackScrollHandler);
      state.fallbackScrollHandler();
      return;
    }
    state.observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const section = entry.target;
        if (!section.classList.contains('section-built') && !section.classList.contains('section-building')) constructSection(section);
        state.observer.unobserve(section);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('main > [data-build-section], footer[data-build-section]').forEach(section => {
      if (!['hero'].includes(section.dataset.buildSection) && !section.classList.contains('section-built')) state.observer.observe(section);
    });
  }

  function constructSection(section) {
    if (!section || state.sectionBuilds.has(section) || section.classList.contains('section-built')) return;
    const task = { kind: 'section', section, target: section, label: section.dataset.buildSection.toUpperCase(), color: palette[(state.sectionQueue.length + 4) % palette.length], status: 'queued', startAt: state.clock, revealItems: [], revealFinishAt: 0, lastScrollY: window.scrollY };
    section.classList.add('section-building');
    state.sectionBuilds.set(section, task);
    state.sectionQueue.push(task);
    state.layoutCache.dirty = true;
    updateLeadActivity('ambient', section.dataset.buildSection);
  }

  function startQueuedSections(now) {
    let active = [...state.sectionBuilds.values()].filter(task => task.status !== 'queued' && task.status !== 'done').length;
    while (active < 2 && state.sectionQueue.length) {
      const task = state.sectionQueue.shift();
      if (!task || !task.section.isConnected || task.section.classList.contains('section-built')) {
        if (task) state.sectionBuilds.delete(task.section);
        continue;
      }
      const pairIndex = state.nextAgentPair++ % 8;
      const leadId = pairIndex < 4 ? pairIndex : 8 + (pairIndex - 4) * 2;
      const partnerId = pairIndex < 4 ? 4 + pairIndex : leadId + 1;
      task.lead = state.agents[leadId] || state.agents[0];
      task.partner = state.agents[partnerId] || state.agents[1];
      task.startAt = now + active * 180;
      task.moveDuration = state.reduced ? 80 : 520 + (pairIndex % 4) * 75;
      task.dragDuration = state.reduced ? 100 : 540 + (pairIndex % 3) * 85;
      task.confirmDuration = state.reduced ? 80 : 180;
      task.status = 'scheduled';
      active++;
    }
  }

  function refreshLayoutCache() {
    if (!state.layoutCache.dirty && state.clock - state.layoutCache.updatedAt < 250) return;
    const candidates = [...document.querySelectorAll('[data-build-piece].piece-built, [data-build-section].section-built, [data-build-section].section-built a')];
    const seen = new Set();
    const anchors = [];
    for (const element of candidates) {
      if (element.closest('[data-build-section]:not(.section-built), [data-build-piece]:not(.piece-built)')) continue;
      const rect = getRect(element);
      if (!rect || rect.w < 12 || rect.h < 9) continue;
      const key = `${Math.round(rect.x / 12)}:${Math.round(rect.y / 12)}:${Math.round(rect.w / 20)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      anchors.push({ element, rect, key });
    }
    const elements = [...document.querySelectorAll('[data-build-section], [data-build-piece]')];
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

  function drawFrame(box, color, progress, opacity = 1, settled = false) {
    const r = box.rect;
    const p = clamp(progress, 0, 1);
    const w = Math.max(2, r.w * p), h = Math.max(2, r.h * p);
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = 'rgba(59,130,246,0.08)';
    ctx.fillRect(r.x, r.y, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash(settled ? [] : [4, 4]);
    ctx.strokeRect(r.x + .5, r.y + .5, w, h);
    ctx.setLineDash([]);
    const handle = 5;
    ctx.fillStyle = '#fff';
    [[r.x, r.y], [r.x + w, r.y], [r.x, r.y + h], [r.x + w, r.y + h]].forEach(([x, y]) => ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle));
    const text = `${box.label} ${Math.round(w)}×${Math.round(h)}px`;
    ctx.font = '600 7px "DM Mono",monospace';
    const textWidth = ctx.measureText(text).width;
    const labelWidth = textWidth + 10;
    drawRoundRect(r.x, Math.max(2, r.y - 15), labelWidth, 12, 3);
    ctx.fillStyle = 'rgba(7,7,9,.92)';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = .75;
    ctx.stroke();
    ctx.fillStyle = '#f5f2ec';
    ctx.fillText(text, r.x + 5, Math.max(10, r.y - 7));
    if (settled) {
      ctx.font = '600 7px "DM Mono",monospace';
      ctx.fillStyle = '#080808';
      ctx.fillRect(r.x + Math.max(0, r.w - 63), r.y + 5, 58, 13);
      ctx.fillStyle = '#c5dd78';
      ctx.fillText('✓ LOCKED', r.x + Math.max(3, r.w - 59), r.y + 14);
    }
    ctx.restore();
  }

  function drawCursor(agent, now, showTrail = true) {
    if (showTrail && agent.history.length > 1) {
      for (let i = 1; i < agent.history.length; i++) {
        const p0 = agent.history[i - 1];
        const p1 = agent.history[i];
        const progress = i / agent.history.length;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.strokeStyle = agent.color;
        ctx.globalAlpha = progress * 0.45;
        ctx.lineWidth = 0.6 + progress * 0.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const size = state.count > 80 ? 5 : state.count > 40 ? 7 : 9;
    ctx.save();
    ctx.translate(agent.x, agent.y);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(size * .68, size * 1.65);
    ctx.lineTo(size * 1.12, size * .98);
    ctx.lineTo(size * 1.9, size * 1.02);
    ctx.closePath();
    ctx.fillStyle = agent.color;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = .8;
    ctx.stroke();
    const fontSize = agent.fontSize || (state.count > 80 ? 4.2 : state.count > 40 ? 5.4 : 7);
    const badgeName = agent.badgeName || agent.name;
    ctx.font = `700 ${fontSize}px "DM Mono",monospace`;
    const badgeWidth = agent.badgeWidth || ctx.measureText(badgeName).width + 5;
    const badgeHeight = fontSize + 4;
    const flipX = (agent.x + size * 1.85 + badgeWidth > innerWidth - 8);
    const flipY = (agent.flipY || (agent.y + badgeHeight + 16 > innerHeight));
    const bx = flipX ? -(badgeWidth + 4) : size * 1.85;
    const by = flipY ? -(badgeHeight + 2) : size * 1.08;
    ctx.fillStyle = agent.color;
    ctx.fillRect(bx, by, badgeWidth, badgeHeight);
    ctx.fillStyle = '#09090b';
    ctx.fillText(badgeName, bx + 2.5, by + fontSize + .6);
    ctx.restore();
  }

  function drawVortex(elapsed) {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    state.agents.forEach((agent, index) => {
      const angle = index * 2.39996 + (state.reduced ? 0 : elapsed * 0.006);
      const radius = 8 + (index % 8) * 3;
      agent.x = cx + Math.cos(angle) * radius;
      agent.y = cy + Math.sin(angle) * radius * .62;
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
    if ((task.status === 'queued' || task.status === 'scheduled') && now >= task.startAt && !startTaskRoute(task, now)) return;
    if (task.status === 'moving' || task.status === 'dragging' || task.status === 'confirming' || task.status === 'ready' || task.status === 'materializing') {
      const scrollDelta = window.scrollY - (task.lastScrollY ?? window.scrollY);
      if (scrollDelta && task.kind === 'section') {
        task.rect.y -= scrollDelta;
        task.leadStart.y -= scrollDelta; task.leadEnd.y -= scrollDelta; task.partnerPoint.y -= scrollDelta;
        if (task.moveFromLead) task.moveFromLead.y -= scrollDelta;
        if (task.moveFromPartner) task.moveFromPartner.y -= scrollDelta;
        task.lead.y -= scrollDelta; task.partner.y -= scrollDelta;
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
    updateLeadActivity('ambient', task.section.dataset.buildSection);
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
      activeAgents.add(task.lead); activeAgents.add(task.partner);
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
        if (task.status === 'dragging') {
          task.lead.x = task.leadStart.x + (task.leadEnd.x - task.leadStart.x) * p;
          task.lead.y = task.leadStart.y + (task.leadEnd.y - task.leadStart.y) * p;
        } else if (settled) {
          task.lead.x = task.leadEnd.x; task.lead.y = task.leadEnd.y;
          task.partner.x = task.partnerPoint.x; task.partner.y = task.partnerPoint.y;
        }
      }
    }
    if (state.phase !== 'ambient') {
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
    updateTypeJobs(state.clock);
    updateCountJobs(state.clock);
    updateConstructionTasks(state.clock);
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    if (state.phase === 'void') drawVortex(state.clock);
    else {
      drawConstructionTasks(state.clock);
      if (state.phase === 'ambient') drawAmbient(state.clock);
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
    document.body.classList.remove('phase-ambient', 'phase-wireframe', 'phase-materialize');
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

  function replayBuild() {
    restoreBuildState();
    state.phase = 'void';
    status.textContent = `INITIALIZING ${state.agents.length} COLLABORATIVE AGENTS...`;
    updateLeadActivity('void');
    state.agents.forEach(agent => {
      agent.x = innerWidth / 2;
      agent.y = innerHeight / 2;
      agent.vx = 0; agent.vy = 0; agent.motion = null; agent.restUntil = 0;
      agent.history.length = 0;
      agent.targetKey = -1;
      agent.lastClick = -10000;
      agent.pendingRipple = null;
    });
    ensureFrameLoop();
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

  function setMode(mode) {
    state.mode = mode;
    state.agents.forEach(agent => { agent.motion = null; agent.vx = 0; agent.vy = 0; agent.restUntil = state.clock + 350; });
    document.body.classList.toggle('mode-wireframe', mode === 'wireframe');
    document.body.classList.toggle('mode-follow', mode === 'follow');
    if (state.phase === 'ambient') {
      const labels = { collab: 'Collaborating across visible components', wireframe: 'Inspecting blueprint coordinates', follow: 'Following the pointer together' };
      ['designer', 'frontend', 'motion', 'content'].forEach(role => {
        const row = document.querySelector(`[data-role-activity="${role}"]`);
        row.querySelector('small').textContent = labels[mode];
        row.querySelector('span').textContent = mode === 'collab' ? 'EDIT' : mode.toUpperCase();
      });
    }
    document.querySelectorAll('[data-mode-choice]').forEach(button => {
      const selected = button.dataset.modeChoice === mode;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }

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
  window.addEventListener('resize', () => { resizeCanvas(); state.layoutCache.dirty = true; });
  window.addEventListener('scroll', () => { state.layoutCache.dirty = true; }, { passive: true });
  window.addEventListener('pointermove', event => {
    state.mouse.x = event.clientX;
    state.mouse.y = event.clientY;
    state.mouse.active = true;
  }, { passive: true });
  window.addEventListener('pointerleave', () => { state.mouse.active = false; });

  document.querySelectorAll('[data-count-choice]').forEach(button => button.addEventListener('click', () => makeAgents(Number(button.dataset.countChoice))));
  document.querySelectorAll('[data-mode-choice]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.modeChoice)));
  byId('activity-collapse').addEventListener('click', event => {
    const collapsed = document.body.classList.toggle('activity-collapsed');
    event.currentTarget.setAttribute('aria-expanded', String(!collapsed));
    event.currentTarget.setAttribute('aria-label', collapsed ? 'Expand activity list' : 'Collapse activity list');
    event.currentTarget.textContent = collapsed ? '+' : '−';
  });
  byId('replay-build').addEventListener('click', replayBuild);
  byId('sound-toggle').addEventListener('click', event => {
    state.sound = !state.sound;
    if (state.sound) initializeAudio();
    event.currentTarget.setAttribute('aria-pressed', String(state.sound));
    event.currentTarget.querySelector('span').textContent = `SOUND ${state.sound ? 'ON' : 'OFF'}`;
    if (state.sound) mechanicalClick();
  });
  byId('motion-mode').addEventListener('click', event => {
    state.reduced = !state.reduced;
    document.body.classList.toggle('motion-reduced', state.reduced);
    makeAgents(state.count);
    applyReducedMotion();
    event.currentTarget.setAttribute('aria-pressed', String(state.reduced));
    event.currentTarget.querySelector('span').textContent = state.reduced ? 'MOTION REDUCED' : 'MOTION FULL';
    if (state.phase !== 'ambient') replayBuild();
  });
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
  if (isMobile) {
    document.body.classList.add('activity-collapsed');
    const collapseBtn = byId('activity-collapse');
    if (collapseBtn) {
      collapseBtn.setAttribute('aria-expanded', 'false');
      collapseBtn.setAttribute('aria-label', 'Expand activity list');
      collapseBtn.textContent = '+';
    }
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
  byId('motion-mode').setAttribute('aria-pressed', String(state.reduced));
  byId('motion-mode').querySelector('span').textContent = state.reduced ? 'MOTION REDUCED' : 'MOTION FULL';
  reducePreference.addEventListener('change', event => {
    state.reduced = event.matches;
    document.body.classList.toggle('motion-reduced', state.reduced);
    makeAgents(state.count);
    applyReducedMotion();
    byId('motion-mode').setAttribute('aria-pressed', String(state.reduced));
    byId('motion-mode').querySelector('span').textContent = state.reduced ? 'MOTION REDUCED' : 'MOTION FULL';
    if (state.phase !== 'ambient') replayBuild();
  });
  phaseLabel('void');
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
      state.lastFrameAt = null;
    } else ensureFrameLoop();
  });
  ensureFrameLoop();
})();
