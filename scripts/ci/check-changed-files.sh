#!/usr/bin/env bash
set -euo pipefail

# Formats, lints and checks the English-only rule on the files a change adds
# or modifies. Published built-in Skill versions are immutable and never
# reformatted.
#
# Usage: check-changed-files.sh <base> <head>   diff two commits (the gate)
#        check-changed-files.sh <base> --worktree
#          diff the working tree, plus untracked files (local make check)

if (($# != 2)); then
  echo "Usage: $0 <base> (<head> | --worktree)" >&2
  exit 2
fi
base=$1
if [[ "$2" == --worktree ]]; then
  list_changed() {
    git -c core.quotePath=false diff -z --name-only --no-renames --diff-filter=ACMRT "$base"
    git -c core.quotePath=false ls-files -z --others --exclude-standard
  }
else
  head=$2
  list_changed() {
    git -c core.quotePath=false diff -z --name-only --no-renames --diff-filter=ACMRT "$base" "$head"
  }
fi

prettier_files=()
eslint_files=()
changed_files=()
while IFS= read -r -d '' file; do
  [[ "$file" =~ ^skills/builtin/[^/]+/[^/]+/ ]] && continue
  [[ -f "$file" ]] || continue
  case "$file" in
    *.cjs | *.css | *.html | *.js | *.json | *.jsonc | *.jsx | *.md | *.mdx | *.mjs | *.mts | *.scss | *.ts | *.tsx | *.yaml | *.yml)
      prettier_files+=("$file")
      ;;
  esac
  case "$file" in
    *.cjs | *.cts | *.js | *.jsx | *.mjs | *.mts | *.ts | *.tsx) eslint_files+=("$file") ;;
  esac
  changed_files+=("$file")
done < <(list_changed)
if ((${#prettier_files[@]} > 0)); then
  pnpm exec prettier --check "${prettier_files[@]}"
fi
if ((${#eslint_files[@]} > 0)); then
  pnpm exec eslint "${eslint_files[@]}"
fi

# The repository is English-only. Only CJK ideographs are rejected, so tests
# may still use kana, Hangul, and full-width punctuation as unspaced scripts.
# git grep exits 1 when nothing matches; any other non-zero status is an error
# (for example a git without PCRE), which must fail the check rather than pass
# it. --untracked lets the local run see files not yet added.
if ((${#changed_files[@]} > 0)); then
  cjk_status=0
  LC_ALL=C git grep --untracked -nIP '(*UTF)[\x{3400}-\x{4DBF}\x{4E00}-\x{9FFF}\x{F900}-\x{FAFF}]' -- "${changed_files[@]}" || cjk_status=$?
  if ((cjk_status == 0)); then
    echo "Changed files contain Chinese characters; the repository is English-only (see AGENTS.md)." >&2
    exit 1
  elif ((cjk_status != 1)); then
    echo "The English-only check could not run (git grep exited $cjk_status)." >&2
    exit 1
  fi
fi
