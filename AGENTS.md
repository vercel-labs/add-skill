# AGENTS.md

This file provides guidance to AI coding agents working on the `add-skill` codebase.

## Project Overview

`add-skill` is a CLI tool that installs agent skills (reusable instruction sets in `SKILL.md` files) onto various coding agents. It supports 23+ agents including OpenCode, Claude Code, Cursor, Codex, and more.

### Usage

```bash
npx skills add <source>          # Install a skill from GitHub, URL, or local path
npx skills add <source> --global # Install globally for the current user
npx skills list                  # List installed skills
npx skills remove <name>         # Remove an installed skill
```

## Architecture

```
src/
├── index.ts          # CLI entry point, main flow orchestration
├── types.ts          # Core TypeScript types (AgentType, Skill, etc.)
├── agents.ts         # Agent configurations (paths, detection logic)
├── skills.ts         # Skill discovery from SKILL.md files
├── installer.ts      # Installation logic (symlink/copy modes)
├── source-parser.ts  # Parse input sources (GitHub, local, URLs)
├── git.ts            # Git clone operations
├── mintlify.ts       # Legacy Mintlify skill fetching
├── telemetry.ts      # Anonymous usage tracking
├── skill-lock.ts     # Lock file for installed skills
└── providers/
    ├── index.ts      # Provider registry exports
    ├── types.ts      # HostProvider interface
    ├── registry.ts   # Provider registration
    ├── mintlify.ts   # Mintlify provider
    └── huggingface.ts # HuggingFace provider
```

## Key Concepts

### Agent Configuration

Each agent is defined in `src/agents.ts` with:

- `name`: CLI identifier (e.g., `claude-code`)
- `displayName`: Human-readable name
- `skillsDir`: Project-level skill directory
- `globalSkillsDir`: User-level skill directory
- `detectInstalled`: Function to check if agent is installed

### Skill Format

Skills are directories containing a `SKILL.md` with YAML frontmatter:

```markdown
---
name: skill-name
description: What this skill does
---

# Instructions...
```

### Installation Modes

1. **Symlink (default)**: Skills are stored in `.agents/skills/<name>/` and symlinked to each agent's directory
2. **Copy**: Skills are copied directly to each agent's directory

### Skill Lock File

The `.skill-lock.json` file (at `~/.agents/.skill-lock.json`) tracks globally installed skills. Managed by `src/skill-lock.ts`.

**Lock File Format (v3):**
```json
{
  "version": 3,
  "skills": {
    "skill-name": {
      "source": "owner/repo",
      "sourceType": "github",
      "sourceUrl": "https://github.com/owner/repo.git",
      "skillPath": "skills/skill-name/SKILL.md",
      "skillFolderHash": "github-tree-sha-for-folder",
      "installedAt": "...",
      "updatedAt": "..."
    }
  }
}
```

**Key fields:**
- `skillFolderHash`: GitHub tree SHA for the skill folder - changes when ANY file in the folder changes
- `skillPath`: Path to SKILL.md within the repo
- `version`: Schema version (current: 3)

**Version History:**
- v1: Initial format (wiped on read)
- v2: Added `contentHash` for SKILL.md-only change detection (wiped on read)
- v3: Uses `skillFolderHash` only - full folder change detection via GitHub Trees API

**How `skillFolderHash` works:**

The CLI fetches the tree SHA directly from GitHub at install time:
```typescript
const url = `https://api.github.com/repos/${ownerRepo}/git/trees/${branch}?recursive=1`;
const data = await fetch(url).then(r => r.json());
const folderEntry = data.tree.find(e => e.type === 'tree' && e.path === skillFolderPath);
const skillFolderHash = folderEntry.sha;
```

- This SHA is content-addressable: it changes when ANY file in the folder changes
- Benefits: 1 API call per repo (not per file), detects changes to reference files, code examples, etc.
- Rate limit: 5,000 requests/hour with `GITHUB_TOKEN`, 60/hour without

**Update checking flow:**
1. Client sends `skillFolderHash` to `/check-updates`
2. Server fetches latest tree SHA from GitHub and compares
3. If different, skill has updates available

**Backwards compatibility:**
- v1 and v2 lock files are wiped on read (users must reinstall skills)
- Non-GitHub sources (Mintlify, HuggingFace) store empty `skillFolderHash` - update checking not supported

### Provider System

For remote skills (Mintlify, HuggingFace), providers implement the `HostProvider` interface:

- `match(url)`: Check if URL belongs to this provider
- `fetchSkill(url)`: Download and parse the skill
- `toRawUrl(url)`: Convert to raw content URL
- `getSourceIdentifier(url)`: Get telemetry identifier

## Common Tasks

### Adding a New Agent

1. Add the agent type to `AgentType` union in `src/types.ts`
2. Add configuration in `src/agents.ts`
3. Run `pnpm tsx scripts/sync-agents.ts` to update README.md

### Adding a New Provider

1. Create provider in `src/providers/<name>.ts` implementing `HostProvider`
2. Register in `src/providers/index.ts`

### Testing

```bash
pnpm test           # Run tests
pnpm typecheck      # Type checking
pnpm lint           # Linting
```

## Code Style

- Use TypeScript strict mode
- Prefer async/await over callbacks
- Use `chalk` for colorized output
- Use `@clack/prompts` for interactive prompts
- Sanitize user input paths to prevent directory traversal

## Important Files

- `src/agents.ts`: Primary file when adding/modifying agent support
- `src/installer.ts`: Core installation logic, path security
- `src/skills.ts`: Skill discovery and parsing
- `README.md`: Auto-updated sections (agent list, discovery paths)

## Security Considerations

- All skill names are sanitized via `sanitizeName()` in `installer.ts`
- Paths are validated with `isPathSafe()` to prevent traversal attacks
- Telemetry is anonymous and respects `DO_NOT_TRACK`/`DISABLE_TELEMETRY`

## Dependencies

Key dependencies:

- `commander`: CLI argument parsing
- `@clack/prompts`: Interactive prompts
- `gray-matter`: YAML frontmatter parsing
- `chalk`: Terminal colors
- `simple-git`: Git operations

## CI/CD

- GitHub Actions runs on push/PR to main
- Validates agent configurations via `scripts/validate-agents.ts`
- Type checking and linting enforced
