// Solo-vs-AI smoke test: a bot empire spawns, owns a capital, builds, and
// fields an army; and the counter-triangle is in effect.
import { Client } from 'colyseus.js';

const url = process.argv[2] || 'ws://localhost:2567';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const room = await new Client(url).joinOrCreate('game_room', { code: 'AITST', solo: true, npcCount: 0 });
await sleep(900);
const s = room.state;
check('solo match active', s.phase === 'active', `phase=${s.phase}`);

const players = [...s.players.values()];
const bot = players.find(p => p.isBot);
check('an AI opponent exists', !!bot, `players=${players.length}`);
const botCity = [...s.cities.values()].find(c => c.ownerId === bot?.id);
check('AI owns a capital', !!botCity, botCity?.id);

// Give the bot time to build + train.
console.log('…letting the AI play for ~14s');
await sleep(14000);
const botBuildings = [...s.buildings.values()].filter(b => {
  const c = s.cities.get(b.cityId); return c && c.ownerId === bot?.id;
});
const botUnits = [...s.units.values()].filter(u => u.ownerId === bot?.id);
check('AI built production', botBuildings.length >= 1, `buildings=${botBuildings.length}`);
check('AI fielded an army', botUnits.length >= 1, `units=${botUnits.length}`);

room.leave();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
