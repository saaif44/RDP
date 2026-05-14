const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dgram = require('dgram');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

// Serve the React dashboard from the 'public' folder (which will be populated during build)
app.use(express.static(path.join(__dirname, 'public')));

// ===================== AUTHENTICATION =====================
// A single admin account guards the server. Credentials + the JWT signing
// secret live in a file outside the app directory so they survive packaging
// (pkg snapshots are read-only) and app updates.

function getDataDir() {
  const dir = process.platform === 'win32'
    ? path.join(process.env.APPDATA || os.homedir(), 'LocalRDP')
    : path.join(os.homedir(), '.localrdp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const AUTH_FILE = path.join(getDataDir(), 'auth.json');
const TOKEN_TTL = '12h';
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

function loadAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveAuth(data) {
  fs.writeFileSync(AUTH_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

let authConfig = loadAuth() || {};

// JWT secret: generated once on first run, then persisted.
if (!authConfig.jwtSecret) {
  authConfig.jwtSecret = crypto.randomBytes(48).toString('hex');
  saveAuth(authConfig);
}
const JWT_SECRET = authConfig.jwtSecret;

function isConfigured() {
  return !!(authConfig.username && authConfig.passwordHash);
}

function issueToken(username) {
  return jwt.sign({ sub: username }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

// --- Simple in-memory brute-force lockout, keyed by client IP ---
const loginAttempts = new Map();

function lockoutRemaining(ip) {
  const rec = loginAttempts.get(ip);
  if (rec && rec.lockedUntil && rec.lockedUntil > Date.now()) {
    return Math.ceil((rec.lockedUntil - Date.now()) / 1000);
  }
  return 0;
}

function recordFailure(ip) {
  const rec = loginAttempts.get(ip) || { count: 0 };
  rec.count += 1;
  if (rec.count >= MAX_LOGIN_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
    rec.count = 0;
  }
  loginAttempts.set(ip, rec);
}

function recordSuccess(ip) {
  loginAttempts.delete(ip);
}

// Tells the dashboard whether to show the first-run setup screen or login.
app.get('/api/auth/status', (req, res) => {
  res.json({ configured: isConfigured() });
});

// First-run only: create the single admin account.
app.post('/api/auth/setup', async (req, res) => {
  if (isConfigured()) {
    return res.status(409).json({ error: 'An admin account already exists.' });
  }
  const { username, password } = req.body || {};
  if (!username || !password || String(password).length < 8) {
    return res.status(400).json({ error: 'A username and a password of at least 8 characters are required.' });
  }
  authConfig.username = String(username).trim();
  authConfig.passwordHash = await bcrypt.hash(String(password), 12);
  saveAuth(authConfig);
  console.log(`Admin account created: ${authConfig.username}`);
  res.json({ token: issueToken(authConfig.username), username: authConfig.username });
});

// Login.
app.post('/api/auth/login', async (req, res) => {
  if (!isConfigured()) {
    return res.status(409).json({ error: 'No admin account has been set up yet.' });
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const wait = lockoutRemaining(ip);
  if (wait) {
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${wait}s.` });
  }
  const { username, password } = req.body || {};
  const match = username === authConfig.username
    && await bcrypt.compare(String(password || ''), authConfig.passwordHash);
  if (!match) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  recordSuccess(ip);
  res.json({ token: issueToken(authConfig.username), username: authConfig.username });
});

// Validate a stored token (called by the dashboard on load).
app.get('/api/auth/me', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
  res.json({ username: payload.sub });
});

// ===========================================================

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Every dashboard socket must present a valid JWT - no token, no data.
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const payload = verifyToken(token);
  if (!payload) {
    return next(new Error('unauthorized'));
  }
  socket.data.username = payload.sub;
  next();
});

// Store discovered agents
const discoveredAgents = {};
const systemLogs = [];
const MAX_SYSTEM_LOGS = 100;
const LOG_TO_CONSOLE = process.env.MOTHER_CONSOLE_LOGS === '1';

function addSystemLog(message, level = 'info') {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    level,
    message
  };

  systemLogs.push(entry);
  if (systemLogs.length > MAX_SYSTEM_LOGS) {
    systemLogs.shift();
  }

  io.emit('system_log', entry);

  if (LOG_TO_CONSOLE) {
    const output = `[${entry.timestamp}] ${message}`;
    if (level === 'error') {
      console.error(output);
    } else {
      console.log(output);
    }
  }
}

// --- UDP DISCOVERY LISTENER ---
const udpClient = dgram.createSocket('udp4');

udpClient.on('error', (err) => {
  addSystemLog(`UDP client error: ${err.stack || err.message}`, 'error');
  udpClient.close();
});

udpClient.on('message', (msg, rinfo) => {
  try {
    const data = JSON.parse(msg.toString());
    const agentId = `${rinfo.address}:${data.port}`;

    // If it's a new agent or updated, add to list
    if (!discoveredAgents[agentId]) {
      addSystemLog(`New Agent Discovered: ${data.name} at ${rinfo.address}`);
    }

    discoveredAgents[agentId] = {
      id: agentId,
      name: data.name,
      os: data.os,
      ip: rinfo.address,
      port: data.port,
      lastSeen: Date.now()
    };

    // Broadcast updated list to all dashboards
    io.emit('agents_updated', Object.values(discoveredAgents));
  } catch (e) {
    // Ignore malformed packets
  }
});

udpClient.on('listening', () => {
  const address = udpClient.address();
  addSystemLog(`UDP Discovery listening on port ${address.port}`);
});

// Bind to port 7421 to listen for broadcasts
udpClient.bind(7421);

// Clean up stale agents (if they haven't broadcasted in 10 seconds)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const agentId in discoveredAgents) {
    if (now - discoveredAgents[agentId].lastSeen > 10000) {
      addSystemLog(`Agent offline: ${discoveredAgents[agentId].name}`, 'warning');
      delete discoveredAgents[agentId];
      changed = true;
    }
  }
  if (changed) {
    io.emit('agents_updated', Object.values(discoveredAgents));
  }
}, 5000);

// --- WEBSOCKET SERVER FOR DASHBOARD ---
io.on('connection', (socket) => {
  addSystemLog(`Dashboard connected: ${socket.id} (${socket.data.username})`);

  // Send current agents immediately
  socket.emit('agents_updated', Object.values(discoveredAgents));
  socket.emit('system_logs', systemLogs);

  socket.on('clear_system_logs', () => {
    systemLogs.length = 0;
    io.emit('system_logs', systemLogs);
  });

  socket.on('disconnect', () => {
    addSystemLog(`Dashboard disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 7420;
server.listen(PORT, () => {
  addSystemLog(`Mother System Backend running on port ${PORT}`);
  if (!isConfigured()) {
    console.log('No admin account yet - open the dashboard to create one.');
  }
});
