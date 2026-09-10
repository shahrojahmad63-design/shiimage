const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const QRCode = require('qrcode');
const { exec } = require('child_process');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Function to find local Wi-Fi / LAN IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  
  // First priority: common Wi-Fi interfaces on macOS (en0, en1)
  const priorityInterfaces = ['en0', 'en1', 'wlan0', 'wi-fi', 'eth0'];
  for (const name of priorityInterfaces) {
    if (interfaces[name]) {
      for (const net of interfaces[name]) {
        if (net.family === 'IPv4' && !net.internal && net.address !== '127.0.0.1') {
          return net.address;
        }
      }
    }
  }

  // Fallback: any non-internal IPv4
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal && net.address !== '127.0.0.1') {
        return net.address;
      }
    }
  }

  return '127.0.0.1';
}

const LOCAL_IP = getLocalIP();
const SHARE_URL = `http://${LOCAL_IP}:${PORT}`;

// Configure Multer for File Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Decode original name properly if encoded
    let originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);

    let finalName = originalName;
    let counter = 1;

    // Avoid overwriting existing files by appending a counter
    while (fs.existsSync(path.join(UPLOADS_DIR, finalName))) {
      finalName = `${baseName}_${counter}${ext}`;
      counter++;
    }

    cb(null, finalName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10 GB limit
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory state for real-time features
const connectedDevices = new Map();
const clipboardHistory = []; // Keeps last 30 clipboard entries

// Helper function to categorize file types
function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const images = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.heic'];
  const videos = ['.mp4', '.mkv', '.webm', '.mov', '.avi', '.3gp'];
  const audios = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'];
  const docs = ['.pdf', '.doc', '.docx', '.txt', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.zip', '.rar', '.7z', '.apk'];

  if (images.includes(ext)) return 'image';
  if (videos.includes(ext)) return 'video';
  if (audios.includes(ext)) return 'audio';
  if (docs.includes(ext)) return 'document';
  return 'other';
}

// API: Get Server Info & QR Code
app.get('/api/info', async (req, res) => {
  try {
    const qrDataUrl = await QRCode.toDataURL(SHARE_URL, {
      margin: 2,
      scale: 8,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });

    res.json({
      ip: LOCAL_IP,
      port: PORT,
      url: SHARE_URL,
      qrCodeDataUrl: qrDataUrl,
      connectedDevicesCount: connectedDevices.size
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// API: List Uploaded Files
app.get('/api/files', (req, res) => {
  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to read uploads folder' });
    }

    const fileList = files
      .filter(f => !f.startsWith('.'))
      .map(file => {
        const filePath = path.join(UPLOADS_DIR, file);
        const stats = fs.statSync(filePath);
        return {
          name: file,
          size: stats.size,
          createdAt: stats.birthtime || stats.mtime,
          type: getFileType(file),
          downloadUrl: `/api/download/${encodeURIComponent(file)}`,
          previewUrl: `/api/view/${encodeURIComponent(file)}`
        };
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json(fileList);
  });
});

// API: Upload Files
app.post('/api/upload', upload.array('files'), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files provided' });
  }

  const uploaded = req.files.map(file => ({
    name: file.filename,
    size: file.size,
    type: getFileType(file.filename),
    createdAt: new Date(),
    downloadUrl: `/api/download/${encodeURIComponent(file.filename)}`,
    previewUrl: `/api/view/${encodeURIComponent(file.filename)}`
  }));

  // Broadcast to all WebSocket clients that new files arrived
  broadcast({
    type: 'FILES_UPLOADED',
    files: uploaded,
    sender: req.headers['x-device-name'] || 'Connected Device'
  });

  res.json({ success: true, files: uploaded });
});

// API: Download File
app.get('/api/download/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  res.download(filePath, filename);
});

// API: View/Stream File (Inline for previews)
app.get('/api/view/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  res.sendFile(filePath);
});

// API: Delete File
app.delete('/api/files/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, filename);

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    broadcast({ type: 'FILE_DELETED', filename });
    return res.json({ success: true });
  }
  res.status(404).json({ error: 'File not found' });
});

// API: Open Folder in macOS Finder
app.post('/api/open-folder', (req, res) => {
  if (process.platform === 'darwin') {
    exec(`open "${UPLOADS_DIR}"`, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true });
    });
  } else {
    res.json({ success: false, message: 'Only supported on macOS' });
  }
});

// Broadcast WebSocket message to all connected clients
function broadcast(data, excludeWs = null) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function broadcastDeviceList() {
  const devices = Array.from(connectedDevices.values());
  broadcast({
    type: 'DEVICES_UPDATE',
    devices
  });
}

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  const clientId = Math.random().toString(36).substring(2, 9);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'REGISTER_DEVICE': {
          connectedDevices.set(ws, {
            id: clientId,
            name: data.name || 'Unknown Device',
            type: data.deviceType || 'phone',
            ip: clientIp,
            joinedAt: new Date()
          });
          broadcastDeviceList();
          // Send initial state to newly connected device
          ws.send(JSON.stringify({
            type: 'INIT_STATE',
            clipboardHistory: clipboardHistory.slice(-15),
            devices: Array.from(connectedDevices.values())
          }));
          break;
        }

        case 'SEND_CLIPBOARD': {
          if (!data.text || !data.text.trim()) return;
          const entry = {
            id: Math.random().toString(36).substring(2, 9),
            text: data.text,
            sender: data.sender || 'Device',
            timestamp: new Date()
          };
          clipboardHistory.push(entry);
          if (clipboardHistory.length > 50) clipboardHistory.shift();

          broadcast({
            type: 'CLIPBOARD_RECEIVED',
            entry
          });
          break;
        }

        case 'CLEAR_CLIPBOARD': {
          clipboardHistory.length = 0;
          broadcast({ type: 'CLIPBOARD_CLEARED' });
          break;
        }

        default:
          break;
      }
    } catch (e) {
      console.error('Error handling WS message:', e);
    }
  });

  ws.on('close', () => {
    connectedDevices.delete(ws);
    broadcastDeviceList();
  });
});

// Optimize socket connections for maximum transfer throughput
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.on('connection', (socket) => {
  socket.setNoDelay(true); // Disable Nagle's algorithm for instant streaming
  socket.setKeepAlive(true, 15000);
});

// Start Server
server.listen(PORT, '0.0.0.0', async () => {
  console.log('\n======================================================');
  console.log('       🚀 Wi-Fi QuickShare (Mac ⇄ Android) 🚀        ');
  console.log('======================================================');
  console.log(`\n📡 MacBook Local IP:  ${LOCAL_IP}`);
  console.log(`🔗 Local URL:        http://localhost:${PORT}`);
  console.log(`📱 Android Access:   ${SHARE_URL}\n`);
  console.log('📂 Shared Files Folder: ' + UPLOADS_DIR);
  console.log('\nScan this QR Code with your Android camera/scanner:\n');

  try {
    const qrString = await QRCode.toString(SHARE_URL, { type: 'terminal', small: true });
    console.log(qrString);
  } catch (err) {
    console.error('Failed to generate terminal QR code:', err);
  }

  console.log('======================================================');
  console.log(`💡 Tip: Make sure both MacBook & Android are on the`);
  console.log(`   same Wi-Fi network (or Android Hotspot).`);
  console.log('======================================================\n');
});
