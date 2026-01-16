# add-skill

Install agent skills onto your coding agents from any git repository.

Supports [OpenCode](https://opencode.ai), [Claude Code](https://claude.ai/code), [Codex](https://developers.openai.com/codex), [Cursor](https://cursor.com), [Antigravity](https://antigravity.google), and [VS Code Copilot](https://code.visualstudio.com/docs/copilot/customization/agent-skills).

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
| `-a, --agent <agents...>` | Target specific agents: `opencode`, `claude-code`, `codex`, `cursor`, `antigravity`, `vscode-copilot` |
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

## Installation Paths

Skills are installed to different locations depending on the agent and scope:

### Project-level (default)

Installed in your current working directory. Commit these to share with your team.

| Agent | Path |
|-------|------|
| OpenCode | `.opencode/skill/<name>/` |
| Claude Code | `.claude/skills/<name>/` |
| Codex | `.codex/skills/<name>/` |
| Cursor | `.cursor/skills/<name>/` |
| Antigravity | `.agent/skills/<name>/` |
| VS Code Copilot | `.github/skills/<name>/` |

### Global (`--global`)

Installed in your home directory. Available across all projects.

| Agent | Path |
|-------|------|
| OpenCode | `~/.config/opencode/skill/<name>/` |
| Claude Code | `~/.claude/skills/<name>/` |
| Codex | `~/.codex/skills/<name>/` |
| Cursor | `~/.cursor/skills/<name>/` |
| Antigravity | `~/.gemini/antigravity/skills/<name>/` |
| VS Code Copilot | `~/.copilot/skills/<name>/` |

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

- Root directory (if it contains `SKILL.md`)
- `skills/`
- `skills/.curated/`
- `skills/.experimental/`
- `skills/.system/`
- `.codex/skills/`
- `.claude/skills/`
- `.opencode/skill/`
- `.cursor/skills/`
- `.agent/skills/`

If no skills are found in standard locations, a recursive search is performed.

## Compatibility

Skills are generally compatible across agents since they follow a shared [Agent Skills specification](https://agentskills.io). However, some features may be agent-specific:

| Feature | OpenCode | Claude Code | Codex | Cursor | Antigravity | VS Code Copilot |
|---------|----------|-------------|-------|--------|-------------|------------------|
| Basic skills | Yes | Yes | Yes | Yes | Yes | Yes |
| `allowed-tools` | Yes | Yes | Yes | Yes | Yes | Yes |
| `context: fork` | No | Yes | No | No | No | No |
| Hooks | No | Yes | No | No | No | No |

## Troubleshooting

### "No skills found"

Ensure the repository contains valid `SKILL.md` files with both `name` and `description` in the frontmatter.

### Skill not loading in agent

- Verify the skill was installed to the correct path
- Check the agent's documentation for skill loading requirements
- Ensure the `SKILL.md` frontmatter is valid YAML

### Permission errors

Ensure you have write access to the target directory.

## Related Links

- [Vercel Agent Skills Repository](https://github.com/vercel-labs/agent-skills)
- [Agent Skills Specification](https://agentskills.io)
- [OpenCode Skills Documentation](https://opencode.ai/docs/skills)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Codex Skills Documentation](https://developers.openai.com/codex/skills)
- [Cursor Skills Documentation](https://cursor.com/docs/context/skills)
- [Antigravity Skills Documentation](https://antigravity.google/docs/skills)
- [VS Code Copilot Skills Documentation](https://code.visualstudio.com/docs/copilot/customization/agent-skills)

## License

MIT
