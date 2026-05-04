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

// --- UDP DISCOVERY LISTENER ---
const udpClient = dgram.createSocket('udp4');

udpClient.on('error', (err) => {
  console.log(`UDP client error:\n${err.stack}`);
  udpClient.close();
});

udpClient.on('message', (msg, rinfo) => {
  try {
    const data = JSON.parse(msg.toString());
    const agentId = `${rinfo.address}:${data.port}`;
    
    // If it's a new agent or updated, add to list
    if (!discoveredAgents[agentId]) {
      console.log(`New Agent Discovered: ${data.name} at ${rinfo.address}`);
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
  console.log(`UDP Discovery listening on port ${address.port}`);
});

// Bind to port 4001 to listen for broadcasts
udpClient.bind(4001);

// Clean up stale agents (if they haven't broadcasted in 10 seconds)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const agentId in discoveredAgents) {
    if (now - discoveredAgents[agentId].lastSeen > 10000) {
      console.log(`Agent offline: ${discoveredAgents[agentId].name}`);
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
  console.log('Dashboard connected:', socket.id);

  // Send current agents immediately
  socket.emit('agents_updated', Object.values(discoveredAgents));

  socket.on('disconnect', () => {
    console.log('Dashboard disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Mother System Backend running on port ${PORT}`);
});
