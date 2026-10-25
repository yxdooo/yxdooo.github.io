(() => {
  const dock = document.getElementById('pixel-pet');
  const pet = document.getElementById('pixel-pet-character');
  const sprite = document.getElementById('pixel-pet-sprite');
  const toggle = document.getElementById('pixel-pet-toggle');
  if (!dock || !pet || !sprite || !toggle) return;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const frames = { idle: 0, blink: 1, walkA: 2, walkB: 3, sit: 4, sleep: 5, wave: 6, surprised: 7 };
  const hiddenKey = 'yido-pet-hidden';
  let userHidden = false;
  try { userHidden = localStorage.getItem(hiddenKey) === 'true'; } catch (_) {}
  let x = 24;
  let frame = -1;
  let pose = 'idle';
  let facing = 'right';
  let hovered = false;
  let sleeping = false;
  let lastActivity = Date.now();
  let roamTimer = 0;
  let sleepTimer = 0;
  let blinkTimer = 0;
  let reactionTimer = 0;
  let poseTimer = 0;
  let animationId = 0;
  let walk = null;
  let occlusionScheduled = false;

  function size() { return window.innerWidth <= 680 ? 76 : 96; }
  function bottom() { return window.innerWidth <= 680 ? 7 : 8; }
  function maxX() { return Math.max(8, window.innerWidth - size() - 8); }
  function clampX(value) { return Math.max(8, Math.min(maxX(), value)); }
  function setFrame(index) {
    if (frame === index) return;
    frame = index;
    sprite.style.backgroundPositionX = `${-index * size()}px`;
    dock.dataset.frame = String(index);
  }
  function setPose(next) {
    clearTimeout(poseTimer);
    pose = next;
    dock.dataset.state = next;
    if (next === 'walk') return;
    if (motion.matches || document.hidden) { setFrame(frames[next]); return; }
    if (next === 'sit' || next === 'sleep') {
      setFrame(next === 'sit' ? frames.idle : frames.sit);
      poseTimer = setTimeout(() => { if (pose === next) setFrame(frames[next]); }, next === 'sit' ? 150 : 260);
      return;
    }
    if (next === 'wave') {
      setFrame(frames.wave);
      function flap() {
        if (pose !== 'wave' || !active() || motion.matches) return;
        setFrame(frame === frames.wave ? frames.idle : frames.wave);
        poseTimer = setTimeout(flap, 260);
      }
      poseTimer = setTimeout(flap, 260);
      return;
    }
    setFrame(frames[next]);
  }
  function setFacing(next) {
    facing = next;
    dock.dataset.facing = next;
  }
  function place(value) {
    x = clampX(value);
    pet.style.left = `${Math.round(x)}px`;
  }
  function blockers() {
    return [...document.querySelectorAll('a, button, input, select, textarea, [role="button"], .skill-group, .project, .now-card, .setup-card, .contact, .profile, .about p, footer')]
      .filter(el => el !== pet && !dock.contains(el))
      .map(el => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ el, rect }) => {
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 &&
          rect.width > 0 && rect.height > 0 && rect.bottom > window.innerHeight - 120 && rect.top < window.innerHeight;
      });
  }
  function safeAt(value, obstacles = blockers()) {
    const left = value - 5;
    const right = value + size() + 5;
    const top = window.innerHeight - bottom() - size() - 5;
    const low = window.innerHeight - bottom() + 5;
    return obstacles.every(({ rect }) => right < rect.left || left > rect.right || low < rect.top || top > rect.bottom);
  }
  function safePath(a, b, obstacles) {
    const steps = Math.ceil(Math.abs(b - a) / 12);
    for (let i = 0; i <= steps; i++) if (!safeAt(a + (b - a) * i / Math.max(1, steps), obstacles)) return false;
    return true;
  }
  function nearestSafe(obstacles) {
    const options = [];
    for (let value = 8; value <= maxX(); value += 12) if (safeAt(value, obstacles)) options.push(value);
    if (safeAt(maxX(), obstacles)) options.push(maxX());
    options.sort((a, b) => Math.abs(a - x) - Math.abs(b - x));
    return options[0];
  }
  function updateVisibility() {
    const wasOccluded = dock.dataset.occluded === 'true';
    const obstacles = blockers();
    if (!safeAt(x, obstacles)) {
      stopWalk();
      const next = nearestSafe(obstacles);
      if (next === undefined) dock.dataset.occluded = 'true';
      else { place(next); dock.dataset.occluded = 'false'; }
    } else dock.dataset.occluded = 'false';
    const inaccessible = userHidden || dock.dataset.occluded === 'true';
    pet.tabIndex = inaccessible ? -1 : 0;
    pet.setAttribute('aria-hidden', String(inaccessible));
    if (inaccessible && document.activeElement === pet) toggle.focus();
    if (wasOccluded && !inaccessible) { scheduleRoam(); scheduleBlink(); scheduleSleep(); }
  }
  function queueVisibility() {
    if (occlusionScheduled) return;
    occlusionScheduled = true;
    requestAnimationFrame(() => { occlusionScheduled = false; updateVisibility(); });
  }
  function stopWalk() {
    if (animationId) cancelAnimationFrame(animationId);
    animationId = 0;
    walk = null;
    if (pose === 'walk') setPose('idle');
  }
  function clearActions() {
    clearTimeout(roamTimer);
    clearTimeout(blinkTimer);
    clearTimeout(reactionTimer);
    clearTimeout(poseTimer);
    stopWalk();
  }
  function active() { return !userHidden && !document.hidden && dock.dataset.occluded !== 'true'; }
  function scheduleBlink() {
    clearTimeout(blinkTimer);
    if (!active() || motion.matches || sleeping) return;
    blinkTimer = setTimeout(() => {
      if (pose === 'idle' && !hovered) {
        setPose('blink');
        setTimeout(() => { if (pose === 'blink') setPose('idle'); }, 150);
      }
      scheduleBlink();
    }, 3200 + Math.random() * 3800);
  }
  function finishWalk() {
    stopWalk();
    setPose(Math.random() < 0.35 ? 'sit' : 'idle');
    scheduleRoam();
  }
  function walkTo(target) {
    const startX = x;
    const distance = Math.abs(target - startX);
    const duration = distance / 42 * 1000;
    setFacing(target < startX ? 'left' : 'right');
    walk = { target, startX, duration, startTime: 0 };
    setPose('walk');
    function step(time) {
      if (!walk || !active() || motion.matches || hovered || sleeping) { stopWalk(); return; }
      if (!walk.startTime) walk.startTime = time;
      const progress = Math.min(1, (time - walk.startTime) / walk.duration);
      const nextX = walk.startX + (walk.target - walk.startX) * progress;
      if (!safeAt(nextX)) { finishWalk(); queueVisibility(); return; }
      place(nextX);
      setFrame(Math.floor((time - walk.startTime) / 210) % 2 ? frames.walkB : frames.walkA);
      if (progress < 1) animationId = requestAnimationFrame(step);
      else finishWalk();
    }
    animationId = requestAnimationFrame(step);
  }
  function startRoam() {
    if (!active() || motion.matches || hovered || sleeping) return;
    const obstacles = blockers();
    const targets = [];
    for (const direction of [-1, 1]) {
      for (const distance of [18, 26, 32, 60, 100, 140]) {
        const candidate = clampX(x + direction * distance);
        if (Math.abs(candidate - x) >= 16 && safePath(x, candidate, obstacles)) targets.push(candidate);
      }
    }
    if (targets.length) walkTo(targets[Math.floor(Math.random() * targets.length)]);
    else { setPose('sit'); scheduleRoam(); }
  }
  function scheduleRoam(delay = 6000 + Math.random() * 6000) {
    clearTimeout(roamTimer);
    if (!active() || motion.matches || hovered || sleeping) return;
    roamTimer = setTimeout(startRoam, delay);
  }
  function sleep() {
    if (!active() || motion.matches) return;
    clearActions();
    sleeping = true;
    setPose('sleep');
  }
  function scheduleSleep() {
    clearTimeout(sleepTimer);
    if (!active() || motion.matches) return;
    sleepTimer = setTimeout(sleep, Math.max(0, 45000 - (Date.now() - lastActivity)));
  }
  function wake() {
    if (!sleeping) return;
    sleeping = false;
    setPose('surprised');
    clearTimeout(reactionTimer);
    reactionTimer = setTimeout(() => { if (!sleeping) setPose(hovered ? 'wave' : 'idle'); scheduleRoam(); }, 650);
    scheduleBlink();
  }
  function recordActivity() {
    lastActivity = Date.now();
    if (sleeping) wake();
    scheduleSleep();
  }
  function setUserHidden(next) {
    userHidden = next;
    dock.dataset.hidden = String(next);
    toggle.textContent = next ? 'Show pet' : 'Hide pet';
    toggle.setAttribute('aria-label', next ? 'Show pixel robot' : 'Hide pixel robot');
    toggle.setAttribute('aria-pressed', String(next));
    try { localStorage.setItem(hiddenKey, String(next)); } catch (_) {}
    if (next) { clearActions(); clearTimeout(sleepTimer); sleeping = false; setPose('idle'); }
    else { updateVisibility(); scheduleRoam(); scheduleBlink(); scheduleSleep(); }
    updateVisibility();
  }

  pet.addEventListener('pointerenter', () => {
    hovered = true;
    clearTimeout(roamTimer);
    stopWalk();
    if (sleeping) wake();
    setPose('wave');
    recordActivity();
  });
  pet.addEventListener('pointerleave', () => {
    hovered = false;
    if (pose === 'wave') setPose('idle');
    scheduleRoam();
  });
  pet.addEventListener('focus', () => {
    hovered = true;
    clearTimeout(roamTimer);
    stopWalk();
    setPose('wave');
  });
  pet.addEventListener('blur', () => { hovered = false; setPose('idle'); scheduleRoam(); });
  pet.addEventListener('click', () => {
    recordActivity();
    clearTimeout(reactionTimer);
    clearTimeout(poseTimer);
    stopWalk();
    setPose('surprised');
    reactionTimer = setTimeout(() => { setPose(hovered ? 'wave' : 'idle'); scheduleRoam(); }, 850);
  });
  toggle.addEventListener('click', () => setUserHidden(!userHidden));
  for (const eventName of ['pointermove', 'keydown', 'touchstart']) {
    window.addEventListener(eventName, recordActivity, { passive: true });
  }
  window.addEventListener('scroll', () => { recordActivity(); queueVisibility(); }, { passive: true });
  window.addEventListener('resize', () => {
    stopWalk();
    frame = -1;
    place(x);
    setPose('idle');
    queueVisibility();
    scheduleRoam();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearActions(); clearTimeout(sleepTimer); setPose('idle'); }
    else { updateVisibility(); if (Date.now() - lastActivity >= 45000) sleep(); else { scheduleSleep(); scheduleRoam(); scheduleBlink(); } }
  });
  motion.addEventListener('change', () => {
    clearActions();
    clearTimeout(sleepTimer);
    sleeping = false;
    setPose('idle');
    if (!motion.matches) { scheduleRoam(); scheduleBlink(); scheduleSleep(); }
  });

  place(x);
  setFacing(facing);
  setPose('idle');
  setUserHidden(userHidden);
  queueVisibility();
})();




