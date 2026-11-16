# token-radar-01-entry

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/vlovichot/token-radar-01-entry/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/vlovichot/token-radar-01-entry/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar over a sealed DefiLlama snapshot: it ranks all 614 protocols that record no token by an implied launch value and gives each one a concrete farm plan. The value model uses only the snapshot's own figures — each pre-token protocol is priced at its TVL times its category's median market-cap/TVL multiple (taken from that category's tokenized protocols in the same snapshot), adjusted for 7-day TVL growth and for how long the protocol has been tracked with no token. The dashboard is a static page with a sortable, filterable board and a per-protocol detail view showing the full arithmetic.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

---
<sub>Entered on [make.fun](https://make.fun/?ref=pct4ejqv&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
