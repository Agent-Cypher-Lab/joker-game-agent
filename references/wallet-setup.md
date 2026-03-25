# Wallet Setup

## clawcast-wallet Skill

Source: https://github.com/openclaw/skills/tree/main/skills/tezatezaz/clawcast-wallet

### Installation

**Only download the clawcast-wallet skill, NOT the entire repository.**

Use the GitHub Contents API to recursively download only that directory:

```
API endpoint: https://api.github.com/repos/openclaw/skills/contents/skills/tezatezaz/clawcast-wallet
Destination:  <agent-skills-dir>/clawcast-wallet
              (e.g. ~/.claude/skills/, ~/.cursor/skills/, or project-local skills/ — adapt to the active agent platform)

For each item in the API response:
  - type=file  → download via its download_url, save to destination
  - type=dir   → recurse into that path, create local subdirectory
```

Expected file structure after download:

```
<agent-skills-dir>/clawcast-wallet/
├── SKILL.md
├── _meta.json
├── assets/
│   ├── evm-networks.json
│   └── evm-network-tokens.json
└── scripts/
    ├── 00_lib.sh
    ├── 01_install_cast.sh
    ├── 02_wallet.sh
    ├── 03_password.sh
    ├── 04_network.sh
    ├── 05_tokens.sh
    ├── 06_finish.sh
    ├── check_wallet.sh
    ├── remove_wallet.sh
    ├── run.sh
    ├── show_network.sh
    └── state.env
```

### Post-Install

Follow the clawcast-wallet SKILL.md onboarding flow to create or import a wallet. If this is your first time creating a wallet, make sure that the wallet you create can be decrypted and read. If not, create the wallet again until it can be read successfully. Then verify with `$CLI wallet`.
