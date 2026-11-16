# fomo-desk

Static web app for a private PAPER trading desk. Every data file under `d/` (branch `data`) is
AES-256-GCM encrypted; the key never touches this repo (it travels only in the URL fragment).
