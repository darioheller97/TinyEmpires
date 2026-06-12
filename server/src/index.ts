import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';

const PORT = parseInt(process.env.PORT || '2567', 10);

const app = express();
app.use(cors());
app.use(express.json());

// Health-check endpoint
app.get('/', (_req, res) => {
  res.json({ name: 'Tiny Empires Server', status: 'running' });
});

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
