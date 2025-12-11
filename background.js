chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'capture') {
    handleCapture(request, sender.tab || { id: request.tabId })
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('Capture error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  } else if (request.action === 'captureCustom') {
    // Handle the message from content script with coordinates
    captureCustomArea(sender.tab, request.area)
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('Custom capture error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  } else if (request.action === 'downloadImage') {
    // Handle download request from content script
    downloadDataUrl(request.dataUrl, request.filename)
      .then(() => sendResponse({ success: true }))
      .catch(err => {
        console.error('Download error:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  } else if (request.action === 'openEditor') {
    chrome.tabs.create({ url: 'editor.html' });
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    if (command === 'capture_full') {
      await handleCapture({ type: 'full' }, tab);
    } else if (command === 'capture_window') {
      await handleCapture({ type: 'window' }, tab);
    } else if (command === 'capture_custom') {
      await handleCapture({ type: 'custom' }, tab);
    }
  } catch (err) {
    console.error('Command error:', err);
  }
});

async function handleCapture(request, tab) {
  const type = request.type;

  if (type === 'window') {
    await captureWindow(tab);
  } else if (type === 'full') {
    await captureFullPage(tab);
  } else if (type === 'custom') {
    // For custom, we just tell the content script to start the UI
    // The content script will send back a 'captureCustom' message with coordinates later
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'startCustomSelection' });
    } catch (err) {
      // If content script is not ready (e.g. after reload), inject it and retry
      console.log('Content script not ready, injecting...', err);
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      // Give it a moment to initialize
      await new Promise(resolve => setTimeout(resolve, 100));
      await chrome.tabs.sendMessage(tab.id, { action: 'startCustomSelection' });
    }
  }
}

async function captureWindow(tab) {
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
  await sendCaptureToContent(tab.id, dataUrl, 'screenshot-window');
}

async function captureFullPage(tab) {
  // Get page dimensions
  const dimensions = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
      height: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio
    })
  });

  const { width, height, viewportHeight, viewportWidth, devicePixelRatio } = dimensions[0].result;
  const screenshots = [];
  const scrollSteps = Math.ceil(height / viewportHeight);

  // Scroll and capture
  for (let i = 0; i < scrollSteps; i++) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (step, vh) => window.scrollTo(0, step * vh),
      args: [i, viewportHeight]
    });

    // Wait for scroll and potential lazy loading. Increased to 1000ms to avoid MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.
    await new Promise(resolve => setTimeout(resolve, 1000));

    const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    screenshots.push(dataUrl);
  }

  // Reset scroll
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.scrollTo(0, 0)
  });

  // Stitch images
  const stitchedBlob = await stitchImages(screenshots, width, height, viewportWidth, viewportHeight, devicePixelRatio);
  const reader = new FileReader();
  reader.readAsDataURL(stitchedBlob);
  await new Promise(resolve => {
    reader.onloadend = async () => {
      await sendCaptureToContent(tab.id, reader.result, 'screenshot-full');
      resolve();
    };
  });
}

async function captureCustomArea(tab, area) {
  // Capture the visible tab
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
  const blob = await dataUrlToBlob(dataUrl);
  const bitmap = await createImageBitmap(blob);

  // Crop
  const croppedBlob = await cropBitmap(bitmap, area, area.devicePixelRatio || 1);

  const reader = new FileReader();
  reader.readAsDataURL(croppedBlob);
  await new Promise(resolve => {
    reader.onloadend = async () => {
      await sendCaptureToContent(tab.id, reader.result, 'screenshot-custom');
      resolve();
    };
  });
}

// Helper: Send capture data to content script for display/copy
async function sendCaptureToContent(tabId, dataUrl, filename) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      action: 'displayCapture',
      dataUrl: dataUrl,
      filename: filename
    });
  } catch (err) {
    console.error('Error sending capture to content script:', err);
    // Fallback: if we can't send to content script, download directly
    await downloadDataUrl(dataUrl, filename);
  }
}

// Helper: Convert Data URL to Blob
async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return await res.blob();
}

// Helper: Stitch images using OffscreenCanvas
async function stitchImages(screenshots, totalWidth, totalHeight, viewportWidth, viewportHeight, devicePixelRatio) {
  const firstBlob = await dataUrlToBlob(screenshots[0]);
  const firstBitmap = await createImageBitmap(firstBlob);

  const canvasWidth = firstBitmap.width;
  const realViewportHeight = firstBitmap.height;

  const canvas = new OffscreenCanvas(canvasWidth, screenshots.length * realViewportHeight);
  const ctx = canvas.getContext('2d');

  // Draw first one
  ctx.drawImage(firstBitmap, 0, 0);

  for (let i = 1; i < screenshots.length; i++) {
    const blob = await dataUrlToBlob(screenshots[i]);
    const bitmap = await createImageBitmap(blob);
    ctx.drawImage(bitmap, 0, i * realViewportHeight);
  }

  return await canvas.convertToBlob({ type: 'image/png' });
}

async function cropBitmap(bitmap, area, dpr = 1) {
  const scale = bitmap.width / (area.windowWidth || bitmap.width); // Fallback

  const x = area.x * scale;
  const y = area.y * scale;
  const w = area.width * scale;
  const h = area.height * scale;

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, x, y, w, h, 0, 0, w, h);

  return await canvas.convertToBlob({ type: 'image/png' });
}

async function downloadDataUrl(dataUrl, filename) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  await chrome.downloads.download({
    url: dataUrl,
    filename: `${filename}-${timestamp}.png`,
    saveAs: false
  });
}


