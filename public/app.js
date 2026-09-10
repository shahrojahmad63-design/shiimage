// ==========================================================================
// QuickDrop - Client Application Engine (Mac ⇄ Android)
// ==========================================================================

let ws = null;
let currentFiles = [];
let activeFilter = 'all';
let serverInfo = null;

// Determine Client Device Type & Friendly Name
function getDeviceDetails() {
  const ua = navigator.userAgent;
  let deviceName = 'Connected Device';
  let deviceType = 'desktop';

  if (/android/i.test(ua)) {
    deviceType = 'mobile';
    deviceName = 'Android Phone';
    // Try to extract Android model if available
    const match = ua.match(/Android\s+[\d\.]+;\s+([^;]+)\s+Build/);
    if (match && match[1]) {
      deviceName = match[1].trim();
    }
  } else if (/macintosh|mac os x/i.test(ua)) {
    deviceType = 'mac';
    deviceName = 'MacBook';
  } else if (/iphone|ipad|ipod/i.test(ua)) {
    deviceType = 'mobile';
    deviceName = 'iOS Device';
  } else if (/windows/i.test(ua)) {
    deviceType = 'desktop';
    deviceName = 'Windows PC';
  } else if (/linux/i.test(ua)) {
    deviceType = 'desktop';
    deviceName = 'Linux Device';
  }

  return { name: deviceName, type: deviceType };
}

const myDevice = getDeviceDetails();

// Format File Size helper
function formatBytes(bytes, decimals = 1) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Format Relative Time helper
function formatTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return date.toLocaleDateString();
}

// Show Toast notification
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'success' ? '✓' : type === 'error' ? '⚠️' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Initialize WebSocket Connection
function initWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    // Register current device
    ws.send(JSON.stringify({
      type: 'REGISTER_DEVICE',
      name: myDevice.name,
      deviceType: myDevice.type
    }));
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'INIT_STATE':
          renderClipboardList(data.clipboardHistory || []);
          renderDevicesList(data.devices || []);
          break;

        case 'DEVICES_UPDATE':
          renderDevicesList(data.devices || []);
          break;

        case 'FILES_UPLOADED':
          fetchFiles();
          const autoSaveEl = document.getElementById('autoSaveToggle');
          const isAutoSave = autoSaveEl ? autoSaveEl.checked : true;

          // If another device sent files and Auto-Save is ON, save them directly to storage!
          if (data.sender !== myDevice.name && isAutoSave && data.files && data.files.length > 0) {
            data.files.forEach((file, index) => {
              setTimeout(() => {
                const a = document.createElement('a');
                a.href = file.downloadUrl;
                a.download = file.name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
              }, index * 300);
            });
            showToast(`⚡ Auto-saved ${data.files.length} file(s) directly to your files!`, 'success');
          } else {
            showToast(`📥 Received new files from ${data.sender}`, 'success');
          }
          break;

        case 'FILE_DELETED':
          fetchFiles();
          break;

        case 'CLIPBOARD_RECEIVED':
          addClipboardCard(data.entry, true);
          showToast(`📋 New text received from ${data.entry.sender}`, 'info');
          break;

        case 'CLIPBOARD_CLEARED':
          document.getElementById('clipboardList').innerHTML = '';
          updateClipboardBadge(0);
          toggleClipboardEmptyState(true);
          break;
      }
    } catch (e) {
      console.error('WS Error:', e);
    }
  };

  ws.onclose = () => {
    // Reconnect after 2 seconds
    setTimeout(initWebSocket, 2000);
  };
}

// Fetch Server Info (IP & QR code)
async function fetchServerInfo() {
  try {
    const res = await fetch('/api/info');
    serverInfo = await res.json();

    document.getElementById('headerIp').textContent = `${serverInfo.ip}:${serverInfo.port}`;
    document.getElementById('qrUrlText').textContent = serverInfo.url;
    document.getElementById('qrImage').src = serverInfo.qrCodeDataUrl;
  } catch (err) {
    document.getElementById('headerIp').textContent = 'Offline / Connecting';
  }
}

// Fetch and render shared files
async function fetchFiles() {
  try {
    const res = await fetch('/api/files');
    currentFiles = await res.json();
    renderFiles();
  } catch (err) {
    console.error('Error fetching files:', err);
  }
}

// Render Files Grid
function renderFiles() {
  const grid = document.getElementById('filesGrid');
  const emptyState = document.getElementById('filesEmptyState');
  const countBadge = document.getElementById('filesCountBadge');

  const filtered = activeFilter === 'all' 
    ? currentFiles 
    : currentFiles.filter(f => f.type === activeFilter);

  countBadge.textContent = currentFiles.length;

  if (filtered.length === 0) {
    grid.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  grid.innerHTML = filtered.map(file => {
    const isImg = file.type === 'image';
    const isVid = file.type === 'video';
    const isAud = file.type === 'audio';

    let iconOrThumb = '📄';
    if (isImg) {
      iconOrThumb = `<img src="${file.previewUrl}" alt="${file.name}" loading="lazy" />`;
    } else if (isVid) {
      iconOrThumb = '🎬';
    } else if (isAud) {
      iconOrThumb = '🎵';
    } else if (file.name.endsWith('.apk')) {
      iconOrThumb = '🤖';
    } else if (file.name.endsWith('.zip') || file.name.endsWith('.rar')) {
      iconOrThumb = '📦';
    }

    const canPreview = isImg || isVid || isAud;

    return `
      <div class="file-card" data-filename="${encodeURIComponent(file.name)}">
        <div class="file-card-top">
          <div class="file-thumb">${iconOrThumb}</div>
          <div class="file-details">
            <div class="file-name" title="${file.name}">${file.name}</div>
            <div class="file-meta">${formatBytes(file.size)} • ${formatTime(file.createdAt)}</div>
          </div>
        </div>
        <div class="file-actions">
          ${canPreview ? `
            <button class="btn btn-sm btn-secondary" onclick="openPreview('${encodeURIComponent(file.name)}', '${file.type}', '${encodeURIComponent(file.previewUrl)}')">
              Preview
            </button>
          ` : ''}
          <a class="btn btn-sm btn-primary" href="${file.downloadUrl}" download="${file.name}">
            Download
          </a>
          <button class="btn btn-sm btn-ghost text-danger" onclick="deleteFile('${encodeURIComponent(file.name)}')">
            ✕
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Render Connected Devices
function renderDevicesList(devices) {
  const container = document.getElementById('devicesList');
  const countEl = document.getElementById('deviceCount');

  countEl.textContent = devices.length;

  container.innerHTML = devices.map(dev => {
    const isMe = dev.name === myDevice.name;
    const icon = dev.type === 'mac' ? '💻' : dev.type === 'mobile' ? '📱' : '🖥️';

    return `
      <div class="device-chip ${isMe ? 'is-active' : ''}">
        <span class="dev-icon">${icon}</span>
        <span>${dev.name} ${isMe ? '(You)' : ''}</span>
      </div>
    `;
  }).join('');
}

// Upload Files via XHR to monitor progress
function uploadFiles(files) {
  if (!files || files.length === 0) return;

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  const progressCard = document.getElementById('uploadProgressCard');
  const progressFill = document.getElementById('progressFill');
  const progressPercentage = document.getElementById('progressPercentage');
  const progressFileName = document.getElementById('progressFileName');
  const progressSpeed = document.getElementById('progressSpeed');
  const progressSize = document.getElementById('progressSize');

  progressCard.classList.remove('hidden');
  progressFileName.textContent = files.length === 1 ? files[0].name : `Uploading ${files.length} files...`;

  let startTime = Date.now();
  const xhr = new XMLHttpRequest();

  xhr.open('POST', '/api/upload', true);
  xhr.setRequestHeader('X-Device-Name', myDevice.name);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const percent = Math.round((e.loaded / e.total) * 100);
      progressFill.style.width = percent + '%';
      progressPercentage.textContent = percent + '%';

      // Speed calculation
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > 0) {
        const speed = e.loaded / elapsed; // bytes/sec
        progressSpeed.textContent = formatBytes(speed) + '/s';
      }

      progressSize.textContent = `${formatBytes(e.loaded)} / ${formatBytes(e.total)}`;
    }
  };

  xhr.onload = () => {
    if (xhr.status === 200) {
      showToast('Files sent successfully!', 'success');
      fetchFiles();
      setTimeout(() => {
        progressCard.classList.add('hidden');
        progressFill.style.width = '0%';
      }, 1000);
    } else {
      showToast('Upload failed. Check connection.', 'error');
      progressCard.classList.add('hidden');
    }
  };

  xhr.onerror = () => {
    showToast('Network error during upload', 'error');
    progressCard.classList.add('hidden');
  };

  xhr.send(formData);
}

// Delete File
async function deleteFile(encodedFilename) {
  if (!confirm('Are you sure you want to delete this file?')) return;
  try {
    const res = await fetch(`/api/files/${encodedFilename}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('File deleted', 'info');
      fetchFiles();
    }
  } catch (err) {
    showToast('Failed to delete file', 'error');
  }
}

// Open Media Preview
window.openPreview = function(encodedFilename, type, previewUrl) {
  const filename = decodeURIComponent(encodedFilename);
  const modal = document.getElementById('previewModal');
  const title = document.getElementById('previewTitle');
  const body = document.getElementById('previewBody');
  const downloadBtn = document.getElementById('previewDownloadBtn');

  title.textContent = filename;
  downloadBtn.href = `/api/download/${encodedFilename}`;
  downloadBtn.download = filename;

  if (type === 'image') {
    body.innerHTML = `<img src="${decodeURIComponent(previewUrl)}" alt="${filename}" />`;
  } else if (type === 'video') {
    body.innerHTML = `<video src="${decodeURIComponent(previewUrl)}" controls autoplay playsinline></video>`;
  } else if (type === 'audio') {
    body.innerHTML = `<audio src="${decodeURIComponent(previewUrl)}" controls autoplay></audio>`;
  }

  modal.classList.remove('hidden');
};

// Clipboard Functions
function renderClipboardList(history) {
  const list = document.getElementById('clipboardList');
  list.innerHTML = '';
  history.forEach(item => addClipboardCard(item, false));
  updateClipboardBadge(history.length);
  toggleClipboardEmptyState(history.length === 0);
}

function addClipboardCard(entry, prepend = true) {
  const list = document.getElementById('clipboardList');
  toggleClipboardEmptyState(false);

  const card = document.createElement('div');
  card.className = 'clipboard-card';
  card.innerHTML = `
    <div class="clipboard-content">
      <div class="clipboard-text">${escapeHtml(entry.text)}</div>
      <div class="clipboard-meta">
        <span>Sent by: ${escapeHtml(entry.sender)}</span>
        <span>${formatTime(entry.timestamp)}</span>
      </div>
    </div>
    <button class="btn btn-sm btn-secondary copy-btn" onclick="copyTextToClipboard(this, \`${escapeJsString(entry.text)}\`)">
      Copy
    </button>
  `;

  if (prepend && list.firstChild) {
    list.insertBefore(card, list.firstChild);
  } else {
    list.appendChild(card);
  }

  const currentCount = list.children.length;
  updateClipboardBadge(currentCount);
}

function updateClipboardBadge(count) {
  document.getElementById('clipboardCountBadge').textContent = count;
}

function toggleClipboardEmptyState(isEmpty) {
  const emptyState = document.getElementById('clipboardEmptyState');
  if (isEmpty) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
  }
}

// Copy to Native Clipboard
window.copyTextToClipboard = async function(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    const originalText = btn.textContent;
    btn.textContent = 'Copied! ✓';
    btn.style.color = '#00e676';
    showToast('Copied to clipboard!', 'success');
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.color = '';
    }, 2000);
  } catch (err) {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    showToast('Copied to clipboard!', 'success');
  }
};

function escapeHtml(string) {
  const div = document.createElement('div');
  div.textContent = string;
  return div.innerHTML;
}

function escapeJsString(str) {
  return str.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
}

// Setup Event Listeners
function setupEvents() {
  // Navigation Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      document.getElementById(tabId).classList.add('active');
    });
  });

  // Filter Chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      activeFilter = chip.dataset.filter;
      renderFiles();
    });
  });

  // Dropzone drag & drop
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');

  dropzone.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    fileInput.click();
  });

  document.getElementById('selectFilesBtn').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    uploadFiles(e.target.files);
    fileInput.value = '';
  });

  // Mobile Camera Input
  const cameraBtn = document.getElementById('cameraBtn');
  const cameraInput = document.getElementById('cameraInput');
  if (cameraBtn && cameraInput) {
    cameraBtn.addEventListener('click', () => cameraInput.click());
    cameraInput.addEventListener('change', (e) => {
      uploadFiles(e.target.files);
      cameraInput.value = '';
    });
  }

  // Drag over events
  ['dragenter', 'dragover'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    dropzone.addEventListener(name, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
    }
  });

  // Refresh files
  document.getElementById('refreshFilesBtn').addEventListener('click', fetchFiles);

  // Open in Finder (macOS)
  const openFinderBtn = document.getElementById('openFinderBtn');
  if (openFinderBtn) {
    openFinderBtn.addEventListener('click', async () => {
      try {
        await fetch('/api/open-folder', { method: 'POST' });
        showToast('Opened received folder in Finder', 'info');
      } catch (e) {
        showToast('Failed to open folder', 'error');
      }
    });
  }

  // QR Modal
  const qrModal = document.getElementById('qrModal');
  document.getElementById('openQrBtn').addEventListener('click', () => {
    qrModal.classList.remove('hidden');
  });
  document.getElementById('closeQrModal').addEventListener('click', () => {
    qrModal.classList.add('hidden');
  });

  document.getElementById('copyUrlBtn').addEventListener('click', () => {
    const urlText = document.getElementById('qrUrlText').textContent;
    copyTextToClipboard(document.getElementById('copyUrlBtn'), urlText);
  });

  // Preview Modal Close
  document.getElementById('closePreviewModal').addEventListener('click', () => {
    document.getElementById('previewModal').classList.add('hidden');
    document.getElementById('previewBody').innerHTML = '';
  });

  // Send Clipboard
  document.getElementById('sendClipboardBtn').addEventListener('click', () => {
    const input = document.getElementById('clipboardInput');
    const text = input.value.trim();
    if (!text) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'SEND_CLIPBOARD',
        text: text,
        sender: myDevice.name
      }));
      input.value = '';
      showToast('Text shared to all devices', 'success');
    } else {
      showToast('Connecting to server...', 'error');
    }
  });

  // Paste from Device Clipboard into textarea
  document.getElementById('pasteFromDeviceBtn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        document.getElementById('clipboardInput').value = text;
        showToast('Pasted from clipboard', 'info');
      }
    } catch (e) {
      showToast('Please press Cmd+V / Ctrl+V to paste', 'info');
    }
  });

  // Clear Clipboard History
  document.getElementById('clearClipboardBtn').addEventListener('click', () => {
    if (confirm('Clear all shared clipboard history?')) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'CLEAR_CLIPBOARD' }));
      }
    }
  });

  // Set self device badge
  document.getElementById('myDeviceBadge').textContent = `This Device: ${myDevice.name}`;
}

// Initial Boot
window.addEventListener('DOMContentLoaded', () => {
  setupEvents();
  fetchServerInfo();
  fetchFiles();
  initWebSocket();
});
