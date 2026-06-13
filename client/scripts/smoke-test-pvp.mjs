// PvP smoke test on a generated map: two players push troops out; expect
// engagements or sieges to deal damage, and population to be refunded.
import { Client } from 'colyseus.js';

const url = process.argv[2] || 'ws://localhost:2567';
const SEED = 7;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` â€” ${detail}` : ''}`);
  if (!cond) failures++;
}

// Own room (create + joinById) so we never land in someone else's game
const roomA = await new Client(url).create('game_room', { name: 'Attacker', mapSeed: SEED });
await sleep(600);
const roomB = await new Client(url).joinById(roomA.roomId, { name: 'Defender' });
await sleep(600);
const state = roomA.state;
// Lobby handshake: B readies, host A starts the match.
check('starts in lobby', state.phase === 'lobby', `phase=${state.phase}`);
roomB.send('set_ready', { ready: true });
await sleep(400);
roomA.send('start_match', {});
await sleep(900);
check('match active', state.phase === 'active', `phase=${state.phase}`);
const meA = state.players.get(roomA.sessionId);
const meB = roomB.state.players.get(roomB.sessionId);
check('two players, two cities', meA.connectedCityId !== meB.connectedCityId,
  `${meA.connectedCityId} vs ${meB.connectedCityId}`);

roomA.send('build_structure', { cityId: meA.connectedCityId, type: 'barracks' });
roomB.send('build_structure', { cityId: meB.connectedCityId, type: 'barracks' });
await sleep(500);

roomA.send('spawn_troops', { cityId: meA.connectedCityId, type: 'knight' });
await sleep(1000);
roomB.send('spawn_troops', { cityId: meB.connectedCityId, type: 'knight' });
await sleep(500);
check('both knights spawned', state.units.size === 2, `units=${state.units.size}`);

// Expect combat or siege damage somewhere within 90s, then resolution
const cityHp0 = new Map();
state.cities.forEach((c, id) => cityHp0.set(id, c.health));
let sawUnitDamage = false, sawSiege = false, sawFighting = false;
const playerUnits = () => {
  let n = 0;
  state.units.forEach(u => { if (u.ownerId === roomA.sessionId || u.ownerId === roomB.sessionId) n++; });
  return n;
};
for (let i = 0; i < 180; i++) {
  await sleep(500);
  state.units.forEach(u => {
    if (u.health < u.maxHealth) sawUnitDamage = true;
    if (u.status === 'fighting' || u.status === 'sieging') sawFighting = true;
  });
  state.cities.forEach((c, id) => { if (c.health < cityHp0.get(id)) sawSiege = true; });
  if ((sawUnitDamage || sawSiege) && playerUnits() === 0) break;
}
check('units engaged or besieged (damage observed)', sawUnitDamage || sawSiege,
  `unitDmg=${sawUnitDamage} siege=${sawSiege}`);
check('fighting/sieging status seen', sawFighting);
check('battle resolved (no player units left)', playerUnits() === 0, `units left=${playerUnits()}`);
await sleep(500);
check('population refunded for player A', meA.populationUsed === 0, `popUsed=${meA.populationUsed}`);
check('population refunded for player B', meB.populationUsed === 0, `popUsed=${meB.populationUsed}`);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
roomA.leave(); roomB.leave();
process.exit(failures === 0 ? 0 : 1);
