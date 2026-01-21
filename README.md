# add-skill

Install agent skills onto your coding agents from any git repository.

<!-- agent-list:start -->
Supports **Opencode**, **Claude Code**, **Codex**, **Cursor**, and [13 more](#available-agents).
<!-- agent-list:end -->

## Quick Start

```bash
npx add-skill vercel-labs/agent-skills
```

## What are Agent Skills?

Agent skills are reusable instruction sets that extend your coding agent's capabilities. They're defined in `SKILL.md` files with YAML frontmatter containing a `name` and `description`.

Skills let agents perform specialized tasks like:
- Generating release notes from git history
- Creating PRs following your team's conventions
- Integrating with external tools (Linear, Notion, etc.)

## Usage

### Source Formats

The `<source>` argument accepts multiple formats:

```bash
# GitHub shorthand
npx add-skill vercel-labs/agent-skills

# Full GitHub URL
npx add-skill https://github.com/vercel-labs/agent-skills

# Direct path to a skill in a repo
npx add-skill https://github.com/vercel-labs/agent-skills/tree/main/skills/frontend-design

# GitLab URL
npx add-skill https://gitlab.com/org/repo

# Any git URL
npx add-skill git@github.com:vercel-labs/agent-skills.git
```

### Options

| Option | Description |
|--------|-------------|
| `-g, --global` | Install to user directory instead of project |
| `-a, --agent <agents...>` | <!-- agent-names:start -->Target specific agents (e.g., `claude-code`, `codex`). See [Available Agents](#available-agents)<!-- agent-names:end --> |
| `-s, --skill <skills...>` | Install specific skills by name |
| `-l, --list` | List available skills without installing |
| `-y, --yes` | Skip all confirmation prompts |
| `-V, --version` | Show version number |
| `-h, --help` | Show help |

### Examples

```bash
# List skills in a repository
npx add-skill vercel-labs/agent-skills --list

# Install multiple specific skills
npx add-skill vercel-labs/agent-skills --skill frontend-design --skill skill-creator

# Install to specific agents
npx add-skill vercel-labs/agent-skills -a claude-code -a opencode

# Non-interactive installation (CI/CD friendly)
npx add-skill vercel-labs/agent-skills --skill frontend-design -g -a claude-code -y

# Install all skills from a repo
npx add-skill vercel-labs/agent-skills -y -g
```

## Available Agents

Skills can be installed to any of these supported agents. Use `-g, --global` to install to the global path instead of project-level.

<!-- available-agents:start -->
| Agent | `--agent` | Project Path | Global Path |
|-------|-----------|--------------|-------------|
| Amp | `amp` | `.agents/skills/` | `~/.config/agents/skills/` |
| Antigravity | `antigravity` | `.agent/skills/` | `~/.gemini/antigravity/skills/` |
| Claude Code | `claude-code` | `.claude/skills/` | `~/.claude/skills/` |
| Clawdbot | `clawdbot` | `skills/` | `~/.clawdbot/skills/` |
| Codex | `codex` | `.codex/skills/` | `~/.codex/skills/` |
| Cursor | `cursor` | `.cursor/skills/` | `~/.cursor/skills/` |
| Droid | `droid` | `.factory/skills/` | `~/.factory/skills/` |
| Gemini CLI | `gemini-cli` | `.gemini/skills/` | `~/.gemini/skills/` |
| GitHub Copilot | `github-copilot` | `.github/skills/` | `~/.copilot/skills/` |
| Goose | `goose` | `.goose/skills/` | `~/.config/goose/skills/` |
| Kilo Code | `kilo` | `.kilocode/skills/` | `~/.kilocode/skills/` |
| Kiro CLI | `kiro-cli` | `.kiro/skills/` | `~/.kiro/skills/` |
| OpenCode | `opencode` | `.opencode/skills/` | `~/.config/opencode/skills/` |
| Roo Code | `roo` | `.roo/skills/` | `~/.roo/skills/` |
| Trae | `trae` | `.trae/skills/` | `~/.trae/skills/` |
| Windsurf | `windsurf` | `.windsurf/skills/` | `~/.codeium/windsurf/skills/` |
| Neovate | `neovate` | `.neovate/skills/` | `~/.neovate/skills/` |
<!-- available-agents:end -->

> [!NOTE]
> **Kiro CLI users:** After installing skills, you need to manually add them to your custom agent's `resources` in `.kiro/agents/<agent>.json`:
> ```json
> {
>   "resources": [
>     "skill://.kiro/skills/**/SKILL.md"
>   ]
> }
> ```

## Agent Detection

The CLI automatically detects which coding agents you have installed by checking for their configuration directories. If none are detected, you'll be prompted to select which agents to install to.

## Creating Skills

Skills are directories containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: my-skill
description: What this skill does and when to use it
---

# My Skill

Instructions for the agent to follow when this skill is activated.

## When to Use

Describe the scenarios where this skill should be used.

## Steps

1. First, do this
2. Then, do that
```

### Required Fields

- `name`: Unique identifier (lowercase, hyphens allowed)
- `description`: Brief explanation of what the skill does

### Skill Discovery

The CLI searches for skills in these locations within a repository:

<!-- skill-discovery:start -->
- Root directory (if it contains `SKILL.md`)
- `skills/`
- `skills/.curated/`
- `skills/.experimental/`
- `skills/.system/`
- `.agents/skills/`
- `.agent/skills/`
- `.claude/skills/`
- `./skills/`
- `.codex/skills/`
- `.cursor/skills/`
- `.factory/skills/`
- `.gemini/skills/`
- `.github/skills/`
- `.goose/skills/`
- `.kilocode/skills/`
- `.kiro/skills/`
- `.opencode/skills/`
- `.roo/skills/`
- `.trae/skills/`
- `.windsurf/skills/`
- `.neovate/skills/`
<!-- skill-discovery:end -->

If no skills are found in standard locations, a recursive search is performed.

## Compatibility

Skills are generally compatible across agents since they follow a shared [Agent Skills specification](https://agentskills.io). However, some features may be agent-specific:

| Feature | OpenCode | Claude Code | Codex | Kiro CLI | Cursor | Antigravity | Roo Code | Github Copilot | Amp | Clawdbot | Neovate |
|---------|----------|-------------|-------|----------|--------|-------------|----------|----------------|-----|----------|---------|
| Basic skills | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `allowed-tools` | Yes | Yes | Yes | No | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| `context: fork` | No | Yes | No | No | No | No | No | No | No | No | No |
| Hooks | No | Yes | No | No | No | No | No | No | No | No | No |

## Troubleshooting

### "No skills found"

Ensure the repository contains valid `SKILL.md` files with both `name` and `description` in the frontmatter.

### Skill not loading in agent

- Verify the skill was installed to the correct path
- Check the agent's documentation for skill loading requirements
- Ensure the `SKILL.md` frontmatter is valid YAML

### Permission errors

Ensure you have write access to the target directory.

## Telemetry

This CLI collects anonymous usage data to help improve the tool. No personal information is collected.

To disable telemetry, set either of these environment variables:

```bash
DISABLE_TELEMETRY=1 npx add-skill vercel-labs/agent-skills
# or
DO_NOT_TRACK=1 npx add-skill vercel-labs/agent-skills
```

Telemetry is also automatically disabled in CI environments.

## Related Links

- [Agent Skills Specification](https://agentskills.io)
- [Amp Skills Documentation](https://ampcode.com/manual#agent-skills)
- [Antigravity Skills Documentation](https://antigravity.google/docs/skills)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Clawdbot Skills Documentation](https://docs.clawd.bot/tools/skills)
- [Codex Skills Documentation](https://developers.openai.com/codex/skills)
- [Cursor Skills Documentation](https://cursor.com/docs/context/skills)
- [Gemini CLI Skills Documentation](https://geminicli.com/docs/cli/skills/)
- [GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [Kiro CLI Skills Documentation](https://kiro.dev/docs/cli/custom-agents/configuration-reference/#skill-resources)
- [OpenCode Skills Documentation](https://opencode.ai/docs/skills)
- [Roo Code Skills Documentation](https://docs.roocode.com/features/skills)
- [Trae Skills Documentation](https://docs.trae.ai/ide/skills)
- [Vercel Agent Skills Repository](https://github.com/vercel-labs/agent-skills)

## License

MIT
