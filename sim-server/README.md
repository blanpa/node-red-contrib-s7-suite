# S7 Sim Deployment

Docker-based simulation stack for testing `node-red-contrib-s7-suite` against six
PLC variants without real hardware. Each container runs a `node-snap7` S7Server
seeded with the same DB1 layout and a few live signals.

## Quick start

```bash
# from repo root
docker compose -f docker-compose.sim.yml up --build
```

Open Node-RED: **http://localhost:1885**

The flow `examples/sim-deployment.json` is preloaded on first start. Each PLC
variant has its own row (Read / Write / Browse / Trigger). Click the inject
nodes — the debug sidebar shows the responses.

## What's in the stack

| Service        | PLC type | Rack / Slot | Backend used by Node-RED | Internal host         | Host port |
| -------------- | -------- | ----------- | ------------------------ | --------------------- | --------- |
| `s7-1200-sim`  | S7-1200  | 0 / 1       | snap7                    | `s7-1200-sim:102`     | 1102      |
| `s7-1500-sim`  | S7-1500  | 0 / 1       | snap7                    | `s7-1500-sim:102`     | 1103      |
| `s7-300-sim`   | S7-300   | 0 / 2       | snap7                    | `s7-300-sim:102`      | 1104      |
| `s7-400-sim`   | S7-400   | 0 / 3       | snap7                    | `s7-400-sim:102`      | 1105      |
| `s7-200-sim`   | S7-200   | 0 / 1 + TSAP `1000/1000` | nodes7      | `s7-200-sim:102`      | 1106      |
| `s7-logo-sim`  | LOGO     | 0 / 2 + TSAP `0100/0200` | nodes7      | `s7-logo-sim:102`     | 1107      |

> The snap7 server accepts any rack/slot — the differentiator between containers
> is the `PLC_TYPE` label and the rack/slot the **client** sends. That's exactly
> the path through `s7-config` validation we want to exercise.
>
> For S7-200 and LOGO, the flow uses TSAP-based addressing on the `nodes7`
> backend, which mirrors how the real devices are wired.

## Seeded DB1 layout (every simulator)

| Address          | Value         | Behaviour                        |
| ---------------- | ------------- | -------------------------------- |
| `DB1,REAL0`      | 23.5          | drifts ±5 around mean per tick   |
| `DB1,INT4`       | 42            | increments by 1 per tick (wraps) |
| `DB1,BOOL6.0`    | true          | toggles every 5 ticks            |
| `DB1,DINT8`      | 123456        | static                           |
| `DB1,STRING12`   | "S7-SIM"      | static (S7 STRING, max 254)      |

`MB0 = 0xA5` and `IB0 = 0x0F` are also seeded so reads from M and I areas work.

The tick interval defaults to **1 s** per container; override with `TICK_MS`.

## Customising a simulator

All knobs are env vars on the sim-server container — set them in
`docker-compose.sim.yml`:

| Env var      | Default        | Meaning                                                 |
| ------------ | -------------- | ------------------------------------------------------- |
| `PLC_TYPE`   | `S7-1200`      | Label shown in logs (no behavioural effect)             |
| `BIND_ADDR`  | `0.0.0.0`      | Address the server binds to                             |
| `BIND_PORT`  | `102`          | ISO-on-TCP port (do not change unless you remap)        |
| `DB_LIST`    | `1:1024`       | Comma list of `dbNumber:sizeBytes` to register          |
| `TICK_MS`    | `1000`         | Live-signal mutation period                             |

Example — add DB42 (8 KB) to the S7-1500 sim:

```yaml
environment:
  - PLC_TYPE=S7-1500
  - DB_LIST=1:1024,10:2048,42:8192
```

## Talking to a sim from outside Docker

The host ports `1102..1107` map to each container's port 102. You can hit a sim
directly from snap7-py, S7-PLCSIM-compatible clients, or another Node-RED
instance:

```python
import snap7
c = snap7.client.Client()
c.connect('127.0.0.1', 0, 1, tcpport=1102)   # S7-1200 sim
print(c.db_read(1, 0, 4))                    # DB1,REAL0
```

## Troubleshooting

- **`Failed to start server: code N` in container logs** — usually a port
  conflict. Check that no other process holds 102 inside the container
  (`docker compose -f docker-compose.sim.yml logs s7-1200-sim`).
- **Node-RED can't reach the sim** — verify both containers are on the `s7sim`
  network: `docker network inspect node-red-contrib-s7-suite_s7sim`.
- **`Invalid S7 config: invalid rack: 0`** — make sure you're on a build that
  includes the numeric-coercion fix in `s7-config.ts` (rack/slot/port can come
  from the editor as strings; the fix coerces them).
- **`node-snap7` build fails** — the Dockerfile installs `build-essential` and
  `python3`; if you're rebuilding locally outside Docker, you need both plus a
  recent Node 18+.

## Resetting

```bash
docker compose -f docker-compose.sim.yml down -v   # also drops node-red-sim-data
```

The `-v` flag wipes the Node-RED data volume, so the next `up` reseeds
`flows.json` from `examples/sim-deployment.json`.
