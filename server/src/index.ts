import http from 'http';
import path from 'path';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';

const PORT = parseInt(process.env.PORT || '2567', 10);

const app = express();
app.use(cors());
app.use(express.json());

app.get('/healthz', (_req, res) => {
  res.json({ name: 'Tiny Empires Server', status: 'running' });
});

// In production the server also serves the built client (single origin,
// so the WebSocket connects to the same host that served the page).
const staticDir = process.env.STATIC_DIR || path.join(__dirname, '../../client/dist');
if (fs.existsSync(staticDir)) {
  app.use(express.static(staticDir));
  app.get('*', (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  console.log(`Serving client from ${staticDir}`);
}

const httpServer = http.createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
  }),
});

gameServer.define('game_room', GameRoom);

httpServer.listen(PORT, () => {
  console.log(`Tiny Empires server listening on ws://localhost:${PORT}`);
});
