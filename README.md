# Tiny Empires: Road to Conquest

Multiplayer node-based RTS / lane-pushing hybrid. Manage city hubs, expand your
influence, and send waves of troops down the roads to conquer neighboring
cities — while spiders and goblins hunt whoever hoards the most food and gold.

**Stack:** Colyseus (authoritative Node.js server) · Phaser 3 + React (client) · TypeScript everywhere.

## Gameplay

- **4 player cities** around a central crossroads (King's Cross), plus two PvE lairs.
- **Economy:** Wood (buildings), Food (units + pop cap), Gold (tech + elites).
  Owning multiple cities stacks income.
- **Units:** Knight > Archer > Lancer > Knight (rock-paper-scissors), plus
  healing Monks. Opposing armies stop and form battle lines when they meet.
- **Routing:** click an intersection and pick a destination on the radial menu;
  your troops passing through march that way (per-player, enemies can't grief it).
- **Sieges:** attackers camp at a city and batter it down; the town hall and
  Defense Towers strike back, and arriving defenders garrison and fight.
  At 0 HP the city flips: buildings burn, attacker takes a 10% resource bounty.
- **Anti-snowball:** units weaken the farther they fight from home; defenders
  near their own city resist damage.
- **PvE lairs:** spiders hunt the biggest food hoarder, goblins the biggest gold
  hoarder. Raze a lair for a bounty — it regrows after 3 minutes.
- **Barracks auto-produce:** toggle ⟳ on a unit to keep training it automatically.

## Development

```bash
npm install            # root (concurrently)
cd server && npm install
cd ../client && npm install

npm run dev            # from the root: server on :2567, client on :3000
```

Open http://localhost:3000 — multiple tabs join the same room as separate players.

### Smoke tests

With a server running locally:

```bash
node client/scripts/smoke-test.mjs          # economy, build, spawn, route, siege, tech
node client/scripts/smoke-test-pvp.mjs      # two players' armies engage and resolve
```

## Production / Deployment (TinyEmpires.icetea.me)

The server serves the built client, so a single container handles both HTTP and
WebSocket on one origin (the client connects to `wss://<host>` automatically
when the page is served over https).

```bash
docker compose up -d --build     # listens on :2567
```

Put a TLS-terminating reverse proxy in front, e.g. Caddy:

```
tinyempires.icetea.me {
    reverse_proxy localhost:2567
}
```

(Caddy proxies WebSockets out of the box; for nginx set the `Upgrade`/`Connection` headers.)

### CI/CD

`.github/workflows/deploy.yml` builds, smoke-tests, and — on pushes to
master/main — deploys over SSH if these repo secrets are set:

| Secret | Meaning |
| --- | --- |
| `DEPLOY_HOST` | server hostname (e.g. icetea.me) |
| `DEPLOY_USER` | SSH user |
| `DEPLOY_SSH_KEY` | private key for that user |
| `DEPLOY_PATH` | repo checkout path on the server containing `docker-compose.yml` |

Without the secrets the deploy job is skipped, so CI stays green.

## Gotcha worth knowing

`@colyseus/schema` installs accessors on class prototypes; with `target: ES2022`
TypeScript's default `useDefineForClassFields: true` makes instance field
initializers shadow them and **silently breaks all state sync** (0-byte
patches). `server/tsconfig.json` sets it to `false` — don't remove that.
