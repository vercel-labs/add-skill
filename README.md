# add-skill

Install agent skills onto your coding agents from any git repository.

Supports [OpenCode](https://opencode.ai), [Claude Code](https://claude.ai/code), [Codex](https://developers.openai.com/codex), and [Cursor](https://cursor.com).

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
| `-a, --agent <agents...>` | Target specific agents: `opencode`, `claude-code`, `codex`, `cursor` |
| `-s, --skill <skills...>` | Install specific skills by name |
| `-l, --list` | List available skills without installing |
| `-y, --yes` | Skip all confirmation prompts |
| `--global-dir-opencode <path>` | Custom global directory for OpenCode skills |
| `--global-dir-claude-code <path>` | Custom global directory for Claude Code skills |
| `--global-dir-codex <path>` | Custom global directory for Codex skills |
| `--global-dir-cursor <path>` | Custom global directory for Cursor skills |
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

# Install to custom global directories
npx add-skill vercel-labs/agent-skills -g --global-dir-claude-code /mnt/data/claude-skills

# Install to custom directories for multiple agents
npx add-skill vercel-labs/agent-skills -g --global-dir-opencode ~/custom/opencode --global-dir-cursor /opt/cursor-skills
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

### Global (`--global`)

Installed in your home directory. Available across all projects.

| Agent | Path |
|-------|------|
| OpenCode | `~/.config/opencode/skill/<name>/` |
| Claude Code | `~/.claude/skills/<name>/` |
| Codex | `~/.codex/skills/<name>/` |
| Cursor | `~/.cursor/skills/<name>/` |

### Custom Global Directories

You can override the default global installation path for each agent using the `--global-dir-<agent>` flags. This is useful when you want skills installed to a specific location, such as a shared network drive or custom directory structure.

**Per-agent custom directories:**

```bash
# Install Claude Code skills to a custom location
npx add-skill repo/skills -g --global-dir-claude-code /custom/path/to/claude-skills

# Install to different custom directories for each agent
npx add-skill repo/skills -g \
  --global-dir-opencode /data/opencode/skills \
  --global-dir-claude-code /data/claude/skills \
  --global-dir-codex /data/codex/skills \
  --global-dir-cursor /data/cursor/skills
```

When a custom global directory doesn't exist, you'll be prompted to either:
- Create the directory automatically
- Use the agent's default global path instead
- Cancel the installation

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

If no skills are found in standard locations, a recursive search is performed.

## Compatibility

Skills are generally compatible across agents since they follow a shared [Agent Skills specification](https://agentskills.io). However, some features may be agent-specific:

| Feature | OpenCode | Claude Code | Codex | Cursor |
|---------|----------|-------------|-------|--------|
| Basic skills | Yes | Yes | Yes | Yes |
| `allowed-tools` | Yes | Yes | Yes | Yes |
| `context: fork` | No | Yes | No | No |
| Hooks | No | Yes | No | No |

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
- [OpenCode Skills Documentation](https://opencode.ai/docs/skills/)
- [Claude Code Skills Documentation](https://code.claude.com/docs/en/skills)
- [Codex Skills Documentation](https://developers.openai.com/codex/skills/)
- [Cursor Skills Documentation](https://cursor.com/docs/context/skills)

## License

MIT
