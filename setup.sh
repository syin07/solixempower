#!/usr/bin/env bash
# Candidate Benchmark — team setup. Everyone runs:
#
#   ./setup.sh sandy | gavin | medhansh
#
# Sandy's first run also scaffolds the app (Next.js + contracts + mock fixtures + branches).
# Every run: installs deps, creates .env.local, switches to your branch, and configures
# your coding agent (all generated files are gitignored):
#   Claude Code    (Sandy, Medhansh): .claude/role.md + .claude/settings.local.json
#   GitHub Copilot (Gavin):           .github/copilot-instructions.md + .vscode/settings.json
set -euo pipefail
cd "$(dirname "$0")"

die() { echo "✗ $*" >&2; exit 1; }
ok()  { echo "✓ $*"; }

NAME="${1:-}"
case "$NAME" in
  sandy)
    DISPLAY="Sandy"
    AGENT="claude"
    BRANCH="sandy/data"
    OWNS="src/lib/chembl/** src/lib/benchmark/** src/app/api/benchmark/** src/lib/contracts.ts src/fixtures/** setup.sh src/lib/agent/** src/app/api/report/**"
    ASK=""
    STYLE="Sandy is the integration lead and merges to main. Goal right now: a working end-to-end MVP on real data with Gavin before Medhansh arrives (~T+3:30) — favor working over polished. Sandy owns src/lib/agent and /api/report until handing them to Medhansh at T+3:30; after that, leave them to Medhansh. Be direct and fast. Sandy may touch any file when integrating, but call it out when a change lands in someone else's area (see ownership table in CLAUDE.md)."
    ;;
  gavin)
    DISPLAY="Gavin"
    AGENT="copilot"
    BRANCH="gavin/ui"
    OWNS="src/app/page.tsx src/app/layout.tsx src/app/globals.css src/components/**"
    ASK="src/lib/** src/app/api/** src/fixtures/**"
    STYLE="Gavin is the least experienced on the team. Phase 1 goal: a working (not pretty) UI for the MVP by ~T+3:10; polish comes in Phase 2. Work in small steps, explain what each change does and why in plain language, and tell Gavin how to check it in the browser. Build against the mock data from /api/* — don't wait for real APIs. Never change src/lib/contracts.ts; if a type seems wrong, tell Gavin to ask Sandy. Suggest committing after each working step."
    ;;
  medhansh)
    DISPLAY="Medhansh"
    AGENT="claude"
    BRANCH="medhansh/agent"
    OWNS="src/lib/trials/** src/lib/agent/** src/app/api/trials/** src/app/api/report/**"
    ASK="src/lib/contracts.ts src/lib/chembl/** src/lib/benchmark/** src/components/** src/app/page.tsx"
    STYLE="Medhansh is the most experienced and joins mid-hackathon (~T+3:30), when a working MVP is already on main (tag mvp). Be concise; skip basics. Prioritize a real /api/trials and hardening /api/report (citation validation, trials in the evidence) without changing response shapes, then review the whole app against the guardrails in PRD.md §7."
    ;;
  *) die "Usage: ./setup.sh sandy | gavin | medhansh" ;;
esac

check_prereqs() {
  command -v node >/dev/null || die "Node.js not found. Install Node 22+ (brew install node)."
  local major
  major=$(node -p 'process.versions.node.split(".")[0]')
  (( major >= 20 )) || die "Node $(node -v) found; need 20 or newer."
  command -v git >/dev/null || die "git not found."
  ok "node $(node -v), $(git --version)"
  if [[ "$AGENT" == "claude" ]]; then
    command -v claude >/dev/null || echo "! Claude Code not found — install: npm i -g @anthropic-ai/claude-code"
  elif ! command -v code >/dev/null; then
    echo "! VS Code 'code' command not found — in VS Code: Cmd+Shift+P → 'Shell Command: Install code command in PATH'"
  # Avoid grep -q here: with pipefail, grep can close the pipe after finding
  # Copilot and make code exit with SIGPIPE, which looks like a failed check.
  elif ! code --list-extensions 2>/dev/null | grep -i '^github\.copilot' >/dev/null &&
       [[ ! -d "${XDG_CONFIG_HOME:-$HOME/.config}/Code/User/globalStorage/github.copilot-chat" ]] &&
       [[ ! -d "$HOME/.var/app/com.visualstudio.code/config/Code/User/globalStorage/github.copilot-chat" ]]; then
    echo "! GitHub Copilot extension not found — install: code --install-extension GitHub.copilot-chat"
  fi
}

# One-time scaffold, only from Sandy's run
scaffold() {
  [[ -d scaffold ]] || die "scaffold/ folder missing."

  # create-next-app refuses non-empty dirs, so scaffold in a temp dir and copy over
  local tmp
  tmp=$(mktemp -d)
  npx --yes create-next-app@latest "$tmp/app" \
    --ts --tailwind --eslint --app --src-dir --import-alias "@/*" \
    --use-npm --disable-git --yes
  cp -R "$tmp/app/." .
  rm -rf "$tmp"
  ok "Next.js app scaffolded"

  npm install @anthropic-ai/sdk recharts zod
  ok "deps installed (@anthropic-ai/sdk, recharts, zod)"

  cp -R scaffold/. .
  rm -rf scaffold
  mkdir -p src/lib/chembl src/lib/benchmark src/lib/trials src/lib/agent src/components
  touch src/lib/chembl/.gitkeep src/lib/benchmark/.gitkeep src/lib/trials/.gitkeep \
        src/lib/agent/.gitkeep src/components/.gitkeep
  cat >> .gitignore <<'EOF'

# keep the env template; per-person agent config stays local
!.env.example
.claude/role.md
.claude/settings.local.json
.github/copilot-instructions.md
.vscode/settings.json
EOF
  ok "contracts, fixtures, stub routes, CLAUDE.md in place"

  [[ -d .git ]] || git init -q -b main
  git add -A
  git commit -q -m "Scaffold: Next.js app, shared contracts, mock fixtures, stub API routes"
  local b
  for b in sandy/data gavin/ui medhansh/agent; do
    git branch "$b" 2>/dev/null || true
  done
  ok "git: main + sandy/data, gavin/ui, medhansh/agent"
  SCAFFOLDED=1
}

checkout_branch() {
  git fetch -q origin 2>/dev/null || true
  if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    git checkout -q "$BRANCH"
  elif git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
    git checkout -q -b "$BRANCH" --track "origin/$BRANCH"
  else
    git checkout -q -b "$BRANCH"
  fi
  ok "on branch $BRANCH"
}

# Prints the text between <!-- role:NAME --> and <!-- /role:NAME --> in PRD.md
role_section() {
  awk -v r="$NAME" '
    $0 ~ "<!-- role:" r " -->"  { p = 1; next }
    $0 ~ "<!-- /role:" r " -->" { p = 0 }
    p
  ' PRD.md
}

# Role context shared by both agents: style, ownership, tasks from PRD.md
role_body() {
  echo "# You are working with ${DISPLAY}"
  echo
  echo "$STYLE"
  echo
  echo "## Files ${DISPLAY} owns (edit freely)"
  local p
  for p in $OWNS; do echo "- \`$p\`"; done
  if [[ -n "$ASK" ]]; then
    echo
    echo "## Other people's files (you'll be prompted before editing — prefer asking the owner)"
    for p in $ASK; do echo "- \`$p\`"; done
  fi
  echo
  echo "## ${DISPLAY}'s tasks (from PRD.md §10)"
  role_section
}

configure_claude() {
  mkdir -p .claude
  role_body > .claude/role.md   # imported by CLAUDE.md via @.claude/role.md
  ok "agent role written to .claude/role.md"

  # Permissions: merge into any existing settings.local.json rather than clobbering it
  ASK="$ASK" node - <<'EOF'
const fs = require("fs");
const file = ".claude/settings.local.json";
let s = {};
try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
s.permissions ??= {};
const add = (key, rules) => {
  const cur = new Set(s.permissions[key] ?? []);
  rules.forEach((r) => cur.add(r));
  s.permissions[key] = [...cur];
};
add("allow", [
  "Bash(npm run *)",
  "Bash(npx tsc --noEmit)",
  "Bash(git status)",
  "Bash(git diff *)",
  "Bash(git log *)",
  "WebFetch(domain:www.ebi.ac.uk)",
  "WebFetch(domain:clinicaltrials.gov)",
]);
const ask = (process.env.ASK || "").split(/\s+/).filter(Boolean).map((p) => `Edit(${p})`);
if (ask.length) add("ask", ask);
add("deny", ["Read(.env.local)", "Edit(.env.local)"]);
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
EOF
  ok "agent permissions written to .claude/settings.local.json"
}

configure_copilot() {
  # Copilot has no @imports: inline CLAUDE.md (minus import lines) + the role body
  mkdir -p .github
  {
    echo "<!-- Generated by ./setup.sh $NAME — edit CLAUDE.md / PRD.md instead, then re-run. -->"
    sed -e 's/Full spec: @PRD\.md/Full spec: PRD.md — read it, and src\/lib\/contracts.ts, before starting a task./' \
        -e '/^@/d' CLAUDE.md
    echo
    role_body
  } > .github/copilot-instructions.md
  ok "Copilot instructions written to .github/copilot-instructions.md"

  # VS Code workspace settings: merge rather than clobber
  ASK="$ASK" node - <<'EOF'
const fs = require("fs");
const file = ".vscode/settings.json";
fs.mkdirSync(".vscode", { recursive: true });
let s = {};
try { s = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
s["github.copilot.chat.codeGeneration.useInstructionFiles"] = true;
// Agent mode may run these terminal commands without asking
s["chat.tools.terminal.autoApprove"] = {
  ...(s["chat.tools.terminal.autoApprove"] ?? {}),
  "/^npm run (dev|lint|build)\\b/": true,
  "/^npx tsc --noEmit$/": true,
  "/^git (status|diff|log)\\b/": true,
};
// false = agent must get approval before editing files matching these globs
const ask = (process.env.ASK || "").split(/\s+/).filter(Boolean);
s["chat.tools.edits.autoApprove"] = {
  ...(s["chat.tools.edits.autoApprove"] ?? {}),
  ...Object.fromEntries(ask.map((p) => [`**/${p}`, false])),
  "**/.env*": false,
};
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
EOF
  ok "Copilot agent settings written to .vscode/settings.json"
}

SCAFFOLDED=0
check_prereqs

if [[ ! -f package.json ]]; then
  [[ "$NAME" == "sandy" ]] || die "App not scaffolded yet. Sandy runs './setup.sh sandy' and pushes first; then 'git pull' and re-run."
  scaffold
fi

npm install
ok "deps installed"

if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  ok "created .env.local from .env.example"
fi
if [[ "$NAME" != "gavin" ]] && ! grep -qE '^ANTHROPIC_API_KEY=.+' .env.local; then
  echo "! ANTHROPIC_API_KEY is empty in .env.local — get it from team chat."
fi

checkout_branch
"configure_$AGENT"

echo
echo "────────────────────────────────────────────────────────────"
role_section
echo "────────────────────────────────────────────────────────────"

if (( SCAFFOLDED )); then
  cat <<'EOF'

First-run steps (Sandy):
  1. Create an empty GitHub repo, then:
       git remote add origin git@github.com:<you>/<repo>.git
       git push -u origin --all
  2. Add Gavin and Medhansh as collaborators; they clone and run ./setup.sh <name>.
  3. Share ANTHROPIC_API_KEY in team chat (never commit it).
EOF
fi

echo
echo "Start the app:    npm run dev   →  http://localhost:3000"
if [[ "$AGENT" == "claude" ]]; then
  echo "Start your agent: claude        (it already knows your role, files, and tasks)"
else
  echo "Start your agent: code .  → open Copilot Chat (Ctrl+Cmd+I), switch to Agent mode."
  echo "                  It already knows your role, files, and tasks."
fi
