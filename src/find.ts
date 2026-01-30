import * as readline from 'readline';
import { runAdd, parseAddOptions } from './add.ts';
import { track } from './telemetry.ts';
import { isRepoPrivate, parseOwnerRepo } from './source-parser.ts';

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[38;5;102m';
const TEXT = '\x1b[38;5;145m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const YELLOW = '\x1b[33m';

// API endpoint for skills search
const SEARCH_API_BASE = process.env.SKILLS_API_URL || 'https://skills.sh';

export interface SearchSkill {
  name: string;
  slug: string;
  source: string;
  installs: number;
}

// Search via API
export async function searchSkillsAPI(query: string): Promise<SearchSkill[]> {
  try {
    const url = `${SEARCH_API_BASE}/api/search?q=${encodeURIComponent(query)}&limit=10`;
    const res = await fetch(url);

    if (!res.ok) return [];

    const data = (await res.json()) as {
      skills: Array<{
        id: string;
        name: string;
        installs: number;
        topSource: string | null;
      }>;
    };

    return data.skills.map((skill) => ({
      name: skill.name,
      slug: skill.id,
      source: skill.topSource || '',
      installs: skill.installs,
    }));
  } catch {
    return [];
  }
}

// ANSI escape codes for terminal control
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_DOWN = '\x1b[J';
const MOVE_UP = (n: number) => `\x1b[${n}A`;
const MOVE_TO_COL = (n: number) => `\x1b[${n}G`;

// Custom fzf-style search prompt using raw readline
async function runSearchPrompt(initialQuery = ''): Promise<SearchSkill | null> {
  let results: SearchSkill[] = [];
  let selectedIndex = 0;
  let query = initialQuery;
  let loading = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRenderedLines = 0;

  // Enable raw mode for keypress events
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }

  // Setup readline for keypress events but don't let it echo
  readline.emitKeypressEvents(process.stdin);

  // Resume stdin to start receiving events
  process.stdin.resume();

  // Hide cursor during selection
  process.stdout.write(HIDE_CURSOR);

  function render(): void {
    // Move cursor up to overwrite previous render
    if (lastRenderedLines > 0) {
      process.stdout.write(MOVE_UP(lastRenderedLines) + MOVE_TO_COL(1));
    }

    // Clear from cursor to end of screen (removes ghost trails)
    process.stdout.write(CLEAR_DOWN);

    const lines: string[] = [];

    // Search input line with cursor
    const cursor = `${BOLD}_${RESET}`;
    lines.push(`${TEXT}Search skills:${RESET} ${query}${cursor}`);
    lines.push('');

    // Results - keep showing existing results while loading new ones
    if (!query || query.length < 2) {
      lines.push(`${DIM}Start typing to search (min 2 chars)${RESET}`);
    } else if (results.length === 0 && loading) {
      lines.push(`${DIM}Searching...${RESET}`);
    } else if (results.length === 0) {
      lines.push(`${DIM}No skills found${RESET}`);
    } else {
      const maxVisible = 8;
      const visible = results.slice(0, maxVisible);

      for (let i = 0; i < visible.length; i++) {
        const skill = visible[i]!;
        const isSelected = i === selectedIndex;
        const arrow = isSelected ? `${BOLD}>${RESET}` : ' ';
        const name = isSelected ? `${BOLD}${skill.name}${RESET}` : `${TEXT}${skill.name}${RESET}`;
        const source = skill.source ? ` ${DIM}${skill.source}${RESET}` : '';
        const loadingIndicator = loading && i === 0 ? ` ${DIM}...${RESET}` : '';

        lines.push(`  ${arrow} ${name}${source}${loadingIndicator}`);
      }
    }

    lines.push('');
    lines.push(`${DIM}up/down navigate | enter select | esc cancel${RESET}`);

    // Write each line
    for (const line of lines) {
      process.stdout.write(line + '\n');
    }

    lastRenderedLines = lines.length;
  }

  function triggerSearch(q: string): void {
    // Always clear any pending debounce timer
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Always reset loading state when starting a new search
    loading = false;

    if (!q || q.length < 2) {
      results = [];
      selectedIndex = 0;
      render();
      return;
    }

    // Use API search for all queries (debounced)
    loading = true;
    render();

    // Adaptive debounce: shorter queries = longer wait (user still typing)
    // 2 chars: 250ms, 3 chars: 200ms, 4 chars: 150ms, 5+ chars: 150ms
    const debounceMs = Math.max(150, 350 - q.length * 50);

    debounceTimer = setTimeout(async () => {
      try {
        results = await searchSkillsAPI(q);
        selectedIndex = 0;
      } catch {
        results = [];
      } finally {
        loading = false;
        debounceTimer = null;
        render();
      }
    }, debounceMs);
  }

  // Trigger initial search if there's a query, then render
  if (initialQuery) {
    triggerSearch(initialQuery);
  }
  render();

  return new Promise((resolve) => {
    function cleanup(): void {
      process.stdin.removeListener('keypress', handleKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdout.write(SHOW_CURSOR);
      // Pause stdin to fully release it for child processes
      process.stdin.pause();
    }

    function handleKeypress(_ch: string | undefined, key: readline.Key): void {
      if (!key) return;

      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        // Cancel
        cleanup();
        resolve(null);
        return;
      }

      if (key.name === 'return') {
        // Submit
        cleanup();
        resolve(results[selectedIndex] || null);
        return;
      }

      if (key.name === 'up') {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
        return;
      }

      if (key.name === 'down') {
        selectedIndex = Math.min(Math.max(0, results.length - 1), selectedIndex + 1);
        render();
        return;
      }

      if (key.name === 'backspace') {
        if (query.length > 0) {
          query = query.slice(0, -1);
          triggerSearch(query);
        }
        return;
      }

      // Regular character input
      if (key.sequence && !key.ctrl && !key.meta && key.sequence.length === 1) {
        const char = key.sequence;
        if (char >= ' ' && char <= '~') {
          query += char;
          triggerSearch(query);
        }
      }
    }

    process.stdin.on('keypress', handleKeypress);
  });
}

// Parse owner/repo from a package string (for the find command)
function getOwnerRepoFromString(pkg: string): { owner: string; repo: string } | null {
  // Handle owner/repo or owner/repo@skill
  const atIndex = pkg.lastIndexOf('@');
  const repoPath = atIndex > 0 ? pkg.slice(0, atIndex) : pkg;
  const match = repoPath.match(/^([^/]+)\/([^/]+)$/);
  if (match) {
    return { owner: match[1]!, repo: match[2]! };
  }
  return null;
}

async function isRepoPublic(owner: string, repo: string): Promise<boolean> {
  const isPrivate = await isRepoPrivate(owner, repo);
  // Return true only if we know it's public (isPrivate === false)
  // Return false if private or unable to determine
  return isPrivate === false;
}

export async function runFind(args: string[]): Promise<void> {
  const query = args.join(' ');
  const isNonInteractive = !process.stdin.isTTY;
  const agentTip = `${DIM}Tip: if running in a coding agent, follow these steps:${RESET}
${DIM}  1) npx skills find [query]${RESET}
${DIM}  2) npx skills add <owner/repo@skill>${RESET}`;

  // Non-interactive mode: just print results and exit
  if (query) {
    const results = await searchSkillsAPI(query);

    // Track telemetry for non-interactive search
    track({
      event: 'find',
      query,
      resultCount: String(results.length),
    });

    if (results.length === 0) {
      console.log(`${DIM}No skills found for "${query}"${RESET}`);
      return;
    }

    console.log(`${DIM}Install with${RESET} npx skills add <owner/repo@skill>`);
    console.log();

    for (const skill of results.slice(0, 6)) {
      const pkg = skill.source || skill.slug;
      console.log(`${TEXT}${pkg}@${skill.name}${RESET}`);
      console.log(`${DIM}└ https://skills.sh/${pkg}/${skill.slug}${RESET}`);
      console.log();
    }
    return;
  }

  // Interactive mode - show tip only if running non-interactively (likely in a coding agent)
  if (isNonInteractive) {
    console.log(agentTip);
    console.log();
  }
  const selected = await runSearchPrompt();

  // Track telemetry for interactive search
  track({
    event: 'find',
    query: '',
    resultCount: selected ? '1' : '0',
    interactive: '1',
  });

  if (!selected) {
    console.log(`${DIM}Search cancelled${RESET}`);
    console.log();
    return;
  }

  // Use source (owner/repo) and skill name for installation
  const pkg = selected.source || selected.slug;
  const skillName = selected.name;

  console.log();
  console.log(`${TEXT}Installing ${BOLD}${skillName}${RESET} from ${DIM}${pkg}${RESET}...`);
  console.log();

  // Run add directly since we're in the same CLI
  const { source, options } = parseAddOptions([pkg, '--skill', skillName]);
  await runAdd(source, options);

  console.log();

  const info = getOwnerRepoFromString(pkg);
  if (info && (await isRepoPublic(info.owner, info.repo))) {
    console.log(
      `${DIM}View the skill at${RESET} ${TEXT}https://skills.sh/${info.owner}/${info.repo}/${selected.slug}${RESET}`
    );
  } else {
    console.log(`${DIM}Discover more skills at${RESET} ${TEXT}https://skills.sh${RESET}`);
  }

  console.log();
}
