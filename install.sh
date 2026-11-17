#!/usr/bin/env bash
set -Eeuo pipefail

# Guided interactive installer for Linger Docker Compose local models and
# Local Computer connection on macOS (Apple silicon) and Linux.

SCRIPT_PATH="${BASH_SOURCE[0]:-}"
REPO_ROOT=""
if [[ -n "$SCRIPT_PATH" && -e "$SCRIPT_PATH" ]]; then
  REPO_ROOT="$(cd -- "$(dirname -- "$SCRIPT_PATH")" && pwd -P)"
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/linger-install.XXXXXX")"
chmod 0700 "$WORK_DIR"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

MODE="guide"
EXPLICIT_WEB_URL=""
WEB_URL=""
CONNECT_LINGER=1
PURGE=0
YES=0

STACK_SCRIPT=""
KIT_PYTHON=""
PROMPT_VALUE=""

usage() {
  cat <<'EOF'
Usage: ./install.sh [options]

Guided setup for Linger local models and connecting this computer to Linger.

Options:
  --web-url <origin>   Linger server URL (default: http://localhost:3000)
  --connect            Install and connect linger-computer only
  --up                 Start installed local models and refresh linger-computer
  --status             Show local model and linger-computer status
  --remove             Uninstall local model services (keeps downloaded files)
  --purge              With --remove, also delete downloaded weights and caches
  --yes                Confirm non-interactively for supported flags
  -h, --help           Show this help message
EOF
}

die() {
  printf 'install.sh: %s\n' "$1" >&2
  exit 1
}

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

trim_whitespace() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

normalize_origin() {
  local raw
  raw="$(trim_whitespace "$1")"
  while [[ "$raw" == */ ]]; do
    raw="${raw%/}"
  done
  local origin_pattern='^https?://([a-zA-Z0-9.-]+|\[[0-9a-fA-F:.]+\])(:[0-9]+)?$'
  if [[ ! "$raw" =~ $origin_pattern ]]; then
    return 1
  fi
  lowercase "$raw"
}

prompt_line() {
  local prompt_text="$1"
  local reply=""
  printf '%s' "$prompt_text"
  if [[ -n "$SCRIPT_PATH" ]]; then
    IFS= read -r reply || reply=""
  else
    IFS= read -r reply < /dev/tty || reply=""
  fi
  PROMPT_VALUE="$(trim_whitespace "$reply")"
}

prompt_secret() {
  local prompt_text="$1"
  local reply=""
  printf '%s' "$prompt_text"
  if [[ -n "$SCRIPT_PATH" ]]; then
    if [[ -t 0 ]]; then
      IFS= read -r -s reply || reply=""
      printf '\n'
    else
      IFS= read -r reply || reply=""
    fi
  elif [[ -r /dev/tty ]]; then
    IFS= read -r -s reply < /dev/tty || reply=""
    printf '\n' > /dev/tty 2>/dev/null || printf '\n'
  else
    IFS= read -r reply || reply=""
  fi
  PROMPT_VALUE="$reply"
}

read_env_value() {
  local env_file="$1"
  local key="$2"
  [[ -f "$env_file" ]] || return 1
  awk -v k="$key" '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ { next }
    {
      line = $0
      sub(/^[[:space:]]*(export[[:space:]]+)?/, "", line)
      eq = index(line, "=")
      if (eq <= 0) next
      var = substr(line, 1, eq - 1)
      sub(/[[:space:]]+$/, "", var)
      if (var != k) next
      val = substr(line, eq + 1)
      sub(/^[[:space:]]+/, "", val)
      sub(/[[:space:]]+$/, "", val)
      if ((substr(val, 1, 1) == "\"" && substr(val, length(val), 1) == "\"") ||
          (substr(val, 1, 1) == "\x27" && substr(val, length(val), 1) == "\x27")) {
        val = substr(val, 2, length(val) - 2)
      }
      found = val
    }
    END {
      if (found != "") {
        print found
        exit 0
      }
      exit 1
    }
  ' "$env_file"
}

sanitize_engine_stream() {
  sed -E \
    -e 's/stack\.sh:/install.sh:/g' \
    -e 's/on Windows use stack\.ps1/on Windows use the Linger desktop app/g' \
    -e 's/stack\.ps1/the Linger desktop app/g' \
    -e 's/(python3 -m )?localmodels stack remove --purge/.\/install.sh --remove --purge/g' \
    -e 's/stack remove --purge/.\/install.sh --remove --purge/g' \
    -e 's/(python3 -m )?localmodels stack remove/.\/install.sh --remove/g' \
    -e 's/stack remove/.\/install.sh --remove/g' \
    -e 's/(python3 -m )?localmodels stack up/.\/install.sh --up/g' \
    -e 's/stack up/.\/install.sh --up/g' \
    -e 's/(python3 -m )?localmodels stack status/.\/install.sh --status/g' \
    -e 's/stack status/.\/install.sh --status/g' \
    -e 's/(python3 -m )?localmodels stack plan( --update)?/.\/install.sh/g' \
    -e 's/stack plan( --update)?/.\/install.sh/g' \
    -e 's/(python3 -m )?localmodels stack apply[^[:cntrl:]]*/.\/install.sh/g' \
    -e 's/stack apply[^[:cntrl:]]*/.\/install.sh/g' \
    -e 's/(python3 -m )?localmodels install/.\/install.sh/g' \
    -e 's/stack\.sh/install.sh/g'
}

run_sanitized_live() {
  local rc=0
  local line=""
  set +e
  "$@" 2>&1 | while IFS= read -r line || [[ -n "$line" ]]; do
    printf '%s\n' "$line" | sanitize_engine_stream
  done
  rc=${PIPESTATUS[0]}
  set -e
  return "$rc"
}

computer_environment_name() {
  local rest="${1#*://}" host port name
  if [[ "$rest" == \[* ]]; then host="${rest%%]*}]"; else host="${rest%%:*}"; fi
  port="${rest#"$host"}"
  port="${port#:}"
  if [[ "$1" == http://* && "$port" == 80 ]] || [[ "$1" == https://* && "$port" == 443 ]]; then
    port=""
  fi
  case "$host" in
    localhost | *.localhost | 127.0.0.1 | '[::1]') name=local ;;
    \[*)
      name="${host#[}"
      name="ip-${name%]}"
      name="${name//[:.]/-}"
      ;;
    *)
      if [[ "$host" =~ ^[0-9.]+$ ]]; then
        name="ip-${host//./-}"
      else
        name="${host%%.*}"
        [[ "$name" == linger ]] || name="${name%-linger}"
      fi
      ;;
  esac
  [[ -z "$port" ]] || name="$name-$port"
  printf '%s\n' "$name"
}

check_supported_platform() {
  local sys arch
  sys="$(uname -s)"
  arch="$(uname -m)"
  case "$sys" in
    Linux) ;;
    Darwin)
      if [[ "$arch" != arm64 ]]; then
        die "macOS local models require Apple silicon (arm64); Intel Macs can use ./install.sh --connect against a remote server or another AI provider."
      fi
      ;;
    *)
      die "Unsupported operating system ($sys). On Windows, use the Linger desktop app or see docs/local-inference.md."
      ;;
  esac
  command -v curl >/dev/null 2>&1 || die "curl is required."
}

ensure_engine() {
  check_supported_platform
  if [[ -n "${LINGER_STACK_SCRIPT:-}" ]]; then
    [[ -r "$LINGER_STACK_SCRIPT" ]] || die "Configured engine helper is not readable: $LINGER_STACK_SCRIPT"
    STACK_SCRIPT="$LINGER_STACK_SCRIPT"
  elif [[ -n "$REPO_ROOT" && -r "$REPO_ROOT/scripts/installs/stack.sh" ]]; then
    STACK_SCRIPT="$REPO_ROOT/scripts/installs/stack.sh"
  else
    STACK_SCRIPT="$WORK_DIR/engine.sh"
    local engine_url="${LINGER_STACK_URL:-https://simplexai.com/stack.sh}"
    curl -fsSL "$engine_url" -o "$STACK_SCRIPT" || die "Could not download the local model runtime bootstrap."
    chmod 0700 "$STACK_SCRIPT"
  fi

  local bootstrap_out=""
  local bootstrap_rc=0
  set +e
  bootstrap_out="$(sh "$STACK_SCRIPT" --bootstrap-json 2>"$WORK_DIR/bootstrap.err")"
  bootstrap_rc=$?
  set -e
  if (( bootstrap_rc != 0 )); then
    if [[ -s "$WORK_DIR/bootstrap.err" ]]; then
      sanitize_engine_stream < "$WORK_DIR/bootstrap.err" >&2
    fi
    die "Could not initialize the local model runtime."
  fi

  KIT_PYTHON="$(printf '%s' "$bootstrap_out" | sed -n 's/.*"python"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  [[ -n "$KIT_PYTHON" && -x "$KIT_PYTHON" ]] || die "Runtime bootstrap did not return a valid Python executable."
}

default_web_url() {
  local candidate=""
  if [[ -n "$EXPLICIT_WEB_URL" ]]; then
    candidate="$EXPLICIT_WEB_URL"
  elif [[ -n "${LINGER_WEB_URL:-}" ]]; then
    candidate="$LINGER_WEB_URL"
  elif [[ -n "$REPO_ROOT" && -f "$REPO_ROOT/.env" ]]; then
    candidate="$(read_env_value "$REPO_ROOT/.env" "WEB_PUBLIC_ORIGIN" || true)"
  fi
  if [[ -z "$candidate" ]]; then
    candidate="http://localhost:3000"
  fi
  normalize_origin "$candidate" || die "Invalid Linger server URL: $candidate"
}

probe_linger_origin() {
  local origin="$1"
  local probe_file="$WORK_DIR/probe-linger.sh"
  if curl -fsS --max-time 5 "$origin/install/linger-computer.sh" -o "$probe_file" 2>/dev/null; then
    grep -Fq '# linger-computer-launcher-v2' "$probe_file"
    return $?
  fi
  return 1
}

compose_available() {
  [[ -n "$REPO_ROOT" && -f "$REPO_ROOT/docker-compose.yml" ]] &&
    command -v docker >/dev/null 2>&1 &&
    docker compose version >/dev/null 2>&1
}

start_compose_server() {
  if [[ ! -f "$REPO_ROOT/.env" ]]; then
    [[ -f "$REPO_ROOT/.env.example" ]] || die "Missing $REPO_ROOT/.env.example."
    cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
    printf '  Created .env from .env.example.\n'
  fi

  printf '  Starting Linger with Docker Compose...\n'
  (cd "$REPO_ROOT" && docker compose up --build --detach --wait) || die "Docker Compose failed to start Linger."

  if [[ -z "$EXPLICIT_WEB_URL" ]]; then
    local env_origin=""
    env_origin="$(read_env_value "$REPO_ROOT/.env" "WEB_PUBLIC_ORIGIN" || true)"
    if [[ -n "$env_origin" ]]; then
      WEB_URL="$(normalize_origin "$env_origin" || printf '%s' "$WEB_URL")"
    fi
  fi

  local waited=0
  while (( waited < 15 )); do
    if probe_linger_origin "$WEB_URL"; then
      break
    fi
    sleep 1
    waited=$((waited + 1))
  done

  if ! probe_linger_origin "$WEB_URL"; then
    die "Linger did not respond at $WEB_URL after Docker Compose started."
  fi
  printf '  Linger server is ready at %s\n' "$WEB_URL"

  prompt_line "  Create the initial owner account now? [Y/n]: "
  local create_owner=""
  create_owner="$(lowercase "$PROMPT_VALUE")"
  if [[ -z "$create_owner" || "$create_owner" == "y" || "$create_owner" == "yes" ]]; then
    local owner_email="owner@linger.local"
    prompt_line "  Owner email [owner@linger.local]: "
    if [[ -n "$PROMPT_VALUE" ]]; then
      owner_email="$PROMPT_VALUE"
    fi

    local owner_pw=""
    while :; do
      prompt_secret "  Owner password (min 8 chars, Enter for 'test1234'): "
      owner_pw="$PROMPT_VALUE"
      if [[ -z "$owner_pw" ]]; then
        owner_pw="test1234"
        printf '  Reminder: change the default password in Settings -> Security.\n'
        break
      fi
      if (( ${#owner_pw} >= 8 )); then
        break
      fi
      printf '  Password must be at least 8 characters.\n'
    done

    local owner_rc=0
    set +e
    printf '%s\n' "$owner_pw" | (
      cd "$REPO_ROOT" &&
      docker compose exec -T teamhub teamhub-account create-owner --email "$owner_email" --password-stdin
    )
    owner_rc=$?
    set -e
    unset owner_pw
    if (( owner_rc != 0 )); then
      printf '  Could not create owner account (an owner may already exist). You can sign in in your browser.\n'
    fi
  fi
}

prompt_custom_url() {
  while :; do
    prompt_line "  Enter Linger server URL (or 'skip' to install local models only): "
    local raw="$PROMPT_VALUE"
    if [[ "$(lowercase "$raw")" == "skip" || -z "$raw" ]]; then
      CONNECT_LINGER=0
      printf '  Continuing with local models only.\n'
      return 0
    fi
    local normalized=""
    if ! normalized="$(normalize_origin "$raw")"; then
      printf '  Invalid URL. Use an origin like http://localhost:3000 or https://linger.example.com.\n'
      continue
    fi
    if probe_linger_origin "$normalized"; then
      WEB_URL="$normalized"
      CONNECT_LINGER=1
      printf '  Found Linger server at %s\n' "$WEB_URL"
      return 0
    fi
    printf '  Could not reach a Linger server at %s.\n' "$normalized"
    prompt_line "  Use this URL anyway? [y/N]: "
    local force=""
    force="$(lowercase "$PROMPT_VALUE")"
    if [[ "$force" == "y" || "$force" == "yes" ]]; then
      WEB_URL="$normalized"
      CONNECT_LINGER=1
      return 0
    fi
  done
}

resolve_computer_env() {
  local bin_dir="${LINGER_COMPUTER_BIN_DIR:-$HOME/.local/bin}"
  local gateway_pi_dir="${LINGER_PI_AGENT_DIR:-$HOME/.local/share/localmodels/tools/gateway-home/.pi/agent}"
  local runtime_path="$bin_dir:$HOME/.local/bin:$PATH"
  COMPUTER_ENV=("PATH=$runtime_path")
  if [[ -f "$gateway_pi_dir/models.json" ]]; then
    COMPUTER_ENV+=("PI_CODING_AGENT_DIR=$gateway_pi_dir")
  fi
  RESOLVED_PI_BIN=""
  if [[ -x "$HOME/.local/bin/pi" ]]; then
    RESOLVED_PI_BIN="$HOME/.local/bin/pi"
  else
    RESOLVED_PI_BIN="$(PATH="$runtime_path" command -v pi 2>/dev/null || true)"
  fi
  RESOLVED_GATEWAY_PI_DIR="$gateway_pi_dir"
}

run_connect_step() {
  local downloader_file="$WORK_DIR/install-linger-computer.sh"
  printf '  Downloading Linger Computer installer from %s...\n' "$WEB_URL"
  curl -fsSL "$WEB_URL/install/linger-computer.sh" -o "$downloader_file" ||
    die "Failed to download the Linger Computer installer from $WEB_URL."
  grep -Fq '# linger-computer-launcher-v2' "$downloader_file" ||
    die "$WEB_URL did not return a valid Linger Computer installer."

  LINGER_WEB_URL="$WEB_URL" bash "$downloader_file" ||
    die "Linger Computer installation failed."

  local env_name
  env_name="$(computer_environment_name "$WEB_URL")"
  local bin_dir="${LINGER_COMPUTER_BIN_DIR:-$HOME/.local/bin}"
  local computer_cli="$bin_dir/linger-computer-$env_name"
  [[ -x "$computer_cli" ]] || die "Expected command was not installed: $computer_cli"

  resolve_computer_env

  local auth_json=""
  auth_json="$("$computer_cli" auth status --json 2>/dev/null || true)"
  if printf '%s' "$auth_json" | grep -Eq '"authorized"[[:space:]]*:[[:space:]]*true'; then
    printf '  This computer is already linked to %s; restarting background daemon...\n' "$WEB_URL"
    env "${COMPUTER_ENV[@]+"${COMPUTER_ENV[@]}"}" "$computer_cli" daemon restart ||
      die "Failed to restart linger-computer-$env_name."
  else
    printf '  Sign in to link this computer to Linger (%s)...\n' "$WEB_URL"
    if [[ -n "$RESOLVED_PI_BIN" ]]; then
      env "${COMPUTER_ENV[@]+"${COMPUTER_ENV[@]}"}" "$computer_cli" login --web-url "$WEB_URL" --pi-path "$RESOLVED_PI_BIN" ||
        die "Could not sign in linger-computer-$env_name."
    else
      env "${COMPUTER_ENV[@]+"${COMPUTER_ENV[@]}"}" "$computer_cli" login --web-url "$WEB_URL" ||
        die "Could not sign in linger-computer-$env_name."
    fi
  fi

  if [[ -f "$RESOLVED_GATEWAY_PI_DIR/models.json" ]]; then
    printf '  Verifying Pi local model connection...\n'
    if [[ -n "$RESOLVED_PI_BIN" ]]; then
      env "${COMPUTER_ENV[@]+"${COMPUTER_ENV[@]}"}" "$computer_cli" runtime check pi --live --pi-path "$RESOLVED_PI_BIN" ||
        die "Pi local model verification failed."
    else
      env "${COMPUTER_ENV[@]+"${COMPUTER_ENV[@]}"}" "$computer_cli" runtime check pi --live ||
        die "Pi local model verification failed."
    fi
  fi

  printf '\nDone.\n'
  printf '  Linger server: %s\n' "$WEB_URL"
  printf '  Computer CLI:  linger-computer-%s\n' "$env_name"
  if [[ ":${PATH}:" != *":${bin_dir}:"* ]]; then
    printf '  Note: add %s to PATH if you want to invoke linger-computer-%s directly.\n' "$bin_dir" "$env_name"
  fi
  printf '  Day-2 commands: ./install.sh --status | ./install.sh --up | ./install.sh --remove\n'
}

step_check_server() {
  printf '\n[1/4] Checking Linger server\n'
  WEB_URL="$(default_web_url)"
  if probe_linger_origin "$WEB_URL"; then
    CONNECT_LINGER=1
    printf '  Found Linger server at %s\n' "$WEB_URL"
    return 0
  fi

  printf '  Could not reach a Linger server at %s.\n' "$WEB_URL"
  if compose_available; then
    printf '  Choose how to proceed:\n'
    printf '    1) Start Linger on this computer with Docker Compose (recommended)\n'
    printf '    2) Enter the URL of an existing Linger server\n'
    printf '    3) Install local models only (connect to Linger later)\n'
    prompt_line "  Choice [1-3] (default: 1): "
    case "${PROMPT_VALUE:-1}" in
      1)
        start_compose_server
        CONNECT_LINGER=1
        ;;
      2)
        prompt_custom_url
        ;;
      3)
        CONNECT_LINGER=0
        printf '  Continuing with local models only.\n'
        ;;
      *)
        die "Invalid choice: $PROMPT_VALUE"
        ;;
    esac
  else
    printf '  Choose how to proceed:\n'
    printf '    1) Enter the URL of an existing Linger server\n'
    printf '    2) Install local models only (connect to Linger later)\n'
    prompt_line "  Choice [1-2] (default: 1): "
    case "${PROMPT_VALUE:-1}" in
      1)
        prompt_custom_url
        ;;
      2)
        CONNECT_LINGER=0
        printf '  Continuing with local models only.\n'
        ;;
      *)
        die "Invalid choice: $PROMPT_VALUE"
        ;;
    esac
  fi
}

step_check_hardware_and_options() {
  printf '\n[2/4] Checking hardware and model options\n'
  printf '  Preparing local model installer...\n'
  ensure_engine

  MODEL_ACTION="plan"
  HAS_ACCEPTED_STACK=0
  PLAN_ARGS=()

  set +e
  sh "$STACK_SCRIPT" status --json > "$WORK_DIR/status.json" 2>"$WORK_DIR/status.err"
  local status_rc=$?
  set -e

  if (( status_rc == 0 )) && [[ -s "$WORK_DIR/status.json" ]]; then
    local existing_info=""
    existing_info="$("$KIT_PYTHON" -I -B -c '
import json, sys
try:
    doc = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(0)
last_run = doc.get("last_run")
if isinstance(last_run, dict) and last_run.get("ok") is True:
    deps = doc.get("deployments") or []
    names = ", ".join(str(d.get("name", "")) for d in deps if isinstance(d, dict) and d.get("name")) or "local model stack"
    print(names)
' "$WORK_DIR/status.json" 2>/dev/null || true)"
    if [[ -n "$existing_info" ]]; then
      printf '  An installed local model stack is already present (%s).\n' "$existing_info"
      printf '    1) Use existing local model setup and ensure it is running (recommended)\n'
      printf '    2) Plan and install an updated model configuration\n'
      prompt_line "  Choice [1-2] (default: 1): "
      case "${PROMPT_VALUE:-1}" in
        1)
          MODEL_ACTION="reuse"
          return 0
          ;;
        2)
          MODEL_ACTION="plan"
          HAS_ACCEPTED_STACK=1
          ;;
        *)
          die "Invalid choice: $PROMPT_VALUE"
          ;;
      esac
    fi
  fi

  set +e
  sh "$STACK_SCRIPT" hardware --json > "$WORK_DIR/hardware.json" 2>"$WORK_DIR/hardware.err"
  local hw_rc=$?
  set -e
  if (( hw_rc != 0 )); then
    if [[ -s "$WORK_DIR/hardware.err" ]]; then
      sanitize_engine_stream < "$WORK_DIR/hardware.err" >&2
    fi
    die "Hardware inspection failed."
  fi

  "$KIT_PYTHON" -I -B -c '
import json, sys

doc = json.load(open(sys.argv[1], encoding="utf-8"))
picks_out = sys.argv[2]

def gib(b):
    if b is None:
        return "unknown"
    return f"{int(b) / (1024 ** 3):.1f} GiB"

system = doc.get("system") or "unknown"
arch = doc.get("arch") or ""
ram_avail = gib(doc.get("ram_available_bytes"))
ram_total = gib(doc.get("ram_total_bytes"))
disk_free = gib(doc.get("disk_free_bytes"))
print(f"  Host: {system} ({arch}) · RAM: {ram_avail} free / {ram_total} total · Disk: {disk_free} free")

cards = doc.get("cards") or []
if cards:
    for c in cards:
        held = c.get("held_by") or []
        state = "processes running" if (held or not c.get("auto")) else "available"
        idx = c.get("index", 0)
        cname = c.get("name") or "GPU"
        cfree = gib(c.get("free_bytes"))
        ctot = gib(c.get("total_bytes"))
        print(f"  GPU {idx}: {cname} ({cfree} free / {ctot} total, {state})")
else:
    print("  GPU: none detected")

problem = doc.get("planning_problem")
if problem:
    print(f"  Note: {problem}")

with open(picks_out, "w", encoding="utf-8") as fh:
    for p in doc.get("picks") or []:
        tok_s = float(p.get("decode_tok_s") or 0)
        card = p.get("card")
        fields = [
            str(p.get("role") or ""),
            str(p.get("id") or ""),
            str(p.get("quant") or ""),
            str(p.get("quality") or 0),
            f"{tok_s:.0f}",
            "measured" if p.get("decode_basis") == "measured-decode" else "estimated",
            str(card if card is not None else 0),
            "1" if p.get("shared") else "0",
        ]
        fh.write("\t".join(fields) + "\n")
' "$WORK_DIR/hardware.json" "$WORK_DIR/picks.tsv"

  local pick_roles=()
  local pick_ids=()
  local pick_quants=()
  local pick_scores=()
  local pick_speeds=()
  local pick_bases=()
  local pick_cards=()
  local pick_shared=()
  while IFS=$'\t' read -r p_role p_id p_quant p_score p_speed p_basis p_card p_shared; do
    [[ -n "$p_id" ]] || continue
    pick_roles+=("$p_role")
    pick_ids+=("$p_id")
    pick_quants+=("$p_quant")
    pick_scores+=("$p_score")
    pick_speeds+=("$p_speed")
    pick_bases+=("$p_basis")
    pick_cards+=("$p_card")
    pick_shared+=("$p_shared")
  done < "$WORK_DIR/picks.tsv"

  local count="${#pick_ids[@]}"
  if (( count == 0 )); then
    die "No supported local model fits the currently available memory and disk."
  fi

  local chosen_idx=0
  if (( count >= 2 )); then
    printf '\n  Available model options:\n'
    local i=0
    while (( i < count )); do
      local label_role="${pick_roles[$i]}"
      if [[ "$label_role" == "smartest" ]]; then
        label_role="Smartest (recommended)"
      elif [[ "$label_role" == "fastest" ]]; then
        label_role="Fastest"
      fi
      printf '    %d) %s (%s) — %s, score %s, %s tok/s (%s)\n' \
        "$((i + 1))" "${pick_ids[$i]}" "${pick_quants[$i]}" "$label_role" \
        "${pick_scores[$i]}" "${pick_speeds[$i]}" "${pick_bases[$i]}"
      i=$((i + 1))
    done
    prompt_line "  Choose a model [1-$count] (default: 1): "
    local sel="${PROMPT_VALUE:-1}"
    if [[ ! "$sel" =~ ^[0-9]+$ ]] || (( sel < 1 || sel > count )); then
      die "Invalid choice: $sel"
    fi
    chosen_idx=$((sel - 1))
  else
    printf '  Recommended model: %s (%s) — score %s, %s tok/s (%s)\n' \
      "${pick_ids[0]}" "${pick_quants[0]}" "${pick_scores[0]}" "${pick_speeds[0]}" "${pick_bases[0]}"
  fi

  local selected_role="${pick_roles[$chosen_idx]}"
  local selected_card="${pick_cards[$chosen_idx]}"
  local selected_shared="${pick_shared[$chosen_idx]}"
  if [[ -n "$selected_role" && "$selected_role" != "smartest" ]]; then
    PLAN_ARGS+=("--prefer" "$selected_role")
  fi

  if [[ "$selected_shared" == "1" ]]; then
    prompt_line "  GPU $selected_card already has running processes. Share GPU $selected_card? [Y/n]: "
    local share_ans=""
    share_ans="$(lowercase "$PROMPT_VALUE")"
    if [[ -n "$share_ans" && "$share_ans" != "y" && "$share_ans" != "yes" ]]; then
      printf '  Installation cancelled.\n'
      exit 0
    fi
    PLAN_ARGS+=("--gpu" "$selected_card" "--share-gpu")

    local gpu_mem_cap=""
    while :; do
      prompt_line "  Optional GPU memory limit for model sizing (e.g. 24G, Enter for auto): "
      gpu_mem_cap="$PROMPT_VALUE"
      if [[ -z "$gpu_mem_cap" ]]; then
        break
      fi
      if [[ "$gpu_mem_cap" =~ ^[0-9]+([.][0-9]+)?[KkMmGgTt]?$ ]]; then
        PLAN_ARGS+=("--gpu-memory" "$gpu_mem_cap")
        break
      fi
      printf '  Please enter a size like 24G or 16384M, or press Enter for automatic sizing.\n'
    done
  fi

  prompt_line "  Also install optional routing, embedding, and reranker helper models? [y/N]: "
  local helpers_ans=""
  helpers_ans="$(lowercase "$PROMPT_VALUE")"
  if [[ "$helpers_ans" == "y" || "$helpers_ans" == "yes" ]]; then
    PLAN_ARGS+=("--decision" "auto" "--aux" "embedding,reranker")
  fi

  if (( HAS_ACCEPTED_STACK == 1 )); then
    PLAN_ARGS+=("--update")
  fi
}

step_install_and_verify_model() {
  printf '\n[3/4] Installing and verifying the local model\n'
  if [[ "$MODEL_ACTION" == "reuse" ]]; then
    printf '  Starting existing local model services...\n'
    local up_rc=0
    if run_sanitized_live sh "$STACK_SCRIPT" up; then
      return 0
    else
      up_rc=$?
    fi
    prompt_line "  Retry starting while sharing GPU with other running processes? [Y/n]: "
    local retry_ans=""
    retry_ans="$(lowercase "$PROMPT_VALUE")"
    if [[ -z "$retry_ans" || "$retry_ans" == "y" || "$retry_ans" == "yes" ]]; then
      run_sanitized_live sh "$STACK_SCRIPT" up --share-gpu || die "Could not start the installed local model stack."
      return 0
    fi
    exit "$up_rc"
  fi

  printf '  Preparing installation plan...\n'
  set +e
  sh "$STACK_SCRIPT" plan "${PLAN_ARGS[@]+"${PLAN_ARGS[@]}"}" --out "$WORK_DIR/plan.json" --json > /dev/null 2>"$WORK_DIR/plan.err"
  local plan_rc=$?
  set -e
  if (( plan_rc != 0 )); then
    if [[ -s "$WORK_DIR/plan.err" ]]; then
      sanitize_engine_stream < "$WORK_DIR/plan.err" >&2
    fi
    die "Could not create a local model installation plan."
  fi

  "$KIT_PYTHON" -I -B -c '
import json, sys

plan = json.load(open(sys.argv[1], encoding="utf-8"))
meta_out = sys.argv[2]

def gib(b):
    if b is None:
        return "0.0 GiB"
    return f"{int(b) / (1024 ** 3):.1f} GiB"

llm = plan.get("llm") or {}
model = llm.get("model") or {}
placement = llm.get("placement") or {}
launch = llm.get("launch") or {}
window = int(launch.get("window") or 0)
win_label = f"{window // 1024}K" if window >= 1024 else str(window)
mname = model.get("display_name") or model.get("id") or "unknown"
mquant = model.get("quant") or ""
plabel = placement.get("label") or ""

print("\n  Plan summary:")
print(f"    Model:     {mname} ({mquant}), {plabel}, context {win_label}")

helpers = []
dec = plan.get("decision")
if isinstance(dec, dict):
    dm = dec.get("model") or {}
    dname = dm.get("display_name") or dm.get("id") or "auto"
    helpers.append(f"routing ({dname})")
for part in plan.get("aux") or []:
    if isinstance(part, dict):
        contract = (part.get("endpoint") or {}).get("contract") or part.get("name") or "helper"
        pm = part.get("model") or {}
        pname = pm.get("display_name") or pm.get("id") or ""
        helpers.append(f"{contract} ({pname})")
if helpers:
    print("    Helpers:   " + ", ".join(helpers))

budget = plan.get("budget") or {}
dl_s = gib(budget.get("download_bytes"))
disk_s = gib(budget.get("disk_needed_bytes"))
ram_need = gib(budget.get("ram_needed_bytes"))
ram_avail = gib(budget.get("ram_available_bytes"))
print(f"    Resources: download {dl_s}, disk {disk_s}, RAM {ram_need} / {ram_avail} available")

preflight = plan.get("preflight") or {}
findings = preflight.get("findings") or []
for item in findings:
    if not isinstance(item, dict):
        continue
    level = item.get("level")
    if level in ("warn", "fail"):
        tag = "Warning" if level == "warn" else "Check failed"
        detail = item.get("detail") or ""
        fix = item.get("fix") or ""
        print(f"    {tag}: {detail}")
        if fix:
            print(f"      Fix: {fix}")

counts = preflight.get("counts") or {}
fail_count = int(counts.get("fail") or 0)
plan_id = plan.get("plan_id") or ""
with open(meta_out, "w", encoding="utf-8") as fh:
    fh.write(f"{plan_id}\t{fail_count}\n")
' "$WORK_DIR/plan.json" "$WORK_DIR/plan_meta.tsv" | sanitize_engine_stream

  local plan_id=""
  local fail_count="0"
  IFS=$'\t' read -r plan_id fail_count < "$WORK_DIR/plan_meta.tsv"
  [[ -n "$plan_id" ]] || die "Generated plan did not include a plan identifier."
  if (( fail_count > 0 )); then
    die "Preflight checks failed; fix the issues above and rerun ./install.sh."
  fi

  prompt_line "  Approve download and installation? [y/N]: "
  local approve=""
  approve="$(lowercase "$PROMPT_VALUE")"
  if [[ "$approve" != "y" && "$approve" != "yes" ]]; then
    printf '  Installation cancelled. Nothing was downloaded or changed.\n'
    exit 0
  fi

  sh "$STACK_SCRIPT" apply "$WORK_DIR/plan.json" --approve "$plan_id" ||
    die "Local model installation did not finish; fix the issue above and rerun ./install.sh."
}

step_connect_linger() {
  printf '\n[4/4] Connecting this computer to Linger\n'
  if (( CONNECT_LINGER == 0 )); then
    printf '  Local model is ready. When your Linger server is running, connect with:\n'
    printf '    ./install.sh --connect --web-url http://localhost:3000\n'
    return 0
  fi
  run_connect_step
}

run_connect_mode() {
  check_supported_platform
  WEB_URL="$(default_web_url)"
  if ! probe_linger_origin "$WEB_URL"; then
    printf 'Could not reach a Linger server at %s.\n' "$WEB_URL"
    prompt_custom_url
    if (( CONNECT_LINGER == 0 )); then
      return 0
    fi
  fi
  run_connect_step
}

run_up_mode() {
  ensure_engine
  local up_rc=0
  if run_sanitized_live sh "$STACK_SCRIPT" up; then
    :
  else
    up_rc=$?
    exit "$up_rc"
  fi

  local candidate_url=""
  candidate_url="$(default_web_url)"
  local env_name
  env_name="$(computer_environment_name "$candidate_url")"
  local bin_dir="${LINGER_COMPUTER_BIN_DIR:-$HOME/.local/bin}"
  local computer_cli="$bin_dir/linger-computer-$env_name"
  if [[ -x "$computer_cli" ]]; then
    local auth_json=""
    auth_json="$("$computer_cli" auth status --json 2>/dev/null || true)"
    if printf '%s' "$auth_json" | grep -Eq '"authorized"[[:space:]]*:[[:space:]]*true'; then
      resolve_computer_env
      env "${COMPUTER_ENV[@]+"${COMPUTER_ENV[@]}"}" "$computer_cli" daemon restart ||
        die "Failed to restart linger-computer-$env_name."
    fi
  fi
}

run_status_mode() {
  ensure_engine
  local status_out=""
  local status_rc=0
  set +e
  status_out="$(sh "$STACK_SCRIPT" status 2>&1)"
  status_rc=$?
  set -e
  if [[ -n "$status_out" ]]; then
    printf '%s\n' "$status_out" | sanitize_engine_stream
  fi

  local candidate_url=""
  candidate_url="$(default_web_url)"
  local env_name
  env_name="$(computer_environment_name "$candidate_url")"
  local bin_dir="${LINGER_COMPUTER_BIN_DIR:-$HOME/.local/bin}"
  local computer_cli="$bin_dir/linger-computer-$env_name"
  if [[ -x "$computer_cli" ]]; then
    printf '\nComputer (%s):\n' "linger-computer-$env_name"
    "$computer_cli" daemon status || true
  fi
  exit "$status_rc"
}

run_remove_mode() {
  ensure_engine
  local remove_out=""
  local remove_rc=0
  if (( PURGE == 1 && YES == 0 )); then
    set +e
    remove_out="$(sh "$STACK_SCRIPT" remove --purge --dry-run 2>&1)"
    remove_rc=$?
    set -e
    if [[ -n "$remove_out" ]]; then
      printf '%s\n' "$remove_out" | sanitize_engine_stream
    fi
    if (( remove_rc != 0 )); then
      exit "$remove_rc"
    fi
    prompt_line "Delete all downloaded model files and archives listed above? [y/N]: "
    local confirm_purge=""
    confirm_purge="$(lowercase "$PROMPT_VALUE")"
    if [[ "$confirm_purge" != "y" && "$confirm_purge" != "yes" ]]; then
      printf 'Nothing deleted.\n'
      return 0
    fi
    set +e
    remove_out="$(sh "$STACK_SCRIPT" remove --purge --yes 2>&1)"
    remove_rc=$?
    set -e
  elif (( PURGE == 1 )); then
    set +e
    remove_out="$(sh "$STACK_SCRIPT" remove --purge --yes 2>&1)"
    remove_rc=$?
    set -e
  else
    set +e
    remove_out="$(sh "$STACK_SCRIPT" remove 2>&1)"
    remove_rc=$?
    set -e
  fi

  if [[ -n "$remove_out" ]]; then
    printf '%s\n' "$remove_out" | sanitize_engine_stream
  fi
  exit "$remove_rc"
}

set_mode() {
  local requested="$1"
  if [[ "$MODE" != "guide" && "$MODE" != "$requested" ]]; then
    die "Options --$MODE and --$requested cannot be combined."
  fi
  MODE="$requested"
}

while (( $# > 0 )); do
  case "$1" in
    --web-url)
      (( $# >= 2 )) || die "--web-url requires an origin URL."
      EXPLICIT_WEB_URL="$2"
      shift 2
      ;;
    --web-url=*)
      EXPLICIT_WEB_URL="${1#--web-url=}"
      shift
      ;;
    --connect)
      set_mode "connect"
      shift
      ;;
    --up)
      set_mode "up"
      shift
      ;;
    --status)
      set_mode "status"
      shift
      ;;
    --remove)
      set_mode "remove"
      shift
      ;;
    --purge)
      PURGE=1
      shift
      ;;
    --yes)
      YES=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1 (run ./install.sh --help for usage)."
      ;;
  esac
done

case "$MODE" in
  connect) run_connect_mode ;;
  up) run_up_mode ;;
  status) run_status_mode ;;
  remove) run_remove_mode ;;
  guide)
    step_check_server
    step_check_hardware_and_options
    step_install_and_verify_model
    step_connect_linger
    ;;
esac
