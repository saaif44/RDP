const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dgram = require('dgram');
const path = require('path');

const app = express();
app.use(cors());

// Serve the React dashboard from the 'public' folder (which will be populated during build)
app.use(express.static(path.join(__dirname, 'public')));


const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
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
  addSystemLog(`Dashboard connected: ${socket.id}`);

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
});
