// PvP smoke test: two players send knights at each other on the same road
// and they must engage and fight (the original code let them pass through).
import { Client } from 'colyseus.js';

const url = process.argv[2] || 'ws://localhost:2567';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

async function join(name) {
  const c = new Client(url);
  const room = await c.joinOrCreate('game_room', { name });
  await sleep(800);
  return room;
}

const roomA = await join('Attacker');
const roomB = await join('Defender');
const state = roomA.state;
const meA = state.players.get(roomA.sessionId);
const meB = roomB.state.players.get(roomB.sessionId);
check('two players, two cities', meA.connectedCityId !== meB.connectedCityId,
  `${meA.connectedCityId} vs ${meB.connectedCityId}`);

roomA.send('build_structure', { cityId: meA.connectedCityId, type: 'barracks' });
roomB.send('build_structure', { cityId: meB.connectedCityId, type: 'barracks' });
await sleep(500);

// Route both players' troops toward the other's city at the crossroads
let roadToB = null, roadToA = null;
state.roads.forEach((r, id) => {
  if (r.fromId === 'cross_mid' && r.toId === meB.connectedCityId) roadToB = id;
  if (r.fromId === 'cross_mid' && r.toId === meA.connectedCityId) roadToA = id;
});
roomA.send('set_route', { intersectionId: 'cross_mid', targetRoadId: roadToB });
roomB.send('set_route', { intersectionId: 'cross_mid', targetRoadId: roadToA });

roomA.send('spawn_troops', { cityId: meA.connectedCityId, type: 'knight' });
await sleep(1200); // stagger so they meet mid-road, not exactly on the node
roomB.send('spawn_troops', { cityId: meB.connectedCityId, type: 'knight' });
await sleep(500);
check('both knights spawned', state.units.size === 2, `units=${state.units.size}`);

// Watch for engagement: both units should take damage, then die
let sawDamage = false, sawFightingStatus = false;
for (let i = 0; i < 40; i++) {
  await sleep(500);
  let damaged = 0;
  state.units.forEach(u => {
    if (u.health < u.maxHealth) damaged++;
    if (u.status === 'fighting') sawFightingStatus = true;
  });
  if (damaged >= 2) sawDamage = true;
  if (state.units.size === 0) break;
}
check('opposing units engaged (both damaged)', sawDamage);
check('units entered fighting status', sawFightingStatus);
check('battle resolved (units died)', state.units.size < 2, `units left=${state.units.size}`);
await sleep(500);
check('population refunded for player A', meA.populationUsed === 0, `popUsed=${meA.populationUsed}`);
check('population refunded for player B', meB.populationUsed === 0, `popUsed=${meB.populationUsed}`);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
roomA.leave(); roomB.leave();
process.exit(failures === 0 ? 0 : 1);
