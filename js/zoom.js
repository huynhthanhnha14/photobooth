(function () {
  const modal = document.getElementById('zoom-modal');
  if (!modal) return;
  const img = document.getElementById('zoom-img');
  const caption = document.getElementById('zoom-caption');
  const btnClose = modal.querySelector('.zoom-close');
  const btnPrev = modal.querySelector('.zoom-prev');
  const btnNext = modal.querySelector('.zoom-next');

  let items = [], currentIndex = 0;
  let scale = 1, translateX = 0, translateY = 0;
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };

  function applyTransform() {
    img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  }
  function resetTransform() {
    scale = 1; translateX = 0; translateY = 0; applyTransform();
  }
  function show(index) {
    if (!items.length) return;
    currentIndex = (index + items.length) % items.length;
    const item = items[currentIndex];
    img.src = item.src;
    caption.textContent = item.caption || '';
    resetTransform();
    const showNav = items.length > 1;
    btnPrev.style.display = showNav ? 'flex' : 'none';
    btnNext.style.display = showNav ? 'flex' : 'none';
  }
  function open(list, index = 0) {
    items = list; show(index);
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    img.src = '';
  }

  btnClose.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.classList.contains('zoom-content')) close();
  });
  btnPrev.addEventListener('click', (e) => { e.stopPropagation(); show(currentIndex - 1); });
  btnNext.addEventListener('click', (e) => { e.stopPropagation(); show(currentIndex + 1); });

  document.addEventListener('keydown', (e) => {
    if (!modal.classList.contains('active')) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(currentIndex - 1);
    if (e.key === 'ArrowRight') show(currentIndex + 1);
    if (e.key === '+' || e.key === '=') { scale = Math.min(scale + 0.25, 5); applyTransform(); }
    if (e.key === '-') { scale = Math.max(scale - 0.25, 0.5); applyTransform(); }
    if (e.key === '0') resetTransform();
  });

  modal.addEventListener('wheel', (e) => {
    if (!modal.classList.contains('active')) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    scale = Math.max(0.5, Math.min(scale + delta, 5));
    applyTransform();
  }, { passive: false });

  img.addEventListener('dblclick', () => {
    if (scale > 1) resetTransform();
    else { scale = 2; applyTransform(); }
  });
  img.addEventListener('mousedown', (e) => {
    if (scale <= 1) return;
    isDragging = true;
    dragStart.x = e.clientX - translateX;
    dragStart.y = e.clientY - translateY;
    img.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    translateX = e.clientX - dragStart.x;
    translateY = e.clientY - dragStart.y;
    applyTransform();
  });
  document.addEventListener('mouseup', () => {
    isDragging = false;
    img.style.cursor = scale > 1 ? 'grab' : 'zoom-in';
  });

  let lastTouchDist = 0;
  modal.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    } else if (e.touches.length === 1 && scale > 1) {
      isDragging = true;
      dragStart.x = e.touches[0].clientX - translateX;
      dragStart.y = e.touches[0].clientY - translateY;
    }
  });
  modal.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      if (lastTouchDist > 0) {
        const ratio = dist / lastTouchDist;
        scale = Math.max(0.5, Math.min(scale * ratio, 5));
        applyTransform();
      }
      lastTouchDist = dist;
    } else if (isDragging && e.touches.length === 1) {
      e.preventDefault();
      translateX = e.touches[0].clientX - dragStart.x;
      translateY = e.touches[0].clientY - dragStart.y;
      applyTransform();
    }
  });
  modal.addEventListener('touchend', () => { lastTouchDist = 0; isDragging = false; });

  window.ZoomModal = { open, close };
})();