const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

// Simple in-memory rooms
const rooms = new Map();
const clients = new Map();

// Create HTTP server
const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(__dirname, 'public', url);
  const ext = path.extname(filePath);
  const contentTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

// Manual WebSocket handling using Node's built-in net
server.on('upgrade', (req, socket, head) => {
  // Accept WebSocket upgrade
  const key = req.headers['sec-websocket-key'];
  const crypto = require('crypto');
  const acceptKey = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
    '\r\n'
  );

  const clientId = Math.random().toString(36).slice(2);
  const clientInfo = { id: clientId, socket, roomId: null, name: `User_${clientId.slice(0, 4)}` };
  clients.set(clientId, clientInfo);

  socket.on('data', (buffer) => {
    try {
      const message = parseWebSocketFrame(buffer);
      if (message) {
        handleMessage(clientId, JSON.parse(message));
      }
    } catch (e) {}
  });

  socket.on('close', () => {
    const client = clients.get(clientId);
    if (client && client.roomId) {
      leaveRoom(clientId, client.roomId);
    }
    clients.delete(clientId);
  });

  socket.on('error', () => {
    clients.delete(clientId);
  });

  // Send welcome
  send(socket, { type: 'connected', clientId });
});

function parseWebSocketFrame(buffer) {
  if (buffer.length < 2) return null;
  const secondByte = buffer[1];
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    payloadLength = buffer.readUInt16BE(2);
    offset = 4;
  } else if (payloadLength === 127) {
    payloadLength = buffer.readBigUInt64BE(2);
    offset = 10;
  }

  if (masked) {
    const maskKey = buffer.slice(offset, offset + 4);
    offset += 4;
    const payload = Buffer.alloc(payloadLength);
    for (let i = 0; i < payloadLength; i++) {
      payload[i] = buffer[offset + i] ^ maskKey[i % 4];
    }
    return payload.toString('utf8');
  }
  return buffer.slice(offset, offset + payloadLength).toString('utf8');
}

function encodeWebSocketFrame(data) {
  const payload = Buffer.from(data, 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
}

function send(socket, data) {
  try {
    socket.write(encodeWebSocketFrame(JSON.stringify(data)));
  } catch (e) {}
}

function broadcast(roomId, data, excludeId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const clientId of room.clients) {
    if (clientId === excludeId) continue;
    const client = clients.get(clientId);
    if (client) send(client.socket, data);
  }
}

function handleMessage(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  switch (msg.type) {
    case 'create_room': {
      const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
      rooms.set(roomId, {
        id: roomId,
        code: '// Start coding here...\nconsole.log("Hello, World!");',
        language: 'javascript',
        clients: new Set([clientId]),
        history: [],
        createdAt: Date.now(),
      });
      client.roomId = roomId;
      client.name = msg.name || client.name;
      send(client.socket, {
        type: 'room_joined',
        roomId,
        code: rooms.get(roomId).code,
        language: rooms.get(roomId).language,
        users: [{ id: clientId, name: client.name }],
      });
      break;
    }

    case 'join_room': {
      const roomId = msg.roomId?.toUpperCase();
      const room = rooms.get(roomId);
      if (!room) {
        send(client.socket, { type: 'error', message: 'Room not found' });
        return;
      }
      room.clients.add(clientId);
      client.roomId = roomId;
      client.name = msg.name || client.name;

      const users = [...room.clients].map(id => {
        const c = clients.get(id);
        return c ? { id: c.id, name: c.name } : null;
      }).filter(Boolean);

      send(client.socket, {
        type: 'room_joined',
        roomId,
        code: room.code,
        language: room.language,
        users,
      });

      broadcast(roomId, { type: 'user_joined', user: { id: clientId, name: client.name }, users }, clientId);
      break;
    }

    case 'code_change': {
      const room = rooms.get(client.roomId);
      if (!room) return;
      room.code = msg.code;
      broadcast(client.roomId, {
        type: 'code_update',
        code: msg.code,
        cursor: msg.cursor,
        userId: clientId,
      }, clientId);
      break;
    }

    case 'language_change': {
      const room = rooms.get(client.roomId);
      if (!room) return;
      room.language = msg.language;
      broadcast(client.roomId, { type: 'language_update', language: msg.language }, clientId);
      break;
    }

    case 'cursor_move': {
      broadcast(client.roomId, {
        type: 'cursor_update',
        userId: clientId,
        name: client.name,
        position: msg.position,
      }, clientId);
      break;
    }

    case 'chat': {
      broadcast(client.roomId, {
        type: 'chat_message',
        userId: clientId,
        name: client.name,
        message: msg.message,
        timestamp: Date.now(),
      }, null);
      break;
    }

    case 'leave_room': {
      if (client.roomId) leaveRoom(clientId, client.roomId);
      break;
    }
  }
}

function leaveRoom(clientId, roomId) {
  const room = rooms.get(roomId);
  const client = clients.get(clientId);
  if (!room) return;
  room.clients.delete(clientId);
  if (client) client.roomId = null;
  if (room.clients.size === 0) {
    rooms.delete(roomId);
  } else {
    const users = [...room.clients].map(id => {
      const c = clients.get(id);
      return c ? { id: c.id, name: c.name } : null;
    }).filter(Boolean);
    broadcast(roomId, {
      type: 'user_left',
      userId: clientId,
      name: client?.name,
      users,
    });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 LiveCode server running at http://localhost:${PORT}\n`);
});