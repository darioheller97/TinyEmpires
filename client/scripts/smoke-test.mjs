// Headless smoke test: joins the room, builds, spawns, routes, and reports.
// Usage: node scripts/smoke-test.mjs [ws://localhost:2567]
import { Client } from 'colyseus.js';

const url = process.argv[2] || 'ws://localhost:2567';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const client = new Client(url);
const room = await client.joinOrCreate('game_room', { name: 'SmokeTester' });
let state = null;
room.onStateChange(s => { state = s; });
await sleep(1500);

check('state received', !!state);
check('4 cities', state.cities.size === 4, `got ${state.cities.size}`);
check('12 directed roads', state.roads.size === 12, `got ${state.roads.size}`);
check('2 lairs', state.lairs.size === 2);
check('1 intersection', state.intersections.size === 1);

const me = state.players.get(room.sessionId);
check('player exists', !!me);
check('player owns a city', !!me.connectedCityId, me.connectedCityId);
const myCity = state.cities.get(me.connectedCityId);
check('owned city ownerId matches', myCity?.ownerId === room.sessionId);

const woodBefore = me.wood;
await sleep(2500);
check('economy ticking (wood grows)', me.wood > woodBefore, `${woodBefore} -> ${me.wood}`);

// Build a barracks, then spawn a knight
room.send('build_structure', { cityId: me.connectedCityId, type: 'barracks' });
await sleep(500);
let barracks = null;
state.buildings.forEach(b => { if (b.cityId === me.connectedCityId && b.type === 'barracks') barracks = b; });
check('barracks built', !!barracks);

room.send('spawn_troops', { cityId: me.connectedCityId, type: 'knight' });
await sleep(500);
check('knight spawned', state.units.size >= 1, `units=${state.units.size}`);
check('population used', me.populationUsed === 1, `popUsed=${me.populationUsed}`);

let unit = null;
state.units.forEach(u => { if (u.ownerId === room.sessionId) unit = u; });
const t0 = unit ? unit.t : -1;
await sleep(1500);
check('unit moving along road', unit && unit.t > t0, `t ${t0?.toFixed(3)} -> ${unit?.t?.toFixed(3)}`);

// Route at the intersection toward the spider lair, so the knight sieges it
let lairRoadId = null;
state.roads.forEach((r, id) => { if (r.fromId === 'cross_mid' && r.toId === 'lair_spider') lairRoadId = id; });
check('found road to spider lair', !!lairRoadId, lairRoadId);
room.send('set_route', { intersectionId: 'cross_mid', targetRoadId: lairRoadId });
await sleep(300);
const cross = state.intersections.get('cross_mid');
check('waypoint registered', cross.waypoints.length === 1 && cross.waypoints[0].targetRoadId === lairRoadId);

// Research must be rejected while we can't afford it (gold < 40 here)
room.send('research_tech', { techId: 'prod_wood' });
await sleep(300);
check('unaffordable tech rejected', !me.researchedTechs.includes('prod_wood'), `gold=${me.gold}`);

// Auto-produce toggle
room.send('set_auto_produce', { buildingId: barracks.id, troopType: 'lancer' });
await sleep(300);
check('auto-produce set', barracks.autoProduceType === 'lancer');

// Wait for the knight to reach and besiege the spider lair
const lair = state.lairs.get('lair_spider');
const lairHp0 = lair.health;
let sieged = false;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  if (lair.health < lairHp0) { sieged = true; break; }
  let alive = false;
  state.units.forEach(u => { if (u.ownerId === room.sessionId && u.type === 'knight') alive = true; });
  if (!alive && i > 5) break;
}
check('knight sieges spider lair (lair takes damage)', sieged, `hp ${lairHp0} -> ${lair.health}`);

// Auto-produce should have created lancers by now
let lancers = 0;
state.units.forEach(u => { if (u.type === 'lancer' && u.ownerId === room.sessionId) lancers++; });
check('auto-produce spawned lancers', lancers >= 1, `lancers=${lancers}`);

// Once gold has accumulated, research must succeed
for (let i = 0; i < 90 && me.gold < 40; i++) await sleep(1000);
room.send('research_tech', { techId: 'prod_wood' });
await sleep(300);
check('affordable tech researched', me.researchedTechs.includes('prod_wood'), `gold=${me.gold}`);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
room.leave();
process.exit(failures === 0 ? 0 : 1);
