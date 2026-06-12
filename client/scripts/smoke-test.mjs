// Headless smoke test against a procedurally generated map (fixed seed 16,
// which includes a crossroad). Usage: node client/scripts/smoke-test.mjs [ws://localhost:2567]
import { Client } from 'colyseus.js';

const url = process.argv[2] || 'ws://localhost:2567';
const SEED = 16;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
}

const client = new Client(url);
const room = await client.joinOrCreate('game_room', { name: 'SmokeTester', mapSeed: SEED });
let state = null;
room.onStateChange(s => { state = s; });
await sleep(1500);

check('state received', !!state);
check('4 cities generated', state.cities.size === 4, `got ${state.cities.size}`);
check('roads generated (paired)', state.roads.size >= 12 && state.roads.size % 2 === 0, `got ${state.roads.size}`);
check('2 lairs', state.lairs.size === 2);
check('crossroad on this seed', state.intersections.size >= 1, `got ${state.intersections.size}`);
check('map seed synced', state.mapSeed === SEED, `got ${state.mapSeed}`);

const me = state.players.get(room.sessionId);
check('player owns a city', !!me.connectedCityId, me.connectedCityId);
const myCity = state.cities.get(me.connectedCityId);
check('owned city ownerId matches', myCity?.ownerId === room.sessionId);

const woodBefore = me.wood;
await sleep(2500);
check('economy ticking (wood grows)', me.wood > woodBefore, `${woodBefore} -> ${me.wood}`);

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

// Routing: pick any intersection and any outgoing road
let crossId = null;
state.intersections.forEach((_, id) => { if (!crossId) crossId = id; });
let outRoad = null;
state.roads.forEach((r, id) => { if (!outRoad && r.fromId === crossId) outRoad = id; });
room.send('set_route', { intersectionId: crossId, targetRoadId: outRoad });
await sleep(300);
const cross = state.intersections.get(crossId);
check('waypoint registered', cross.waypoints.length === 1 && cross.waypoints[0].targetRoadId === outRoad);

room.send('research_tech', { techId: 'prod_wood' });
await sleep(300);
check('unaffordable tech rejected', !me.researchedTechs.includes('prod_wood'), `gold=${me.gold}`);

room.send('set_auto_produce', { buildingId: barracks.id, troopType: 'lancer' });
await sleep(300);
check('auto-produce set', barracks.autoProduceType === 'lancer');

// Troops must eventually besiege something (a neutral city or a lair)
const cityHp0 = new Map();
state.cities.forEach((c, id) => cityHp0.set(id, c.health));
const lairHp0 = new Map();
state.lairs.forEach((l, id) => lairHp0.set(id, l.health));
let siegeSeen = false;
for (let i = 0; i < 90 && !siegeSeen; i++) {
  await sleep(1000);
  state.cities.forEach((c, id) => { if (id !== me.connectedCityId && c.health < cityHp0.get(id)) siegeSeen = true; });
  state.lairs.forEach((l, id) => { if (l.health < lairHp0.get(id)) siegeSeen = true; });
}
check('troops besiege a target (city or lair damaged)', siegeSeen);

let lancers = 0;
state.units.forEach(u => { if (u.type === 'lancer' && u.ownerId === room.sessionId) lancers++; });
check('auto-produce spawned lancers', lancers >= 1, `lancers=${lancers}`);

for (let i = 0; i < 90 && me.gold < 40; i++) await sleep(1000);
room.send('research_tech', { techId: 'prod_wood' });
await sleep(300);
check('affordable tech researched', me.researchedTechs.includes('prod_wood'), `gold=${Math.floor(me.gold)}`);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
room.leave();
process.exit(failures === 0 ? 0 : 1);
