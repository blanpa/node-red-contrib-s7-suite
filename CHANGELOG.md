# Changelog

All notable changes to this project will be documented in this file.

## [0.0.10] - 2026-10-10

### Upgrade notes
- **`s7-trigger` rising and falling edge modes no longer send the first value** (#75). The first poll of a boolean only records its starting value, because a starting value is not an edge. `any` still sends the first value
- **`s7-trigger`'s deadband is now inclusive** (#75): a change of exactly the deadband sends a message, as the help and README always said. With a deadband of 5, 10 then 15 used to send only 10
- **Messages no longer override a node's settings** (#26). s7-read and s7-write used to take `msg.topic` as the address, `msg.outputMode` / `msg.mode` as the mode and `msg.schema` as the schema whenever the message had them, even when the node was configured. A topic set for another reason (MQTT, an inject, routing) silently changed which address was read or written. Now the node uses its own settings, and you choose a dynamic source explicitly. The address (s7-read's **Address src**, s7-write's **Address**) is set in the node by default, or taken from `msg`, `flow`, `global` or `env`. The **Schema** is **Fixed** (set in the node) by default, or taken from `msg`, `flow` or `global`. To keep the old behaviour, set the address source to `msg.topic` and the schema source to `msg.schema` (choosing `msg` fills these in). The output and write mode can no longer be set from the message. s7-read also accepts an array of addresses or `{ label: address }` from a dynamic source.

### Added
- **Output messages say what was read or written** (#62): `s7-read`, `s7-write` and `s7-trigger` add `msg.s7` to every message they send, with the same shape on each: `op` (`read`, `write` or `trigger`), `server` (the `s7-config`'s name, or host:port), `source` (`config`, or the property the address came from, such as `flow.plc.address`), `address` when one address was used, `addresses` (each key of `msg.payload` with its address) when the payload is keyed, `timestamp` (ms since 1970) and `durationMs`. A switch node can route on the address, and a log or database insert can record where a value came from, even when the address came from `msg`, `flow`, `global` or `env`. `s7-control` and `s7-browse` set it too (`op` `control` and `browse`), and so does the reply to `msg.action` `status` (`op` `status`). `msg.topic` and `s7-trigger`'s `msg.oldValue` are unchanged
- **Environment variables for `s7-trigger`'s Interval and Deadband** (#29): each takes a number or the name of an environment variable, as `s7-config`'s fields do. An unset or unusable variable stops the trigger with an error instead of falling back to a default. The editor now flags an interval that isn't a whole number of 1 ms or more, or a negative deadband; typed-in values behave at runtime as before
- **New address rows and schema fields start from the row above** (#39): in `s7-read`, **Add address** suggests the next address of the same type and notation (`DB1,REAL0` then `DB1,REAL4`, `MW10` then `MW12`, `I0.7` then `I1.0`), moving past a whole array or string, and counts on a label that ends in a number. The suggestion is selected, so typing replaces it. In the struct schema lists of `s7-read` and `s7-write`, **Add field** fills in the previous field's type, and its length for a string, at the next free offset, or the next bit for a `BOOL`, leaving only the name to type
- **Control the connection from a flow** (#38): two new `s7-config` settings. **Auto connect** (on by default, today's behaviour) can be turned off so the connection stays down until a flow asks for it. **Dynamic control** (off by default) lets `s7-read`, `s7-write`, `s7-control` and `s7-browse` accept `msg.action`: `connect`, `disconnect`, `reconnect`, or `status`, which sends the connection state, the last error and the connection settings as `msg.payload`. A message with an action does no PLC I/O. The same pattern as Node-RED's MQTT nodes and cip-suite's `cip-endpoint`

### Fixed
- **`s7-trigger` rising and falling edge modes stopped after the first edge** (#75): a transition the mode ignores (true to false in rising mode) wasn't recorded, so the node never saw the next edge. A bit toggling every second triggered once and then never again. Every edge now triggers, and `msg.oldValue` is the value at the previous poll
- **`s7-config`: the LINT/ULINT dropdown was blank** on a config saved before the setting existed. It now shows **Number**, which is what the runtime used for it (#69)
- **`s7-control` help** says that S7-1200 and S7-1500 CPUs usually refuse stop and start over PUT/GET, and what the PLC answers (#69)
- **Node-RED could crash when an `s7-trigger` was stopped** (on a redeploy, for example) while one of its polls was still waiting for the PLC. The poll then failed with "Connection lost" and reported it to a node that had already gone, which took the whole runtime down. Values from a poll that finishes after the trigger has stopped are now dropped, and its error is only reported if the node is still listening (#69)
- **nodes7 backend: Node-RED could crash after a stalled network link.** When a request timed out and the connection was rebuilt, nodes7 could still answer the old request later, and handling that answer threw. A late answer is now handled safely: if the PLC did answer, the read or write counts as done (so a write isn't repeated by a retry), and if it failed it is reported as a failed read or write, not as a lost connection, so the connection that replaced it isn't dropped. On either backend, a request that fails late on a connection that has since been replaced (by `msg.action` `reconnect`, say) no longer takes down the new connection; on snap7 it used to, about 3 s after the reconnect, and could leave it refusing every request with "Not connected" (#69)
- **`s7-trigger` documented inputs it can't receive**: the README listed `msg.interval`, `msg.edgeMode` and `msg.deadband` as inputs, but the node has no input port. They are removed from the docs, along with the unreachable input handler (#29)
- **Address browser in `s7-read` / `s7-write`**: the address list now makes room for the browser instead of the browser being pushed off the bottom of the panel, the browser closes when the list or field it fills is hidden, and in `s7-write` it opens under the address field, which Struct write now shares, so its base address can be browsed too (#26)
- **`s7-read` reports addresses that couldn't be read**: when some addresses in a read fail, the rest are sent, the failed ones as `null`, and the node logs a warning naming them and the reason. When none can be read, the node reports an error instead of sending `null` (on snap7 a read where every address failed used to be sent silently). Thanks [@Steve-Mcl](https://github.com/Steve-Mcl) (#59, #55)
- **`s7-write` single mode accepts an array or a Buffer** for an address with a length (`DB1,INT20.3`, `DB1,BYTE10.4`); it used to refuse them, so array writes only worked in multi mode. An array sent to an address without a length is refused with a clear message. Thanks [@Steve-Mcl](https://github.com/Steve-Mcl) (#56, #54)

## [0.0.9] - 2026-10-04

A large release, almost all of it contributed by [@Steve-Mcl](https://github.com/Steve-Mcl):
12 pull requests covering the editor, both backends, new data types and connection handling.
Thanks also to [@BurgerMirco](https://github.com/BurgerMirco) for reporting #19.

### Upgrade notes
- **A single number after the offset is now the array length**, as in nodes7: `DB1,BYTE10.4` is 4 bytes and `QB0.4` is 4 bytes. Both used to read one value, with the number silently dropped. `DB1,BYTE10.0.4` still means the same. A bit offset on a type without bits (`DB1,REAL0.3.2`) and a bit offset above 7 (`M10.12`) are now errors (#50)
- **The number after a STRING or WSTRING offset is its max length**: `DB1,STRING50.20` is a `STRING[20]` at offset 50. It used to be read as an array length or a bit offset (#44)
- **String writes are stricter**: a value longer than the string's max length is rejected (snap7 used to write past the end, nodes7 truncated), and so is a write to a string with an empty header when the address gives no length (#44)
- **nodes7 backend: unsupported types are refused with an error** instead of returning `null` or writing nothing: USINT, UINT, UDINT, LINT, ULINT, DATE, TIME, TIME_OF_DAY, DATE_AND_TIME, S5TIME, WSTRING reads, counters and timers. Use the snap7 backend for these (#45)
- **Timeouts and reconnect intervals must be whole numbers of 1 ms or more**, and a TSAP that isn't valid hex is a config error instead of a silently wrong value (#41)
- **snap7: a lost connection fails the whole read** so the node reconnects, instead of returning every item as `bad` (#34)

### Added
- **Date and time types `DT`, `DTZ`, `DTL` and `DTLZ`** on every backend. `DT`/`DTZ` are a PLC `DATE_AND_TIME`, `DTL`/`DTLZ` a `DTL`; the `Z` forms are read and written as UTC, the others as the server's local time. They return a `Date`; writes accept a `Date`, an ISO string or milliseconds since 1970 (#46, part of #24)
- **Exact `LINT`/`ULINT`**: new *LINT/ULINT as* setting on `s7-config` returns 64-bit integers as Number (default, exact up to 2^53), BigInt or String. Writes accept a number, a BigInt or an integer string, and out-of-range values are rejected (#46)
- **Environment variables for connection settings**: host, port, rack, slot, TSAPs, timeouts and reconnect intervals on `s7-config` each take a value or the name of an environment variable, so one flow can run against different PLCs. An unset or unusable variable is reported as a config error, never replaced by a default (#41, #28)
- **TSAPs accept the dotted form** LOGO! Soft Comfort and TIA Portal show (`01.00`) as well as `0x0100` and `0100` (#41)
- **Lost connections are noticed while idle**: the connection is checked every 2 s when connected, so the node status follows the PLC without waiting for the next request (#34, #21)
- **TIA Portal `.xml` and `.sdf` tag table exports** can be imported in `s7-read`, in addition to `.xlsx`. The file picker also offers `.xlsm`, `.xlsb` and `.ods` (#37, #25)
- **`DB1,X0.0`**, nodes7's own bit syntax, is accepted as an address (#32)
- **All 25 data types in the struct schema editors** of `s7-read` and `s7-write` (they listed 10), and `s7-write` struct mode accepts the same types as `s7-read` (#46)
- **Array writes** on every backend: an address with a length takes an array of that many values, and a byte array also takes a Buffer (#47)

### Fixed
- **`s7-read` / `s7-write`: edits were lost on Done**: the address list, labels, single address and struct schema reverted to their old values when the dialog closed (#31, #19)
- **nodes7: DB bits returned `null` and bit writes timed out**: DB bits are now sent to nodes7 as `X` (#32, #20)
- **Error messages said `undefined`**: backend errors now give the cause, e.g. `snap7 read failed: CPU : Address out of range (8 bytes at DB1 offset 200)` or the addresses nodes7 marked bad (#33, #22)
- **Node status stayed "connected" after the PLC went away**: both backends now report a lost link as a disconnect, and reconnects no longer leak the previous connection (#34, #21)
- **snap7 ignored the configured port** and always connected to 102 (#35, #23)
- **snap7: writing a STRING overwrote 256 bytes of the DB**: all backends now write only the string's current length and characters, sized from the header in the PLC (#44, #42)
- **nodes7: writing a type it doesn't know resent the previous write and reported success** (#45, #43)
- **Writing several values to one address** (`DB1,BYTE10.0.4`, `DB1,INT20.3`) wrote a single zero on the snap7 and sim backends. A value whose length doesn't match the address is rejected on every backend instead of being written short (#47)
- **Bit arrays** (`DB1,X10.3.8`, `M10.3.8`) are 8 consecutive bits from bit 3 of byte 10 on every backend, read and write. snap7 and the sim used to read one bit per byte and write a single bit, and the count was dropped for `M`/`I`/`Q` bits on nodes7 (#51)
- **s7-trigger fired on every poll** for an array address or a `Date` value: arrays, Buffers and dates are now compared by content (#48, #46)
- **nodes7: one bad address no longer fails the whole read**. The good values are returned and the bad items are marked `bad` with a reason, as on snap7. A read with no good value at all still fails (#49)
- **`DATE_AND_TIME` writes had the wrong weekday** (S7 counts Sunday as 1), and an invalid date was written as zeros instead of being rejected (#46)
- **WSTRING fields in `s7-write` struct mode always failed** with "Buffer too small" (#46)
- **Editor layout**: the address and schema lists use the full width and the available height and open at the top; labels in `s7-config` no longer wrap; the connection status dot no longer overlaps the add button (#40, #41, #27)
- **A new `s7-config` started with an empty rack** and failed validation; it now starts with rack 0 (#41)
- **`npm run lint` and `npm run format` did nothing on Windows** (#36, #30)

### Changed
- README: address syntax and data type reference, and the list of supported tag-import formats (#37, #25)

## [0.0.8] - 2026-08-26

### Changed

- **License changed from MIT to Apache-2.0.** Apache-2.0 is the license
  Node-RED itself uses. Compared to MIT it adds an explicit patent grant
  (section 3), keeps attribution intact downstream through the new `NOTICE`
  file (section 4d), and requires modified files to be marked as changed
  (section 4b). It remains fully permissive: commercial use, closed-source
  derivatives and forks are all still allowed.
- **`NOTICE` added** and verified to ship inside the npm tarball.
- **Contributing and fork guidance in the README.** Pull requests are welcome,
  including large ones — an issue up front means substantial work can usually
  land here instead of in a parallel package. Forks that are published under
  their own package name are asked to rename their Node-RED node type IDs and
  use their own palette category, so both packages can be installed side by
  side.

## [0.0.6] - 2026-06-22

### Fixed
- **Node icons not displayed**: the build copied `s7-suite.svg` to `dist/icons/icons/` (a double-nested path produced by `copyfiles -u 1`), where Node-RED never looks. For npm-installed modules Node-RED resolves icons from `<dir-of-node-js>/icons/`, so every node fell back to the default icon. A new `copy-icons` build step now places `s7-suite.svg` into each `dist/nodes/<node>/icons/` directory; verified end-to-end (all six icons served with HTTP 200)

### Changed
- **Palette category renamed `S7` → `S7 Suite`**: the five flow nodes (read/write/trigger/browse/control) now group under an `S7 Suite` section in the Node-RED palette

## [0.0.5] - 2026-06-13

### Added
- **npm Trusted Publishing pipeline** (`.github/workflows/npm-publish.yml`): the package is now published to npm via GitHub Actions using OIDC Trusted Publishing — no `NPM_TOKEN` secret required. The workflow runs on a published GitHub Release (or manual dispatch), lints, builds and tests, then runs `npm publish` with automatically generated build provenance (the npm ✓ "Built and signed on GitHub Actions" badge). Requires the Trusted Publisher to be configured once on npmjs.com (org `blanpa`, repo `node-red-contrib-s7-suite`, workflow `npm-publish.yml`)
- **Sim-server dev environment** (`sim-server/`, `docker-compose.sim.yml`, `examples/sim-deployment.json`): a fully offline, multi-PLC simulation stack for development and CI — six S7-server simulators (S7-1200/1500/300/400 etc.) plus a Node-RED instance with the S7 nodes and a preloaded demo flow. One command (`docker compose -f docker-compose.sim.yml up --build`) brings up the whole environment; each simulator is reachable on the host at ports `1102..1107` for direct snap7 testing and via service name inside the Docker network. Dev-only — none of these files ship in the npm tarball

### Fixed
- **s7-config validation after redeploy** (#12): the Node-RED editor delivers numeric fields (rack, slot, port, timeouts) as strings after editing a config node, which made validation fail with `Invalid S7 config: invalid rack: 0 (expected 0-7)` and blocked the connection. All numeric config fields are now coerced before validation
- **s7-trigger no longer crashes on an invalid address**: a malformed address now sets a red `invalid address` node status instead of throwing during node construction; interval and deadband are coerced from editor strings as well
- **ConnectionManager request-timeout timer leak**: the per-request timeout timer is now cleared once a request settles instead of lingering for the full timeout duration
- **ConnectionManager reconnect race**: calling `disconnect()` while a reconnect attempt was pending or in flight could re-establish (and leak) a PLC connection afterwards; reconnects now stop cleanly after a manual disconnect

### Security
- All `/s7-suite/*` admin endpoints now require editor permissions via `RED.auth.needsPermission` (`s7.read` for status/browse, `s7.write` for cfg/TIA-XML imports) when Node-RED authentication is enabled
- **Dependency audit**: bumped the `node-red` devDependency from `^3.1.0` to `^4.1.11`, clearing 22 of the 25 reported advisories (all dev-only — the runtime dependencies `nodes7`/`node-snap7` had 0 vulnerabilities and the published tarball never bundled these packages). The remaining 3 advisories live inside the `npm` CLI that `@node-red/registry` bundles and cannot be overridden; they are dev-only and not exercised by the build or tests

### Changed
- `package.json` `main` now resolves to a real module (`dist/nodes/index.js` re-exporting the shared types) instead of a non-existent file

## [0.0.4] - 2026-04-22

### Added
- **Offline CFG import**: New `cfg-parser` and `tia-xml-parser` modules parse STEP 7 `.cfg` files (and embedded TIA Portal XML) for fully offline tag discovery — no live PLC connection required
- **s7-browse offline source**: Browse dialog now offers a `cfg` source next to `live`, with dynamic UI updates and label rendering for cached configurations
- **s7-config CFG upload endpoint**: New HTTP endpoint accepts `.cfg` uploads, with structured error handling and response payload
- **s7-read CFG-driven tag picker**: Select tags from an imported CFG without typing addresses manually
- **Repository metadata**: Added `repository`, `bugs` and `homepage` to `package.json` so npm shows the GitHub link, issue tracker and README
- **`test-assets/` folder**: Repository folder for external S7 test files (tag lists, flows, PLC sources, captures, datasheets); excluded from npm tarball and Docker image
- **Sample CFG**: `test-assets/prod.cfg` (4 436 lines) — real production STEP 7 configuration to exercise the offline CFG-import path

### Changed
- **`.dockerignore`**: Added `test-assets/` and `misc/` so heavy assets stay out of the Docker build context

### Tested
- New unit tests for `cfg-parser`, `tia-xml-parser`, and the CFG-import code paths in `s7-browse` and `s7-config`
- All 401+ existing tests still pass

## [0.0.3] - 2026-04-17

### Added
- **Excel/XLSX bulk import**: s7-read node now supports importing tag lists from `.xlsx`/`.xls`/`.xlsm`/`.xlsb`/`.ods` files (lazy-loaded SheetJS from CDN, no runtime npm dependency)
- **Import feedback**: User-visible notifications via `RED.notify` for import success, warnings (no tags found) and errors
- **Docker deployment**: New `Dockerfile`, `docker-compose.yml` and `.dockerignore` for one-command Node-RED setup with the S7 nodes pre-installed
- **MIT LICENSE file**: Added (the package was already declared MIT in `package.json`)
- **README**: Comprehensive rewrite with comparison table against existing S7 Node-RED packages, Why-section, troubleshooting, contribution guide, and bulk-import highlight

### Changed
- **Address list height**: Edit dialog address list grew from 80 px to 300 px minimum (~6× larger) and now follows the dialog size via `oneditresize`
- **Schema list height**: Struct schema list also grew from 80 px to 250 px minimum and resizes with the dialog
- **Import button label**: Renamed from "Import CSV" to "Import CSV/Excel"

### Fixed
- **`.gitignore`**: Extended with sensible defaults (`.env`, IDE files, OS files, Docker overrides, logs, `misc/` for vendor docs)

### Tested
- End-to-end Docker test: container build, all 6 nodes loaded, sim-backend single read, object read with labels, write + readback through HTTP endpoints
- Browser-verified UI: address list height confirmed at ~535 px (was ~80 px before)

## [0.0.2] - 2026-03-12

### Added
- **Multi-Write**: s7-write accepts object payload `{MB0: 255, MW2: 1234}` for batch writes
- **Struct-Write**: s7-write struct mode with schema (counterpart to s7-read struct mode)
- **CPU-Control node**: New s7-control node for Start/Stop/Cold Start (snap7 only)
- **S7 time types**: DATE, TIME, TIME_OF_DAY, DATE_AND_TIME, S5TIME
- **S7-1500 unsigned types**: USINT, UINT, UDINT, LINT, ULINT
- **WSTRING**: Unicode string support for S7-1500
- **Counter/Timer**: C and T area support in browse and address parser
- **Password protection**: Credentials-based session password for protected CPUs (snap7)
- **Browse live-refresh**: Refresh button in all browse dialogs
- **TSAP for all PLC types**: Local/Remote TSAP fields visible for all PLC types, not just LOGO

### Changed
- **Request-Timeout**: Queue enforces requestTimeout with automatic reconnect on timeout
- **Connection-Status**: s7-config warns child nodes on disconnect/error, logs on reconnect
- **Address parser**: Area addresses support array notation (e.g. MB0.10 for 10 bytes)
- **Counter/Timer default**: C/T addresses default to WORD (16-bit) instead of BYTE

### Tested
- Verified with real S7-300 CPU 314 via ACCON-NetLink-PRO compact adapter
- 314 unit tests passing

## [0.0.1] - 2026-03-08

### Added
- Initial release with 5 Node-RED nodes: s7-config, s7-read, s7-write, s7-trigger, s7-browse
- Dual backend support: nodes7 (pure JS) + node-snap7 (native, optional)
- Built-in simulator backend for development
- Multiple address formats: nodes7-style, IEC-style, area-style
- PLC block browsing with category filtering
- Connection manager with auto-reconnect and exponential backoff
- Request queue with rate limiting
- Edge detection (rising/falling/any) and deadband filtering
- s7-read output modes: single, object, buffer, struct, bits
- Docker Compose setup for quick testing
- 299 unit tests with 80%+ coverage

### Infrastructure
- GitHub Actions CI with Node.js 18, 20, 22 matrix
- ESLint + Prettier code formatting
- Jest test framework with coverage thresholds
