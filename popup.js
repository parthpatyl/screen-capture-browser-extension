const fullBtn = document.getElementById('fullBtn');
const windowBtn = document.getElementById('windowBtn');
const customBtn = document.getElementById('customBtn');
const status = document.getElementById('status');

function showStatus(message, isError = false) {
  status.textContent = message;
  status.className = `status ${isError ? 'error' : 'success'}`;
  status.style.display = 'block';
  setTimeout(() => {
    status.style.display = 'none';
  }, 3000);
}

async function captureScreenshot(type) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    chrome.runtime.sendMessage({
      action: 'capture',
      type: type,
      tabId: tab.id
    }, (response) => {
      if (chrome.runtime.lastError) {
        showStatus('Error: ' + chrome.runtime.lastError.message, true);
        return;
      }
      if (response && response.success) {
        showStatus('Screenshot saved!');
      } else {
        showStatus('Failed: ' + (response ? response.error : 'Unknown error'), true);
      }
    });
  } catch (error) {
    showStatus('Error: ' + error.message, true);
  }
}

fullBtn.addEventListener('click', () => {
  captureScreenshot('full');
  window.close();
});

windowBtn.addEventListener('click', () => {
  captureScreenshot('window');
  window.close();
});

customBtn.addEventListener('click', () => {
  captureScreenshot('custom');
  window.close();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    window.close();
  }
});
