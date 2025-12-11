chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startCustomSelection') {
    initCustomCapture();
  } else if (request.action === 'displayCapture') {
    handleDisplayCapture(request);
  }
});

async function handleDisplayCapture(request) {
  const { dataUrl, filename } = request;
  const blob = await (await fetch(dataUrl)).blob();

  // 1. Copy to clipboard
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        [blob.type]: blob
      })
    ]);
    showToast('Screenshot copied to clipboard!');
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    showToast('Failed to copy to clipboard', true);
  }

  // 2. Show Save Modal
  showSaveModal(dataUrl, filename);
}

function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.backgroundColor = isError ? '#ff4444' : '#333';
  toast.style.color = '#fff';
  toast.style.padding = '10px 20px';
  toast.style.borderRadius = '5px';
  toast.style.zIndex = '1000001';
  toast.style.fontFamily = 'sans-serif';
  toast.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
  toast.style.opacity = '0';
  toast.style.transition = 'opacity 0.3s ease';

  document.body.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
  });

  // Fade out and remove
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast);
      }
    }, 300);
  }, 3000);
}

function showSaveModal(dataUrl, filename) {
  // Create modal overlay
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  overlay.style.zIndex = '1000000';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.style.backdropFilter = 'blur(5px)';

  // Create modal content container
  const modal = document.createElement('div');
  modal.style.backgroundColor = '#fff';
  modal.style.padding = '20px';
  modal.style.borderRadius = '10px';
  modal.style.boxShadow = '0 5px 25px rgba(0,0,0,0.3)';
  modal.style.maxWidth = '90%';
  modal.style.maxHeight = '90%';
  modal.style.display = 'flex';
  modal.style.flexDirection = 'column';
  modal.style.gap = '15px';
  modal.style.position = 'relative';

  // Image preview
  const img = document.createElement('img');
  img.src = dataUrl;
  img.style.maxWidth = '100%';
  img.style.maxHeight = '70vh';
  img.style.objectFit = 'contain';
  img.style.border = '1px solid #eee';
  img.style.borderRadius = '4px';

  // Buttons container
  const buttons = document.createElement('div');
  buttons.style.display = 'flex';
  buttons.style.justifyContent = 'flex-end';
  buttons.style.gap = '15px';
  buttons.style.marginTop = '10px';

  // Helper to create icon button
  const createIconButton = (svgPath, title, onClick) => {
    const btn = document.createElement('button');
    btn.title = title;
    btn.style.background = 'none';
    btn.style.border = 'none';
    btn.style.cursor = 'pointer';
    btn.style.padding = '8px';
    btn.style.borderRadius = '50%';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.transition = 'background-color 0.2s';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', '#333');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', svgPath);

    svg.appendChild(path);
    btn.appendChild(svg);

    btn.onmouseover = () => btn.style.backgroundColor = '#f0f0f0';
    btn.onmouseout = () => btn.style.backgroundColor = 'transparent';
    btn.onclick = onClick;

    return btn;
  };

  const annotateBtn = createIconButton(
    'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
    'Annotate',
    async () => {
      // Save data to storage so editor can read it
      await chrome.storage.local.set({ screenshotDataUrl: dataUrl });

      // Open editor
      chrome.runtime.sendMessage({ action: 'openEditor' });

      closeModal();
    }
  );

  // Save button (Download icon)
  const saveBtn = createIconButton(
    'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
    'Save Image',
    () => {
      chrome.runtime.sendMessage({
        action: 'downloadImage',
        dataUrl: dataUrl,
        filename: filename
      });
      closeModal();
    }
  );

  // Close button (X icon)
  const closeBtn = createIconButton(
    'M18 6L6 18M6 6l12 12',
    'Close',
    closeModal
  );

  // Assemble
  buttons.appendChild(annotateBtn);
  buttons.appendChild(saveBtn);
  buttons.appendChild(closeBtn);
  modal.appendChild(img);
  modal.appendChild(buttons);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function closeModal() {
    if (document.body.contains(overlay)) {
      document.body.removeChild(overlay);
    }
  }

  // Close on click outside
  overlay.onclick = (e) => {
    if (e.target === overlay) {
      closeModal();
    }
  };
}

function initCustomCapture() {
  document.body.style.cursor = 'crosshair';

  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'transparent'; // Removed dark overlay as requested
  overlay.style.zIndex = '999999';
  document.body.appendChild(overlay);

  const selection = document.createElement('div');
  selection.style.border = '2px dashed #000'; // Black dashed
  selection.style.outline = '2px dashed #fff'; // White dashed outline for contrast
  selection.style.backgroundColor = 'transparent';
  selection.style.position = 'fixed';
  overlay.appendChild(selection);

  let startX, startY;
  let isSelecting = false;

  const onMouseDown = (e) => {
    isSelecting = true;
    startX = e.clientX;
    startY = e.clientY;
    selection.style.left = startX + 'px';
    selection.style.top = startY + 'px';
    selection.style.width = '0px';
    selection.style.height = '0px';
  };

  const onMouseMove = (e) => {
    if (!isSelecting) return;

    const currentX = e.clientX;
    const currentY = e.clientY;

    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    const left = Math.min(currentX, startX);
    const top = Math.min(currentY, startY);

    selection.style.width = width + 'px';
    selection.style.height = height + 'px';
    selection.style.left = left + 'px';
    selection.style.top = top + 'px';
  };

  const onMouseUp = (e) => {
    isSelecting = false;
    document.body.style.cursor = 'default';

    const rect = selection.getBoundingClientRect();

    // Cleanup
    document.body.removeChild(overlay);

    if (rect.width > 0 && rect.height > 0) {
      // Wait for repaint to ensure overlay is gone before capturing
      setTimeout(() => {
        // Send coordinates to background
        chrome.runtime.sendMessage({
          action: 'captureCustom',
          area: {
            x: rect.left,
            y: rect.top,
            width: rect.width,
            height: rect.height,
            windowWidth: window.innerWidth,
            devicePixelRatio: window.devicePixelRatio
          }
        });
      }, 50);
    }
  };

  overlay.addEventListener('mousedown', onMouseDown);
  overlay.addEventListener('mousemove', onMouseMove);
  overlay.addEventListener('mouseup', onMouseUp);
}

