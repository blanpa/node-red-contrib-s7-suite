# Test Assets

This folder is for **external files used to test or reproduce S7 scenarios** with `node-red-contrib-s7-suite`.

These files are checked into the Git repository so that contributors can reproduce bug reports and integration tests, but they are **not shipped** with the npm package or Docker image.

## Layout

| Folder | What goes here | Examples |
|---|---|---|
| `tag-lists/` | Tag exports for the bulk-import feature of `s7-read` | `.csv`, `.tsv`, `.xlsx`, `.xls` (TIA Portal exports, Step 7 symbol tables) |
| `flows/` | Reproducible Node-RED flows for testing specific scenarios | `.json` flow files |
| `plc-programs/` | PLC source code that produced the test data | `.awl`, `.scl`, `.zap*` (Step 7), `.ap*` (TIA Portal projects), `.lad` |
| `docs/` | Reference material, datasheets, manuals, vendor docs | `.pdf`, `.md`, screenshots `.png`/`.jpg` |
| `captures/` | Network/protocol traces captured against real hardware | `.pcap`, `.pcapng` (Wireshark with S7Comm dissector) |

## Adding files

1. Drop the file into the matching subfolder.
2. If it's a non-trivial asset, add a one-line note to the subfolder README (or create one) describing **what PLC/firmware** it was captured against and **what bug or feature** it is meant to verify.
3. Commit. Be careful with binary files - keep the repo small. Anything bigger than a few MB belongs in a release attachment, GitHub issue or external storage instead.

## What does *not* go here

- **Real customer data** - sanitise tag names, IPs and process values before committing.
- **Credentials** - never commit passwords, certificates, license keys.
- **Generated build artefacts** - those go to `dist/`.
- **Personal scratch files** - use the gitignored `misc/` folder for that.

## Why a separate folder?

`examples/` contains the official, supported example flows that ship as documentation. `test-assets/` is the open-ended dump for reproducing bug reports, A/B-testing PLC behaviour, or attaching sample tag lists to GitHub issues without forcing users to download them from external links.
