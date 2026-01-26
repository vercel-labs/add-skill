# AGENTS.md

This file provides guidance to AI coding agents working on the `skills` CLI codebase.

## Project Overview

`skills` is the CLI for the open agent skills ecosystem.

## Commands

| Command | Description |
|---------|-------------|
| `skills` | Show banner with available commands |
| `skills init [name]` | Create a new SKILL.md template |
| `skills add <pkg>` | Install skills from git repos, URLs, or local paths |
| `skills check` | Check for available skill updates |
| `skills update` | Update all skills to latest versions |
| `skills generate-lock` | Match installed skills to sources via API |

Aliases: `skills a`, `skills i`, `skills install` all work for `add`.

## Architecture

```
src/
├── cli.ts           # Main entry point, command routing, init/check/update/generate-lock
├── cli.test.ts      # CLI tests
├── add.ts           # Core add command logic
├── add.test.ts      # Add command tests
├── agents.ts        # Agent definitions and detection
├── installer.ts     # Skill installation logic (symlink/copy)
├── skills.ts        # Skill discovery and parsing
├── skill-lock.ts    # Lock file management
├── source-parser.ts # Parse git URLs, GitHub shorthand, local paths
├── git.ts           # Git clone operations
├── telemetry.ts     # Anonymous usage tracking
├── types.ts         # TypeScript types
├── mintlify.ts      # Mintlify skill fetching (legacy)
├── providers/       # Remote skill providers (GitHub, HuggingFace, Mintlify)
│   ├── index.ts
│   ├── registry.ts
│   ├── types.ts
│   ├── huggingface.ts
│   └── mintlify.ts
├── init.test.ts     # Init command tests
└── test-utils.ts    # Test utilities
```

## Update Checking System

### How `skills check` and `skills update` Work

1. Read `~/.agents/.skill-lock.json` for installed skills
2. For each skill, get `skillFolderHash` from lock file
3. POST to `https://add-skill.vercel.sh/check-updates` with:
   ```json
   {
     "skills": [{ "name": "...", "source": "...", "skillFolderHash": "..." }],
     "forceRefresh": true
   }
   ```
4. API fetches fresh content from GitHub, computes hash, compares
5. Returns list of skills with different hashes (updates available)

### Why `forceRefresh: true`?

Both `check` and `update` always send `forceRefresh: true`. This ensures the API fetches fresh content from GitHub rather than using its Redis cache.

**Without forceRefresh:** Users saw phantom "updates available" due to stale cached hashes. The fix was to always fetch fresh.

**Tradeoff:** Slightly slower (GitHub API call per skill), but always accurate.

### Lock File Compatibility

The lock file format is v3. Key field: `skillFolderHash` (GitHub tree SHA for the skill folder).

If reading an older lock file version, it's wiped. Users must reinstall skills to populate the new format.

## Key Integration Points

| Feature | Implementation |
|---------|---------------|
| `skills add` | `src/add.ts` - full implementation |
| `skills check` | `POST /check-updates` API |
| `skills update` | `POST /check-updates` + reinstall per skill |
| `skills generate-lock` | `POST /api/skills/search` on skills.sh |

## Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Test locally
pnpm dev add vercel-labs/agent-skills --list
pnpm dev check
pnpm dev update
pnpm dev init my-skill

# Run tests
pnpm test

# Type check
pnpm type-check

# Format code
pnpm format
```

## Publishing

```bash
# 1. Bump version in package.json
# 2. Build
pnpm build
# 3. Publish
npm publish
```

## Adding a New Agent

1. Add the agent definition to `src/agents.ts`
2. Run `pnpm run -C scripts validate-agents.ts` to validate
3. Run `pnpm run -C scripts sync-agents.ts` to update README.md
