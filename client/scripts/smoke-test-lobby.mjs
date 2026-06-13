// Lobby smoke test: code-based create/join, colour pick, ready+start, and solo.
import { Client } from 'colyseus.js';

const url = process.argv[2] || 'ws://localhost:2567';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

// ── Private code lobby: host create + join-by-code ──
const code = 'TESTX';
const host = await new Client(url).joinOrCreate('game_room', { code, name: 'Host' });
await sleep(500);
check('host lands in lobby', host.state.phase === 'lobby', `phase=${host.state.phase}`);
check('match code stored', host.state.matchCode === code, `code=${host.state.matchCode}`);
check('host is host', host.state.players.get(host.sessionId)?.isHost === true);

const guest = await new Client(url).joinOrCreate('game_room', { code, name: 'Guest' });
await sleep(500);
check('guest joined same room by code', guest.roomId === host.roomId, `${guest.roomId} vs ${host.roomId}`);
check('two players in lobby', host.state.players.size === 2, `size=${host.state.players.size}`);

// Colour pick: guest grabs colour index 2; host keeps its default.
guest.send('select_color', { index: 2 });
await sleep(300);
check('guest colour applied', guest.state.players.get(guest.sessionId)?.colorIndex === 2);

// Start gated on readiness: host start before guest ready should NOT start.
host.send('start_match', {});
await sleep(400);
check('start blocked until all ready', host.state.phase === 'lobby', `phase=${host.state.phase}`);

guest.send('set_ready', { ready: true });
await sleep(300);
host.send('start_match', {});
await sleep(900);
check('match started after ready', host.state.phase === 'active', `phase=${host.state.phase}`);
const h = host.state.players.get(host.sessionId), g = host.state.players.get(guest.sessionId);
check('both players got a capital', !!h?.connectedCityId && !!g?.connectedCityId && h.connectedCityId !== g.connectedCityId,
  `${h?.connectedCityId} vs ${g?.connectedCityId}`);
check('contested objectives spawned', host.state.objectives.size > 0, `count=${host.state.objectives.size}`);
host.leave(); guest.leave();

// ── Solo: auto-ready + auto-start, single player ──
const solo = await new Client(url).joinOrCreate('game_room', { code: 'SOLOX', solo: true, npcCount: 1 });
await sleep(900);
check('solo auto-starts', solo.state.phase === 'active', `phase=${solo.state.phase}`);
check('solo player has a capital', !!solo.state.players.get(solo.sessionId)?.connectedCityId);
solo.leave();

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
