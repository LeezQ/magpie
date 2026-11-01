#!/usr/bin/env bash
#
# =============================================================================
# StallionX 一键配置脚本（macOS / Linux）
# =============================================================================
# 功能：
#   0. 在终端内完成账号注册 / 登录，并自动开通一把可用的 API Key
#   1. 配置 Claude Code 使用 StallionX 第三方 API
#      - 修改 ~/.claude/settings.json 的 env 块
#        (ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN)
#      - 固定走 Anthropic 原生协议：ANTHROPIC_BASE_URL 写站点根地址，
#        由 Claude Code 自行请求 <根地址>/v1/messages。不走 OpenAI 兼容那条路，
#        因为只有原生链路能把 cache_control 标注和 anthropic-beta 头原样带到上游
#   2. 配置 Codex CLI 使用 StallionX 第三方 API
#      - 写入 ~/.codex/config.toml 的 model_providers 配置
#      - 按 /v1/models 为每个模型生成 ~/.codex/<名称>.config.toml profile，供 codex -p 切换
#      - 写入 ~/.codex/auth.json
#      - 将凭据写入仅当前用户可读的 Codex 配置，并同步持久化环境变量
#   3. 配置 pi（pi coding agent）使用 StallionX 第三方 API
#      - 合并写入 ~/.pi/agent/models.json 的 providers 段，保留用户已有的其他 provider
#      - 按 /v1/models 生成模型清单：Claude 模型走 Anthropic 原生协议（根地址），
#        GPT-5 / o 系列 / codex 模型走 Responses，其余走 Chat Completions
#
# 使用方式：
#   bash install.sh                  # 交互式：登录 / 注册 / 手动粘贴 Key
#   bash install.sh --register       # 注册新账号并自动获取 API Key
#   bash install.sh --login          # 登录已有账号并自动获取 API Key
#   bash install.sh --key <API_KEY>  # 非交互式：直接指定 API Key（适合脚本调用）
#   bash install.sh --targets codex,claude,pi  # 指定要配置的客户端；默认 codex
#   bash install.sh --force          # 备份后强制覆盖 Codex config.toml
#   bash install.sh --show           # 只查看当前已配置的 Key（掩码显示），不做修改
#   bash install.sh --help           # 查看帮助
#
# 新用户可以完全不打开网页后台：脚本内完成注册（邮箱验证码）、开通令牌和写入配置。
# API 地址在交互模式下可确认或改写（服务可能部署在多个站点），回车即用默认值。
# 新建令牌绑定的渠道分组同样可在交互模式下勾选，回车沿用账号默认分组；也可用
# --channel-groups 非交互指定。通过管道执行（curl -fsSL ... | bash）时，所有交互
# 输入都从 /dev/tty 读取。
#
# 修改 API Key：
#   重新执行本脚本即可。脚本会自动检测已有配置并以掩码形式展示当前 Key，
#   输入新 Key 覆盖；直接回车则保留当前 Key（用于修复配置不同步的情况）。
#
# 说明：
#   - 脚本可重复执行，重复执行会覆盖上一次写入的 StallionX 相关配置
#   - 普通模式保留 ~/.codex/config.toml 中用户自定义的 model 与其他配置
#   - --force 会先备份旧 config.toml，再用 StallionX 配置完整覆盖
#   - 交互执行且检测到旧 config.toml 时会询问是否强制覆盖，默认选择“否”
#   - 每次执行都会按 StallionX /v1/models 刷新 Codex 模型目录与 profiles；
#     重启 Codex 后，模型会出现在客户端模型选择器中
# =============================================================================

set -euo pipefail

# ----------------------------- 基础常量定义 ----------------------------------

# Provider 名称与 API 地址（如需更换服务商，只需要改这里）
PROVIDER_NAME="StallionX"
PROVIDER_ID="stallionx"                       # Codex 配置中使用的 provider id（小写）
BASE_URL="https://x.stallion-api.com"         # 基础地址（不带末尾斜杠）
CODEX_BASE_URL="${BASE_URL}/v1"               # Codex 走 OpenAI 兼容协议，需要 /v1 路径
# Claude Code 走 Anthropic 原生协议：客户端自己在 base 后面拼 /v1/messages，
# 所以这里必须是站点根地址。只有这条原生链路才能把 cache_control 标注和
# anthropic-beta 请求头原样送到上游；换成 OpenAI 兼容地址会被格式转换吃掉。
ANTHROPIC_BASE_URL="${BASE_URL}"              # Claude Code 走 Anthropic 原生协议，用站点根地址
ENV_KEY_NAME="STALLIONX_API_KEY"              # 为终端及其他兼容工具保留的环境变量名
DEFAULT_CODEX_MODEL="gpt-5.6-sol"             # 首次安装时写入的默认模型

# 相关配置文件路径
CLAUDE_SETTINGS="${HOME}/.claude/settings.json"
CODEBUDDY_MODELS_FILE="${HOME}/.codebuddy/models.json"
WORKBUDDY_MODELS_FILE="${HOME}/.workbuddy/models.json"
TRAE_CONFIG_DIR="${HOME}/.stallionx/trae"
TRAE_MODELS_FILE="${TRAE_CONFIG_DIR}/models.json"
TRAE_GUIDE_FILE="${TRAE_CONFIG_DIR}/README.md"
CODEX_DIR="${HOME}/.codex"
CODEX_CONFIG="${CODEX_DIR}/config.toml"
CODEX_AUTH="${CODEX_DIR}/auth.json"
CODEX_MODEL_CATALOG="${CODEX_DIR}/stallionx-models.json"
# pi（pi coding agent）的自定义 provider 配置：一个文件里可以并存多个 provider，
# 脚本只接管自己这两个 provider id，其余原样保留。
PI_CONFIG_DIR="${HOME}/.pi/agent"
PI_MODELS_FILE="${PI_CONFIG_DIR}/models.json"
PI_PROVIDER_ID="${PROVIDER_ID}"                      # OpenAI 兼容 provider（chat / responses）
PI_ANTHROPIC_PROVIDER_ID="${PROVIDER_ID}-anthropic"  # Claude 模型专用 provider（Anthropic 原生协议）

# 平台登录令牌的本地缓存位置（仅缓存 JWT，不缓存密码）
CREDENTIAL_DIR="${HOME}/.stallionx"
CREDENTIAL_FILE="${CREDENTIAL_DIR}/credentials.json"

# 生成时间戳（写入 config.toml 头部注释，标记配置由本脚本何时生成）

# 环境变量配置块的成对标记（用于在 shell 配置文件中定位/替换旧配置）
MARK_BEGIN="# >>> ${PROVIDER_NAME} API 配置 >>>"
MARK_END="# <<< ${PROVIDER_NAME} API 配置 <<<"

# 根据用户当前使用的 shell 选择对应的配置文件
case "${SHELL:-}" in
  */zsh)  PROFILE_FILE="${HOME}/.zshrc" ;;
  */bash) PROFILE_FILE="${HOME}/.bashrc" ;;
  *)      PROFILE_FILE="${HOME}/.profile" ;;
esac

# ----------------------------- 工具函数 --------------------------------------

# 打印带颜色的信息，便于用户区分普通日志 / 成功 / 警告 / 错误
info()  { printf '\033[36m[信息]\033[0m %s\n' "$1"; }
ok()    { printf '\033[32m[成功]\033[0m %s\n' "$1"; }
warn()  { printf '\033[33m[警告]\033[0m %s\n' "$1" >&2; }
error() { printf '\033[31m[错误]\033[0m %s\n' "$1" >&2; }

# 打印使用帮助
usage() {
  cat <<USAGE
${PROVIDER_NAME} 一键配置脚本

用法：
  bash install.sh                  交互式配置：选择登录 / 注册 / 手动粘贴 Key，全程在终端完成
  bash install.sh --login          登录已有账号并自动获取 API Key
  bash install.sh --register       注册新账号并自动获取 API Key
  bash install.sh --manual-key     手动粘贴已有的 API Key（旧版行为）
  bash install.sh --key <API_KEY>  非交互式指定 API Key（适合自动化脚本）
  bash install.sh --targets <列表> 指定客户端，支持 codex、claude、codebuddy、workbuddy、trae、pi（逗号分隔）
  bash install.sh --force          备份后强制覆盖 Codex config.toml
  bash install.sh --show           仅查看当前已配置的 Key（掩码），不做任何修改
  bash install.sh --logout         清除本机缓存的登录状态
  bash install.sh --help           显示本帮助

账号相关参数：
  --username <账号>    登录账号（用户名或邮箱）；注册时作为用户名
  --email <邮箱>       注册使用的邮箱，用于接收验证码
  --invite-code <码>   注册时绑定推荐人
  --token-name <名称>  自定义生成的令牌名称，默认「CLI 一键配置」
  --channel-groups <编码> 新建令牌要绑定的渠道分组编码，逗号分隔（如 reverse-won,official）；
                       交互终端下不传会弹出勾选列表，默认勾选账号的默认分组；
                       非交互环境不传则只绑定默认分组
  --base-url <地址>    指定服务地址；不传时交互模式会询问（默认 ${BASE_URL}，
                       本机已配置过则默认沿用上次使用的地址）
  --force              仅影响 Codex：先备份 config.toml，再完整覆盖旧配置；
                       用于清除冲突的 provider、模型目录、MCP 或其他本地覆盖项；
                       交互执行检测到旧配置时会主动询问，直接回车默认选择否

  密码只通过环境变量 STALLIONX_PASSWORD 传入，不提供命令行参数，
  避免密码进入 shell 历史记录与 ps 输出。完全非交互的示例：
    STALLIONX_PASSWORD='你的密码' bash install.sh --login --username alice --targets codex

  登录成功后会在 ${CREDENTIAL_FILE} 缓存登录令牌（权限 600，24 小时有效），
  期间重复执行脚本无需再次输入密码。

修改 API Key：
  直接重新执行本脚本，选择客户端后输入新的 Key 即可。只会更新所选客户端：
    - Claude Code：${CLAUDE_SETTINGS}
    - CodeBuddy：  ${CODEBUDDY_MODELS_FILE}
    - WorkBuddy：  ${WORKBUDDY_MODELS_FILE}
    - Trae：       ${TRAE_MODELS_FILE}、${TRAE_GUIDE_FILE}
    - pi：         ${PI_MODELS_FILE}（仅 providers.${PI_PROVIDER_ID} 与 providers.${PI_ANTHROPIC_PROVIDER_ID} 两段）
    - Codex：      ${CODEX_CONFIG}、${CODEX_MODEL_CATALOG}、${CODEX_DIR}/<名称>.config.toml、${CODEX_AUTH}、${PROFILE_FILE}
USAGE
}

# 判断某个客户端是否包含在规范化后的逗号分隔列表中。
is_target_selected() {
  case ",${TARGETS}," in
    *,"$1",*) return 0 ;;
    *) return 1 ;;
  esac
}

# 规范化并校验客户端列表；同时兼容用户常见的 trae / trea 拼写。
normalize_targets() {
  local raw="$1" item normalized="" old_ifs="${IFS}"
  IFS=','
  for item in ${raw}; do
    item="$(printf '%s' "${item}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    [ "${item}" = "trea" ] && item="trae"
    case "${item}" in
      codex|claude|codebuddy|workbuddy|trae|pi)
        case ",${normalized}," in
          *,"${item}",*) ;;
          *) normalized="${normalized:+${normalized},}${item}" ;;
        esac
        ;;
      qoder)
        error "Qoder 暂未提供可验证的第三方 API 配置入口，当前脚本不会写入无效配置。"
        IFS="${old_ifs}"
        return 1
        ;;
      "") ;;
      *)
        error "不支持的客户端：${item}（支持 codex、claude、codebuddy、workbuddy、trae、pi）"
        IFS="${old_ifs}"
        return 1
        ;;
    esac
  done
  IFS="${old_ifs}"
  [ -n "${normalized}" ] || normalized="codex"
  printf '%s' "${normalized}"
}

# 在支持交互的终端中绘制复选框选择器。
# 操作：↑/↓ 或 j/k 移动，空格勾选，Enter 确认；Codex 默认勾选。
select_targets_interactively() {
  local current=0 key sequence result="" index marker
  local labels=("Codex（默认）" "Claude Code" "CodeBuddy" "WorkBuddy" "Trae（生成模型配置清单）" "pi（pi coding agent）" "Qoder（暂不支持第三方 API 配置）")
  local values=("codex" "claude" "codebuddy" "workbuddy" "trae" "pi" "qoder")
  local checked=(1 0 0 0 0 0 0)
  local enabled=(1 1 1 1 1 1 0)
  local count=${#labels[@]}

  # 正常结束或异常退出时都恢复光标。SIGINT/SIGTERM 必须在恢复终端状态后
  # 继续退出；如果只处理信号而不退出，Ctrl+C 会被吞掉并导致选择器反复重绘。
  printf '\033[?25l' >&2
  trap 'printf "\033[?25h" >&2' EXIT
  trap 'printf "\033[?25h" >&2; trap - INT TERM EXIT; exit 130' INT
  trap 'printf "\033[?25h" >&2; trap - INT TERM EXIT; exit 143' TERM

  while true; do
    printf '\r请选择要配置的客户端（↑/↓ 移动，空格勾选，Enter 确认）：\n' >&2
    for ((index = 0; index < count; index++)); do
      if [ "${checked[index]}" -eq 1 ]; then
        marker="[x]"
      else
        marker="[ ]"
      fi
      if [ "${enabled[index]}" -eq 0 ]; then
        marker="[-]"
      fi
      if [ "${index}" -eq "${current}" ]; then
        printf '\033[36m> %s %s\033[0m\n' "${marker}" "${labels[index]}" >&2
      else
        printf '  %s %s\n' "${marker}" "${labels[index]}" >&2
      fi
    done

    prompt_key key
    case "${key}" in
      $'\x1b')
        # 方向键由 ESC、[、A/B 三个字符组成。
        prompt_key sequence 2
        case "${sequence}" in
          '[A') current=$((current - 1)) ;;
          '[B') current=$((current + 1)) ;;
        esac
        ;;
      k|K) current=$((current - 1)) ;;
      j|J) current=$((current + 1)) ;;
      ' ')
        if [ "${enabled[current]}" -eq 1 ]; then
          checked[current]=$((1 - checked[current]))
        else
          printf '\a' >&2
        fi
        ;;
      '') break ;;
    esac

    [ "${current}" -lt 0 ] && current=$((count - 1))
    [ "${current}" -ge "${count}" ] && current=0
    # 光标回到选择器顶部，下一轮直接覆盖原内容。
    printf '\033[%dA' "$((count + 1))" >&2
  done

  printf '\033[?25h' >&2
  trap - INT TERM EXIT
  for ((index = 0; index < count; index++)); do
    if [ "${enabled[index]}" -eq 1 ] && [ "${checked[index]}" -eq 1 ]; then
      result="${result:+${result},}${values[index]}"
    fi
  done
  printf '%s' "${result:-codex}"
}

# 掩码显示 API Key：保留首 4 位与末 4 位，中间用 * 代替，避免明文泄露
# 用法：mask_key "sk-abcdefg123456"  ->  sk-a****3456
mask_key() {
  local key="$1"
  local len=${#key}
  if [ "${len}" -le 8 ]; then
    # 过短的 Key 全部打码，防止泄露有效信息
    printf '%s' "********"
  else
    printf '%s****%s' "${key:0:4}" "${key: -4}"
  fi
}

# 从 shell 配置文件的标记块中读取已配置的 Key
read_key_from_profile() {
  [ -f "${PROFILE_FILE}" ] || return 1
  # 取标记块内的 export 行，去掉变量名与两侧引号
  local line
  line="$(awk -v begin="${MARK_BEGIN}" -v end="${MARK_END}" -v name="export ${ENV_KEY_NAME}=" '
    $0 == begin { inblock = 1; next }
    $0 == end   { inblock = 0; next }
    inblock && index($0, name) == 1 { print substr($0, length(name) + 1); exit }
  ' "${PROFILE_FILE}" 2>/dev/null || true)"
  [ -n "${line}" ] || return 1
  # 去掉包裹的双引号或单引号
  line="${line%\"}"; line="${line#\"}"
  line="${line%\'}"; line="${line#\'}"
  [ -n "${line}" ] || return 1
  printf '%s' "${line}"
}

# 从 JSON 文件中读取指定字段的值（这些文件均由本脚本生成，格式可控，用 sed 提取即可）
read_key_from_json() {
  local file="$1" field="$2" value
  [ -f "${file}" ] || return 1
  value="$(sed -n "s/.*\"${field}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "${file}" 2>/dev/null | head -n 1 || true)"
  [ -n "${value}" ] || return 1
  printf '%s' "${value}"
}

# 读取 pi models.json 中本脚本托管 provider 的 apiKey。
# 同一文件可能包含多个 provider，各自带 apiKey，不能像其他客户端那样按字段名粗提取，
# 必须定位到 providers.<PI_PROVIDER_ID>；缺 python3 时直接放弃探测。
read_pi_key() {
  [ -f "${PI_MODELS_FILE}" ] || return 1
  command -v python3 >/dev/null 2>&1 || return 1
  SX_PI_MODELS_FILE="${PI_MODELS_FILE}" SX_PI_PROVIDER_ID="${PI_PROVIDER_ID}" python3 - <<'PYEOF' 2>/dev/null
import json, os, sys
try:
    with open(os.environ["SX_PI_MODELS_FILE"], "r", encoding="utf-8") as source:
        config = json.load(source)
    provider = (config.get("providers") or {}).get(os.environ["SX_PI_PROVIDER_ID"]) or {}
    key = provider.get("apiKey")
    # 写入时会把 $ 转义成 $$（pi 的环境变量插值语法），读取时还原。
    if isinstance(key, str) and key.strip():
        sys.stdout.write(key.replace("$$", "$"))
    else:
        sys.exit(1)
except Exception:
    sys.exit(1)
PYEOF
}

# 综合探测当前已配置的 API Key（按可靠性排序：环境变量块 > Codex > Claude > CodeBuddy > WorkBuddy > Trae > pi）
detect_existing_key() {
  local key
  key="$(read_key_from_profile || true)"
  [ -n "${key}" ] && { printf '%s' "${key}"; return 0; }

  key="$(read_key_from_json "${CODEX_AUTH}" "OPENAI_API_KEY" || true)"
  [ -n "${key}" ] && { printf '%s' "${key}"; return 0; }

  key="$(read_key_from_json "${CLAUDE_SETTINGS}" "ANTHROPIC_AUTH_TOKEN" || true)"
  [ -n "${key}" ] && { printf '%s' "${key}"; return 0; }

  key="$(read_key_from_json "${CODEBUDDY_MODELS_FILE}" "apiKey" || true)"
  [ -n "${key}" ] && { printf '%s' "${key}"; return 0; }

  key="$(read_key_from_json "${WORKBUDDY_MODELS_FILE}" "apiKey" || true)"
  [ -n "${key}" ] && { printf '%s' "${key}"; return 0; }

  key="$(read_key_from_json "${TRAE_MODELS_FILE}" "api_key" || true)"
  [ -n "${key}" ] && { printf '%s' "${key}"; return 0; }

  key="$(read_pi_key || true)"
  [ -n "${key}" ] && { printf '%s' "${key}"; return 0; }

  return 1
}

# 探测本机已配置的 API 地址。
# 同一台机器可能先后接入过不同部署（自建、测试环境、备用域名），重复执行脚本时
# 把任意形态的站点地址削回站点根地址。
# Claude Code 请求时会自己拼 /v1/messages，Codex 则需要在根地址后补 /v1；
# 两者都要求配置里保存的是根地址。用户很容易把站点上展示的 OpenAI 兼容地址
# （.../v1、.../v1/chat/completions）或整条 .../v1/messages 直接粘进来，
# 不削掉就会拼出 /v1/v1/messages，或者把 Claude Code 引到 OpenAI 兼容那条路上——
# 那条路要做格式转换，cache_control 与 anthropic-beta 无法原样透传。
normalize_site_base_url() {
  local url="${1%/}"
  while true; do
    case "${url}" in
      */v1/messages) url="${url%/v1/messages}" ;;
      */v1/chat/completions) url="${url%/v1/chat/completions}" ;;
      */v1/responses) url="${url%/v1/responses}" ;;
      */v1) url="${url%/v1}" ;;
      *) break ;;
    esac
    url="${url%/}"
  done
  printf '%s' "${url}"
}

# 默认值应当沿用上次实际使用的地址，而不是回到脚本内置的默认站点。
# 优先级：登录缓存（最近一次真正登录过的站点）> Codex > Claude Code。
detect_existing_base_url() {
  local url=""

  if [ -f "${CREDENTIAL_FILE}" ]; then
    url="$(json_get "$(cat "${CREDENTIAL_FILE}" 2>/dev/null || true)" "base_url" || true)"
    if [ -n "${url}" ]; then
      normalize_site_base_url "${url}"
      return 0
    fi
  fi

  # Codex 配置里保存的是带 /v1 的地址，且同一份 config.toml 可能存在多个 provider，
  # 因此必须限定在本脚本管理的 provider 段内读取，再去掉 /v1 还原站点根地址。
  if [ -f "${CODEX_CONFIG}" ]; then
    url="$(awk -v section="[model_providers.${PROVIDER_ID}]" '
      $0 == section { inblock = 1; next }
      /^\[/ { inblock = 0 }
      inblock && $0 ~ /^[[:space:]]*base_url[[:space:]]*=/ {
        sub(/^[[:space:]]*base_url[[:space:]]*=[[:space:]]*/, "")
        gsub(/"/, "")
        gsub(/[[:space:]]/, "")
        print
        exit
      }
    ' "${CODEX_CONFIG}" 2>/dev/null || true)"
    if [ -n "${url}" ]; then
      normalize_site_base_url "${url}"
      return 0
    fi
  fi

  # Claude Code 里保存的本就是站点根地址，但旧版本或手工配置可能残留 /v1 后缀，
  # 这里同样归一化，避免把 OpenAI 兼容地址当成默认值再写回去。
  url="$(read_key_from_json "${CLAUDE_SETTINGS}" "ANTHROPIC_BASE_URL" || true)"
  if [ -n "${url}" ]; then
    normalize_site_base_url "${url}"
    return 0
  fi

  return 1
}

# 用户选择“其他”后读取自定义 API 地址。只有原配置本身就是自定义地址时才允许
# 直接回车沿用，避免用户主动选择“其他”后意外回落到固定站点。
prompt_custom_base_url() {
  local default_url="${1:-}" input="" prompt="请输入其他 API 地址"
  [ -n "${default_url}" ] && prompt="${prompt}（直接回车沿用 ${default_url}）"
  prompt="${prompt}："

  while true; do
    prompt_line input "${prompt}"
    input="$(printf '%s' "${input}" | tr -d '[:space:]')"

    if [ -z "${input}" ] && [ -n "${default_url}" ]; then
      normalize_site_base_url "${default_url}"
      return 0
    fi

    case "${input}" in
      http://*|https://*)
        normalize_site_base_url "${input}"
        return 0
        ;;
      *) error "地址必须以 http:// 或 https:// 开头，请重新输入。" ;;
    esac
  done
}

# API 地址使用单选菜单，避免用户手写常用域名时输错。已有配置命中固定站点时默认选中
# 对应项；已有自定义地址时默认选中“其他”，并允许直接回车沿用该地址。
select_base_url_interactively() {
  local default_url="${1%/}" current=0 key sequence index marker other_default=""
  local labels=(
    "https://x.stallion-api.com/"
    "https://x.stallion-api.run/"
    "https://token.openvi.com/"
    "其他（手动输入）"
  )
  local values=(
    "https://x.stallion-api.com"
    "https://x.stallion-api.run"
    "https://token.openvi.com"
    "__other__"
  )
  local count=${#labels[@]}

  case "${default_url}" in
    "${values[0]}") current=0 ;;
    "${values[1]}") current=1 ;;
    "${values[2]}") current=2 ;;
    "") current=0 ;;
    *)
      current=3
      other_default="${default_url}"
      labels[3]="其他（当前：${default_url}）"
      ;;
  esac

  printf '\033[?25l' >&2
  trap 'printf "\033[?25h" >&2' EXIT
  trap 'printf "\033[?25h" >&2; trap - INT TERM EXIT; exit 130' INT
  trap 'printf "\033[?25h" >&2; trap - INT TERM EXIT; exit 143' TERM

  while true; do
    printf '\r请选择 API 地址（↑/↓ 移动，Enter 确认）：\n' >&2
    for ((index = 0; index < count; index++)); do
      marker="( )"
      [ "${index}" -eq "${current}" ] && marker="(●)"
      if [ "${index}" -eq "${current}" ]; then
        printf '\033[36m> %s %s\033[0m\n' "${marker}" "${labels[index]}" >&2
      else
        printf '  %s %s\n' "${marker}" "${labels[index]}" >&2
      fi
    done

    prompt_key key
    case "${key}" in
      $'\x1b')
        prompt_key sequence 2
        case "${sequence}" in
          '[A') current=$((current - 1)) ;;
          '[B') current=$((current + 1)) ;;
        esac
        ;;
      k|K) current=$((current - 1)) ;;
      j|J) current=$((current + 1)) ;;
      '') break ;;
    esac

    [ "${current}" -lt 0 ] && current=$((count - 1))
    [ "${current}" -ge "${count}" ] && current=0
    printf '\033[%dA' "$((count + 1))" >&2
  done

  printf '\033[?25h' >&2
  trap - INT TERM EXIT
  if [ "${values[current]}" = "__other__" ]; then
    prompt_custom_base_url "${other_default}"
  else
    printf '%s' "${values[current]}"
  fi
}

# 读取 ~/.codex/config.toml 中已有的 model 字段，保留用户的自定义模型选择。
# 注意正则只匹配 model 而不匹配 model_provider（model 后必须紧跟空白或等号）。
detect_existing_model() {
  [ -f "${CODEX_CONFIG}" ] || return 1
  local value
  value="$(grep -E '^[[:space:]]*model[[:space:]]*=' "${CODEX_CONFIG}" 2>/dev/null | head -n 1 || true)"
  [ -n "${value}" ] || return 1
  value="$(printf '%s' "${value}" | sed -E 's/^[[:space:]]*model[[:space:]]*=[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/')"
  [ -n "${value}" ] || return 1
  printf '%s' "${value}"
}

# 读取用户已配置的模型目录。普通模式只在目录未配置或已指向本脚本管理文件时接管；
# 用户手写的其他目录保持不变，并提示使用 --force 明确覆盖。
detect_existing_model_catalog() {
  [ -f "${CODEX_CONFIG}" ] || return 1
  local value
  value="$(grep -E '^[[:space:]]*model_catalog_json[[:space:]]*=' "${CODEX_CONFIG}" 2>/dev/null | head -n 1 || true)"
  [ -n "${value}" ] || return 1
  value="$(printf '%s' "${value}" | sed -E 's/^[[:space:]]*model_catalog_json[[:space:]]*=[[:space:]]*"?([^"]*)"?[[:space:]]*$/\1/')"
  [ -n "${value}" ] || return 1
  printf '%s' "${value}"
}

is_managed_codex_catalog_path() {
  case "$1" in
    "${CODEX_MODEL_CATALOG}"|"~/.codex/stallionx-models.json") return 0 ;;
    *) return 1 ;;
  esac
}

# TOML 双引号字符串需要转义路径中的反斜杠与引号；常见 Unix 路径不受影响，
# Windows 兼容层或自定义 HOME 也不会因此生成无效配置。
toml_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# ---- Codex 模型目录与 profiles ---------------------------------------------
# Codex 不会自动用第三方 provider 的 GET /models 填充模型选择器。官方支持通过
# model_catalog_json 在启动时加载自定义目录，因此脚本生成独立的 StallionX 目录；
# profile 文件继续保留，兼容 `codex -p <名称>` 与旧版 Codex。
#
# profile 名称只允许字母、数字、连字符和下划线，而模型 ID 常含 "."（如 gpt-5.6-sol），
# 因此名称由模型 ID 把非法字符替换为 "-" 得到（gpt-5.6-sol -> gpt-5-6-sol）。
# 脚本生成的文件首行带有下面的标记，重复执行时只删除带标记的文件再重新生成；
# 用户自己写的 profile 文件（无标记）原样保留，同名时也不覆盖。标记前缀必须保持稳定，
# 否则旧版本脚本生成的文件会变成无人管理的孤儿。
CODEX_PROFILE_MARK_PREFIX="# managed-by: stallionx-install"
CODEX_PROFILE_MARK="${CODEX_PROFILE_MARK_PREFIX}（脚本按 StallionX /v1/models 自动生成，重复执行会刷新，请勿手改）"

# 请求 StallionX /v1/models，输出适合 Codex 使用的对话模型 ID（每行一个，已排序去重）。
# 图像、向量、语音等非对话模型会被过滤；ID 含异常字符时同样跳过。
fetch_codex_model_ids() {
  local response ids

  if ! command -v curl >/dev/null 2>&1; then
    warn "获取模型列表需要 curl，但当前环境未找到该命令；跳过 Codex profiles 生成。"
    return 1
  fi

  response="$(mktemp)"
  # 通过 stdin 传递鉴权头，避免 API Key 出现在 curl 的命令行参数中。
  if ! curl --fail --silent --show-error --location --max-time 20 \
    --config - --output "${response}" "${CODEX_BASE_URL}/models" <<CURLEOF
header = "Authorization: Bearer ${API_KEY}"
header = "Accept: application/json"
CURLEOF
  then
    error "获取 StallionX 模型列表失败，请检查网络、API Key 和服务状态。"
    rm -f "${response}"
    return 1
  fi

  # 优先用 python3 严格解析；精简系统没有 python3 时退化为按 "id" 字段粗提取。
  if command -v python3 >/dev/null 2>&1; then
    ids="$(SX_RESPONSE_PATH="${response}" python3 <<'PYEOF' 2>&1 || true
import json, os, sys
try:
    with open(os.environ["SX_RESPONSE_PATH"], "r", encoding="utf-8") as f:
        payload = json.load(f)
    data = payload.get("data", payload) if isinstance(payload, dict) else payload
    for item in data or []:
        model_id = item.get("id") if isinstance(item, dict) else None
        if isinstance(model_id, str) and model_id.strip():
            print(model_id.strip())
except Exception as error:  # noqa: BLE001
    print(f"[错误] 解析 /v1/models 响应失败: {error}", file=sys.stderr)
PYEOF
)"
  else
    ids="$(tr ',' '\n' < "${response}" \
      | grep -o '"id"[[:space:]]*:[[:space:]]*"[^"]*"' \
      | sed -E 's/.*"([^"]*)"[[:space:]]*$/\1/' || true)"
  fi
  rm -f "${response}"

  # 只保留对话模型，且 ID 字符集必须能安全写进 TOML 字符串。
  ids="$(printf '%s\n' "${ids}" \
    | grep -E '^[A-Za-z0-9._:/-]+$' \
    | grep -v -i -E 'image|embed|tts|whisper|audio|realtime|moderation' \
    | sort -u || true)"

  if [ -z "${ids}" ]; then
    error "StallionX /v1/models 未返回可用于 Codex 的对话模型。"
    return 1
  fi
  printf '%s\n' "${ids}"
}

# 按 /v1/models 返回的 ID 生成 Codex 原生模型目录。为保持不同 Codex 版本的字段兼容性，
# 优先复用当前客户端 `codex debug models` 输出的完整模型元数据；站点新增而本机目录没有的
# 模型则克隆当前客户端的一个有效模板，并替换身份字段。无法读取客户端目录时使用已通过
# Codex 解析器验证的最小兼容模板，确保首次安装也能生成选择器目录。
write_minimal_codex_model_catalog() {
  local model_ids="$1" output_path="$2" first=1 priority=1 model_id
  {
    printf '{\n  "models": [\n'
    while IFS= read -r model_id; do
      [ -n "${model_id}" ] || continue
      [ "${first}" -eq 0 ] && printf ',\n'
      first=0
      printf '    {\n'
      printf '      "slug": "%s",\n' "${model_id}"
      printf '      "display_name": "%s",\n' "${model_id}"
      printf '      "description": "Available through StallionX: %s.",\n' "${model_id}"
      printf '      "default_reasoning_level": "medium",\n'
      printf '      "supported_reasoning_levels": [\n'
      printf '        { "effort": "low", "description": "Fast responses with lighter reasoning" },\n'
      printf '        { "effort": "medium", "description": "Balanced reasoning for everyday tasks" },\n'
      printf '        { "effort": "high", "description": "Greater reasoning depth for complex tasks" },\n'
      printf '        { "effort": "xhigh", "description": "Extra reasoning depth for demanding tasks" }\n'
      printf '      ],\n'
      printf '      "shell_type": "shell_command",\n'
      printf '      "visibility": "list",\n'
      printf '      "supported_in_api": true,\n'
      printf '      "priority": %d,\n' "${priority}"
      printf '      "support_verbosity": true,\n'
      printf '      "truncation_policy": { "mode": "tokens", "limit": 10000 },\n'
      printf '      "experimental_supported_tools": [],\n'
      printf '      "base_instructions": "You are Codex, a coding agent. Follow system, developer, and user instructions while completing software engineering tasks."\n'
      printf '    }'
      priority=$((priority + 1))
    done <<MODELSEOF
${model_ids}
MODELSEOF
    printf '\n  ]\n}\n'
  } > "${output_path}"
  [ "${first}" -eq 0 ]
}

generate_codex_model_catalog() {
  local model_ids="$1" temp_file

  if ! command -v python3 >/dev/null 2>&1; then
    temp_file="$(mktemp "${CODEX_DIR}/stallionx-models.json.tmp.XXXXXX")"
    if ! write_minimal_codex_model_catalog "${model_ids}" "${temp_file}"; then
      error "生成 Codex 最小模型目录失败。"
      rm -f "${temp_file}"
      return 1
    fi
    mv "${temp_file}" "${CODEX_MODEL_CATALOG}"
    chmod 600 "${CODEX_MODEL_CATALOG}"
    return 0
  fi

  temp_file="$(mktemp "${CODEX_DIR}/stallionx-models.json.tmp.XXXXXX")"
  if ! SX_MODEL_IDS="${model_ids}" \
    SX_MODEL_CATALOG_OUTPUT="${temp_file}" \
    SX_CODEX_CACHE="${CODEX_DIR}/models_cache.json" \
    python3 <<'PYEOF'
import copy
import json
import os
import re
import shutil
import subprocess
import sys


def load_catalog():
    codex = shutil.which("codex")
    if codex:
        try:
            result = subprocess.run(
                [codex, "debug", "models"],
                check=True,
                capture_output=True,
                text=True,
                timeout=15,
            )
            payload = json.loads(result.stdout)
            if isinstance(payload, dict) and payload.get("models"):
                return payload
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
            pass

    cache_path = os.environ["SX_CODEX_CACHE"]
    try:
        with open(cache_path, "r", encoding="utf-8") as source:
            payload = json.load(source)
        if isinstance(payload, dict) and payload.get("models"):
            return payload
    except (OSError, json.JSONDecodeError):
        pass
    return {
        "models": [{
            "slug": "stallionx-template",
            "display_name": "StallionX",
            "description": "Available through StallionX.",
            "default_reasoning_level": "medium",
            "supported_reasoning_levels": [
                {"effort": "low", "description": "Fast responses with lighter reasoning"},
                {"effort": "medium", "description": "Balanced reasoning for everyday tasks"},
                {"effort": "high", "description": "Greater reasoning depth for complex tasks"},
                {"effort": "xhigh", "description": "Extra reasoning depth for demanding tasks"},
            ],
            "shell_type": "shell_command",
            "visibility": "list",
            "supported_in_api": True,
            "priority": 1,
            "support_verbosity": True,
            "truncation_policy": {"mode": "tokens", "limit": 10000},
            "experimental_supported_tools": [],
            "base_instructions": "You are Codex, a coding agent. Follow system, developer, and user instructions while completing software engineering tasks.",
        }]
    }


def display_name(model_id):
    parts = re.split(r"([._:/-]+)", model_id)
    return "".join("GPT" if part.lower() == "gpt" else part[:1].upper() + part[1:] for part in parts)


try:
    model_ids = sorted({item.strip() for item in os.environ["SX_MODEL_IDS"].splitlines() if item.strip()})
    source_catalog = load_catalog()
    source_models = source_catalog["models"]
    by_slug = {item.get("slug"): item for item in source_models if isinstance(item, dict) and item.get("slug")}
    template = by_slug.get("gpt-5.6-sol") or source_models[0]

    models = []
    for priority, model_id in enumerate(model_ids, start=1):
        known_model = by_slug.get(model_id)
        model = copy.deepcopy(known_model or template)
        model["slug"] = model_id
        model["display_name"] = model.get("display_name") if known_model else display_name(model_id)
        if not known_model:
            model["description"] = f"Available through StallionX: {model_id}."
            model["availability_nux"] = None
            model["upgrade"] = None
        model["visibility"] = "list"
        model["supported_in_api"] = True
        model["priority"] = priority
        models.append(model)

    with open(os.environ["SX_MODEL_CATALOG_OUTPUT"], "w", encoding="utf-8") as output:
        json.dump({"models": models}, output, ensure_ascii=False, indent=2)
        output.write("\n")
except Exception as error:  # noqa: BLE001
    print(f"[错误] 生成 Codex 模型目录失败: {error}", file=sys.stderr)
    raise SystemExit(1)
PYEOF
  then
    error "生成 Codex 模型目录失败；旧目录保持不变。"
    rm -f "${temp_file}"
    return 1
  fi

  mv "${temp_file}" "${CODEX_MODEL_CATALOG}"
  chmod 600 "${CODEX_MODEL_CATALOG}"
}

# 模型 ID -> Codex profile 名称：非 [A-Za-z0-9_-] 的字符统一替换为 "-"。
codex_profile_name() {
  printf '%s' "$1" | sed -E 's/[^A-Za-z0-9_-]+/-/g'
}

# 判断一个 profile 文件是否由脚本生成（首行带标记前缀）。
is_managed_codex_profile() {
  [ -f "$1" ] && head -n 1 "$1" | grep -q -F "${CODEX_PROFILE_MARK_PREFIX}"
}

# 列出脚本生成的 profile 名称（每行一个），供 --show 与完成提示使用。
list_managed_codex_profiles() {
  local file name
  [ -d "${CODEX_DIR}" ] || return 1
  for file in "${CODEX_DIR}"/*.config.toml; do
    [ -e "${file}" ] || continue
    is_managed_codex_profile "${file}" || continue
    name="$(basename "${file}")"
    printf '%s\n' "${name%.config.toml}"
  done
}

# 按模型 ID 列表（stdin，每行一个）刷新 ~/.codex/<名称>.config.toml：
# 先删除全部带标记的旧文件（后端下线的模型随之消失），再逐个写入新文件。
# stdout 输出本次写入的 profile 名称（每行一个）。
write_codex_profiles() {
  local file model_id name
  for file in "${CODEX_DIR}"/*.config.toml; do
    [ -e "${file}" ] || continue
    if is_managed_codex_profile "${file}"; then
      rm -f "${file}"
    fi
  done
  while IFS= read -r model_id; do
    [ -n "${model_id}" ] || continue
    name="$(codex_profile_name "${model_id}")"
    file="${CODEX_DIR}/${name}.config.toml"
    if [ -e "${file}" ]; then
      warn "跳过模型 ${model_id}：${file} 已存在且不是脚本生成的，保留你的文件。"
      continue
    fi
    printf '%s\nmodel = "%s"\nmodel_provider = "%s"\n' \
      "${CODEX_PROFILE_MARK}" "${model_id}" "${PROVIDER_ID}" > "${file}"
    chmod 600 "${file}"
    printf '%s\n' "${name}"
  done
}

# 强制覆盖前复制原 config.toml。备份与原文件放在同一目录，名称带本地时间；同一秒
# 重复执行时追加序号，避免覆盖上一份备份。stdout 返回备份路径供完成提示展示。
backup_codex_config() {
  [ -f "${CODEX_CONFIG}" ] || return 0
  local timestamp backup_path suffix=1
  timestamp="$(date '+%Y%m%d-%H%M%S')"
  backup_path="${CODEX_CONFIG}.backup-${timestamp}"
  while [ -e "${backup_path}" ]; do
    backup_path="${CODEX_CONFIG}.backup-${timestamp}-${suffix}"
    suffix=$((suffix + 1))
  done
  if ! cp -p "${CODEX_CONFIG}" "${backup_path}"; then
    error "备份 Codex 配置失败：${backup_path}"
    return 1
  fi
  chmod 600 "${backup_path}"
  printf '%s' "${backup_path}"
}

# --force 的完整覆盖只保留 StallionX 运行所需字段。调用方必须先确认模型目录已生成并
# 完成旧配置备份；任何一步失败都不能继续覆盖，避免把可用配置替换成半成品。
write_forced_codex_config() {
  local model="$1" catalog_path
  catalog_path="$(toml_escape "${CODEX_MODEL_CATALOG}")"
  cat > "${CODEX_CONFIG}" <<FORCEEOF
# managed-by: stallionx-install --force
model = "${model}"
model_provider = "${PROVIDER_ID}"
model_catalog_json = "${catalog_path}"

[model_providers.${PROVIDER_ID}]
name = "${PROVIDER_NAME}"
base_url = "${CODEX_BASE_URL}"
experimental_bearer_token = "${API_KEY}"
# StallionX 使用 Responses API 格式
wire_api = "responses"
FORCEEOF
}

# 增量更新 Codex 配置，只管理顶层 model/model_provider、可安全接管的模型目录与
# StallionX provider 段。
# 其他配置（例如 hooks.state、projects、MCP、sandbox 等）会原样保留，避免重复
# 执行安装脚本后丢失用户设置或 Hook 信任记录。模型 profiles 是独立文件，
# 不在这里处理，见 write_codex_profiles。
update_codex_config() {
  local source_file="${CODEX_CONFIG}"
  local catalog_path="${1:-}" catalog_toml="" temp_file
  [ -n "${catalog_path}" ] && catalog_toml="$(toml_escape "${catalog_path}")"
  temp_file="$(mktemp "${CODEX_DIR}/config.toml.tmp.XXXXXX")"

  # 首次安装时用空文件作为输入；awk 统一负责补齐缺少的顶层字段和 provider 段。
  [ -f "${source_file}" ] || : > "${source_file}"

  if ! awk \
    -v model="${CODEX_MODEL}" \
    -v provider_id="${PROVIDER_ID}" \
    -v provider_name="${PROVIDER_NAME}" \
    -v provider_url="${CODEX_BASE_URL}" \
    -v provider_token="${API_KEY}" \
    -v catalog_path="${catalog_toml}" '
    function print_root_fields() {
      if (!seen_model) print "model = \"" model "\""
      if (!seen_provider) print "model_provider = \"" provider_id "\""
      if (catalog_path != "" && !seen_catalog) print "model_catalog_json = \"" catalog_path "\""
      if (!seen_model || !seen_provider || (catalog_path != "" && !seen_catalog)) print ""
    }
    function print_provider_section() {
      print "[model_providers." provider_id "]"
      print "name = \"" provider_name "\""
      print "base_url = \"" provider_url "\""
      print "experimental_bearer_token = \"" provider_token "\""
      print "# StallionX 使用 Responses API 格式"
      print "wire_api = \"responses\""
      provider_written = 1
    }
    {
      # 跳过旧的 StallionX provider 段；遇到下一个 TOML 表头时恢复原样输出。
      if (inside_provider) {
        if ($0 ~ /^[[:space:]]*\[/) {
          inside_provider = 0
        } else {
          next
        }
      }

      if ($0 == "[model_providers." provider_id "]") {
        if (!root_finished) {
          print_root_fields()
          root_finished = 1
        }
        print_provider_section()
        inside_provider = 1
        next
      }

      if (!root_finished && $0 ~ /^[[:space:]]*\[/) {
        print_root_fields()
        root_finished = 1
      }

      if (!root_finished && $0 ~ /^[[:space:]]*model[[:space:]]*=/) {
        seen_model = 1
      }
      if (!root_finished && $0 ~ /^[[:space:]]*model_provider[[:space:]]*=/) {
        print "model_provider = \"" provider_id "\""
        seen_provider = 1
        next
      }
      if (!root_finished && $0 ~ /^[[:space:]]*model_catalog_json[[:space:]]*=/) {
        seen_catalog = 1
        if (catalog_path != "") {
          print "model_catalog_json = \"" catalog_path "\""
          next
        }
      }

      print
    }
    END {
      if (!root_finished) print_root_fields()
      if (!provider_written) {
        print ""
        print_provider_section()
      }
    }
  ' "${source_file}" > "${temp_file}"; then
    error "更新 Codex 配置失败：${CODEX_CONFIG}"
    rm -f "${temp_file}"
    return 1
  fi

  mv "${temp_file}" "${CODEX_CONFIG}"
}

# ----------------------------- 终端交互工具 ----------------------------------
# 脚本的主要分发方式是 `curl -fsSL .../install.sh | bash`，此时 stdin 是脚本自身
# 的内容而不是键盘，直接 `read` 会立刻读到脚本正文或 EOF。因此所有交互输入一律
# 走 /dev/tty；没有可用终端时明确报错并给出非交互用法，而不是读到空值继续执行。

# 判断当前是否存在可交互的终端。
# 必须真正尝试打开 /dev/tty：在没有控制终端的进程里（CI、nohup、Docker 非 -t 运行），
# /dev/tty 这个设备节点依然存在且 -r/-w 判断为真，但一打开就报 "Device not configured"。
has_tty() { (exec 3<>/dev/tty) 2>/dev/null; }

# 交互前的守卫：没有终端时给出可执行的替代方案后退出
require_tty() {
  if has_tty; then
    return 0
  fi
  error "当前环境没有可用终端，无法交互输入。"
  error "请改用非交互方式，例如："
  error "  bash install.sh --key <API_KEY>"
  error "  STALLIONX_PASSWORD=<密码> bash install.sh --login --username <账号>"
  exit 1
}

# 从终端读取一行（回显）。用法：prompt_line 变量名 "提示语"
prompt_line() {
  local __var_name="$1" __prompt="$2" __value=""
  require_tty
  printf '%s' "${__prompt}" > /dev/tty
  IFS= read -r __value < /dev/tty || true
  printf -v "${__var_name}" '%s' "${__value}"
}

# 交互确认是否启用 Codex 强制覆盖。默认答案必须是“否”，避免用户直接按 Enter 时
# 意外清除 MCP、Hook、项目和 sandbox 等本地配置；无法识别的输入会重新询问。
prompt_codex_force_overwrite() {
  local answer=""
  while true; do
    prompt_line answer "是否强制覆盖 Codex 配置？将先备份旧文件，但会清除原 MCP、Hook、项目等配置（默认：否）[y/N]："
    case "${answer}" in
      ""|n|N|no|No|NO|否) return 1 ;;
      y|Y|yes|Yes|YES|是) return 0 ;;
      *) warn "请输入 y/yes/是 或 n/no/否；直接回车默认选择否。" ;;
    esac
  done
}

# 从终端读取一行（不回显），用于密码输入。用法：prompt_secret 变量名 "提示语"
prompt_secret() {
  local __var_name="$1" __prompt="$2" __value=""
  require_tty
  printf '%s' "${__prompt}" > /dev/tty
  IFS= read -rs __value < /dev/tty || true
  printf '\n' > /dev/tty
  printf -v "${__var_name}" '%s' "${__value}"
}

# 从终端读取单个按键（不回显），供方向键菜单使用。用法：prompt_key 变量名 [字符数]
prompt_key() {
  local __var_name="$1" __count="${2:-1}" __value=""
  require_tty
  IFS= read -rsn"${__count}" __value < /dev/tty || true
  printf -v "${__var_name}" '%s' "${__value}"
}

# ----------------------------- JSON 解析 -------------------------------------
# 三级降级：python3 → jq → sed。前两者能正确处理转义字符与嵌套结构；
# sed 兜底只解析平铺的简单键值，足以覆盖本脚本关心的 token / key / message 字段，
# 保证在既没有 python3 也没有 jq 的精简系统上仍能完成配置。

JSON_PARSER=""   # 缓存探测结果，避免每次调用都重复查找命令

# 探测可用的 JSON 解析后端
detect_json_parser() {
  [ -n "${JSON_PARSER}" ] && return 0
  if command -v python3 >/dev/null 2>&1; then
    JSON_PARSER="python3"
  elif command -v jq >/dev/null 2>&1; then
    JSON_PARSER="jq"
  else
    JSON_PARSER="sed"
  fi
}

# 从 JSON 字符串中按路径取值。用法：json_get "<json 文本>" "data.key"
# 字段缺失或值为 null 时返回 1 且不输出任何内容。
json_get() {
  local json="$1" path="$2" value=""
  detect_json_parser

  case "${JSON_PARSER}" in
    python3)
      # 通过环境变量传参，避免 JSON 内容被 shell 二次解释
      value="$(JSON_PAYLOAD="${json}" JSON_PATH="${path}" python3 -c '
import json, os, sys
try:
    data = json.loads(os.environ["JSON_PAYLOAD"])
except Exception:
    sys.exit(1)
for part in os.environ["JSON_PATH"].split("."):
    if isinstance(data, dict) and part in data:
        data = data[part]
    else:
        sys.exit(1)
if data is None:
    sys.exit(1)
if isinstance(data, bool):
    sys.stdout.write("true" if data else "false")
elif isinstance(data, (dict, list)):
    sys.stdout.write(json.dumps(data, ensure_ascii=False))
else:
    sys.stdout.write(str(data))
' 2>/dev/null)" || return 1
      ;;
    jq)
      value="$(printf '%s' "${json}" \
        | jq -r --arg p "${path}" 'getpath($p | split(".")) // empty' 2>/dev/null)" || return 1
      ;;
    sed)
      # 兜底方案只按最后一段键名做平铺匹配，先试字符串值再试数值
      local leaf="${path##*.}"
      value="$(printf '%s' "${json}" \
        | sed -n "s/.*\"${leaf}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1)"
      if [ -z "${value}" ]; then
        value="$(printf '%s' "${json}" \
          | sed -n "s/.*\"${leaf}\"[[:space:]]*:[[:space:]]*\([0-9][0-9.]*\).*/\1/p" | head -n 1)"
      fi
      ;;
  esac

  [ -n "${value}" ] || return 1
  printf '%s' "${value}"
}

# 把字符串转义为 JSON 字符串字面量（含首尾引号），用于拼装请求体。
# 密码里出现引号、反斜杠或中文都必须正确转义，否则会拼出非法 JSON。
json_escape() {
  local raw="$1"
  detect_json_parser
  case "${JSON_PARSER}" in
    python3)
      JSON_RAW="${raw}" python3 -c 'import json, os, sys; sys.stdout.write(json.dumps(os.environ["JSON_RAW"], ensure_ascii=False))'
      ;;
    jq)
      printf '%s' "${raw}" | jq -Rs .
      ;;
    sed)
      # 无 JSON 工具时只能做基础转义：反斜杠与双引号。
      # 控制字符（换行、制表符）在账号密码等输入里不应出现，此处不额外处理。
      local escaped="${raw//\\/\\\\}"
      escaped="${escaped//\"/\\\"}"
      printf '"%s"' "${escaped}"
      ;;
  esac
}

# 解析渠道分组数组（形如 [{"id":1,"code":"x","name":"y"},...]），把每个分组的
# id / code / name 分别写入全局并行数组 GROUP_IDS[] / GROUP_CODES[] / GROUP_NAMES[]。
# 用法：parse_channel_groups "<json 文本>" "<数组所在路径，如 data 或 data.channel_groups>"
# 三种 JSON 解析后端各自直接产出 tab 分隔的一行一条记录，不复用按路径取单值的
# json_get——jq 在结果为数组时默认多行缩进输出，逐行做花括号匹配会把一个对象拆成
# 好几行，因此这里让每种后端自己保证「一条记录一行」。
parse_channel_groups() {
  local json="$1" path="$2"
  GROUP_IDS=()
  GROUP_CODES=()
  GROUP_NAMES=()
  detect_json_parser

  local line
  case "${JSON_PARSER}" in
    python3)
      while IFS=$'\t' read -r gid gcode gname; do
        [ -n "${gid}" ] || continue
        GROUP_IDS+=("${gid}")
        GROUP_CODES+=("${gcode}")
        GROUP_NAMES+=("${gname}")
      done < <(JSON_PAYLOAD="${json}" JSON_PATH="${path}" python3 -c '
import json, os, sys
try:
    data = json.loads(os.environ["JSON_PAYLOAD"])
except Exception:
    sys.exit(0)
for part in os.environ["JSON_PATH"].split("."):
    if isinstance(data, dict) and part in data:
        data = data[part]
    else:
        data = []
        break
if not isinstance(data, list):
    data = []
for item in data:
    if not isinstance(item, dict):
        continue
    sys.stdout.write("%s\t%s\t%s\n" % (item.get("id", ""), item.get("code", ""), item.get("name", "")))
' 2>/dev/null)
      ;;
    jq)
      while IFS=$'\t' read -r gid gcode gname; do
        [ -n "${gid}" ] || continue
        GROUP_IDS+=("${gid}")
        GROUP_CODES+=("${gcode}")
        GROUP_NAMES+=("${gname}")
      done < <(printf '%s' "${json}" | jq -r --arg p "${path}" \
        '(getpath($p | split(".")) // [])[] | [(.id|tostring), .code, .name] | @tsv' 2>/dev/null)
      ;;
    sed)
      # 无 python3/jq 时只解析后端自有接口的扁平分组对象。
      # 提取带公开分组 ID 的对象，不依赖 JSON 对象的字段顺序。
      local obj
      while IFS= read -r obj; do
        [ -n "${obj}" ] || continue
        GROUP_IDS+=("$(printf '%s' "${obj}" | sed -n 's/.*"id":"\(cgroup_[0-9a-f]*\)".*/\1/p')")
        GROUP_CODES+=("$(printf '%s' "${obj}" | sed -n 's/.*"code":"\([^"]*\)".*/\1/p')")
        GROUP_NAMES+=("$(printf '%s' "${obj}" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')")
      done < <(printf '%s' "${json}" | grep -oE '\{[^{}]*"id":"cgroup_[0-9a-f]{32}"[^{}]*\}')
      ;;
  esac
}

# 把 parse_channel_groups 解析出的分组渲染成「名称（编码）、名称（编码）」形式的
# 展示文本，用于开通成功后提示用户实际绑定了哪些分组。
format_channel_group_labels() {
  local result="" i
  for ((i = 0; i < ${#GROUP_IDS[@]}; i++)); do
    result="${result:+${result}、}${GROUP_NAMES[i]}（${GROUP_CODES[i]}）"
  done
  printf '%s' "${result}"
}

# ----------------------------- 平台 API 调用 ---------------------------------

API_RESPONSE=""   # 最近一次请求的响应体
API_STATUS=""     # 最近一次请求的 HTTP 状态码

# 调用平台接口。用法：api_request <METHOD> <路径> [JSON 请求体] [JWT]
# 网络层失败返回 1；HTTP 层面的成败由调用方通过 api_succeeded 判断。
api_request() {
  local method="$1" path="$2" body="${3:-}" jwt="${4:-}"
  local url="${BASE_URL}${path}" raw=""
  local curl_args=(-sS -X "${method}" -H 'Content-Type: application/json' --max-time 30 -w '\n%{http_code}')

  [ -n "${jwt}" ] && curl_args+=(-H "Authorization: Bearer ${jwt}")
  [ -n "${body}" ] && curl_args+=(--data-binary "${body}")

  if ! raw="$(curl "${curl_args[@]}" "${url}" 2>/dev/null)"; then
    API_RESPONSE=""
    API_STATUS=""
    return 1
  fi

  # curl 的 -w 把状态码追加在最后一行，据此拆出响应体
  API_STATUS="${raw##*$'\n'}"
  API_RESPONSE="${raw%$'\n'*}"
  return 0
}

# 判断最近一次请求是否成功：HTTP 2xx 且 envelope 中 success 不为 false
api_succeeded() {
  case "${API_STATUS}" in
    2??) ;;
    *) return 1 ;;
  esac
  local ok
  ok="$(json_get "${API_RESPONSE}" "success" || true)"
  [ "${ok}" = "false" ] && return 1
  return 0
}

# 提取接口返回的错误提示；没有 message 字段时回退为状态码描述
api_error_message() {
  local fallback="${1:-请求失败}" message=""
  message="$(json_get "${API_RESPONSE}" "message" || true)"
  if [ -n "${message}" ]; then
    printf '%s' "${message}"
  else
    printf '%s（HTTP %s）' "${fallback}" "${API_STATUS:-无响应}"
  fi
}

# ----------------------------- 登录凭据缓存 ----------------------------------
# 只缓存平台登录令牌（JWT），不缓存密码：JWT 24 小时后自然失效，
# 即使文件泄露，影响面也远小于长期有效的账号密码。

STALLIONX_JWT=""        # 当前会话使用的登录令牌
STALLIONX_USERNAME=""   # 当前登录的账号名，仅用于终端展示

# 将登录令牌写入 ~/.stallionx/credentials.json（权限 600）
save_credentials() {
  local jwt="$1" username="$2" expires_at
  # 服务端签发的 JWT 有效期为 24 小时，本地按 23 小时记账，留出时钟偏差余量
  expires_at=$(( $(date +%s) + 23 * 3600 ))

  mkdir -p "${CREDENTIAL_DIR}"
  chmod 700 "${CREDENTIAL_DIR}" 2>/dev/null || true

  # 先以 600 创建再写入，避免令牌在写入瞬间以默认权限落盘
  : > "${CREDENTIAL_FILE}"
  chmod 600 "${CREDENTIAL_FILE}" 2>/dev/null || true
  cat > "${CREDENTIAL_FILE}" <<CRED
{
  "base_url": "${BASE_URL}",
  "username": "${username}",
  "token": "${jwt}",
  "expires_at": ${expires_at}
}
CRED
}

# 读取本地缓存的登录令牌；已过期、属于其他站点或文件不存在时返回 1
load_credentials() {
  [ -f "${CREDENTIAL_FILE}" ] || return 1

  local content token expires_at cached_base_url now
  content="$(cat "${CREDENTIAL_FILE}" 2>/dev/null || true)"
  [ -n "${content}" ] || return 1

  # 换过 --base-url 后旧令牌对新站点无效，直接判定为不可用
  cached_base_url="$(json_get "${content}" "base_url" || true)"
  [ "${cached_base_url}" = "${BASE_URL}" ] || return 1

  token="$(json_get "${content}" "token" || true)"
  [ -n "${token}" ] || return 1

  expires_at="$(json_get "${content}" "expires_at" || true)"
  now="$(date +%s)"
  [ -n "${expires_at}" ] || return 1
  [ "${expires_at%%.*}" -gt "${now}" ] 2>/dev/null || return 1

  STALLIONX_JWT="${token}"
  STALLIONX_USERNAME="$(json_get "${content}" "username" || true)"
  return 0
}

# 清除本地缓存的登录令牌
clear_credentials() {
  [ -f "${CREDENTIAL_FILE}" ] || return 0
  rm -f "${CREDENTIAL_FILE}"
}

# ----------------------------- 账号流程 --------------------------------------

# 登录已有账号，成功后把 JWT 存入 STALLIONX_JWT 并缓存到本地。
# 账号与密码可分别由 --username / STALLIONX_USERNAME_INPUT 与 STALLIONX_PASSWORD 预先提供，
# 便于在 CI 或批量装机场景下完全无交互执行。
do_login() {
  local account="${ACCOUNT_INPUT}" password="${STALLIONX_PASSWORD:-}" body=""

  if [ -z "${account}" ]; then
    prompt_line account '请输入账号（用户名或邮箱）：'
  fi
  if [ -z "${account}" ]; then
    error "账号不能为空。"
    return 1
  fi

  if [ -z "${password}" ]; then
    prompt_secret password '请输入密码（输入不会显示）：'
  fi
  if [ -z "${password}" ]; then
    error "密码不能为空。"
    return 1
  fi

  info "正在登录 ${PROVIDER_NAME}..."
  body="{\"username\":$(json_escape "${account}"),\"password\":$(json_escape "${password}")}"
  if ! api_request POST "/api/user/login" "${body}"; then
    error "无法连接 ${BASE_URL}，请检查网络后重试。"
    return 1
  fi
  if ! api_succeeded; then
    error "登录失败：$(api_error_message '账号或密码错误')"
    return 1
  fi

  STALLIONX_JWT="$(json_get "${API_RESPONSE}" "data.token" || true)"
  if [ -z "${STALLIONX_JWT}" ]; then
    error "登录响应中没有找到登录令牌，请联系管理员。"
    return 1
  fi
  STALLIONX_USERNAME="$(json_get "${API_RESPONSE}" "data.user.username" || printf '%s' "${account}")"

  save_credentials "${STALLIONX_JWT}" "${STALLIONX_USERNAME}"
  ok "登录成功：${STALLIONX_USERNAME}"
  return 0
}

# 注册新账号：邮箱验证码 → 设置账号密码 → 注册并直接拿到登录令牌
do_register() {
  local email="${EMAIL_INPUT}" code="" username="${ACCOUNT_INPUT}" password="${STALLIONX_PASSWORD:-}"
  local password_confirm="" invite_code="${INVITE_CODE_INPUT}" body="" test_code=""

  if [ -z "${email}" ]; then
    prompt_line email '请输入邮箱（用于接收验证码）：'
  fi
  if [ -z "${email}" ]; then
    error "邮箱不能为空。"
    return 1
  fi

  info "正在向 ${email} 发送验证码..."
  body="{\"email\":$(json_escape "${email}")}"
  if ! api_request POST "/api/user/verification" "${body}"; then
    error "无法连接 ${BASE_URL}，请检查网络后重试。"
    return 1
  fi
  if ! api_succeeded; then
    error "验证码发送失败：$(api_error_message '请稍后重试')"
    return 1
  fi

  # 站点未配置邮件服务时会进入测试模式并直接返回验证码，此时无需查收邮件
  test_code="$(json_get "${API_RESPONSE}" "data.code" || true)"
  if [ -n "${test_code}" ]; then
    warn "站点处于邮件测试模式，验证码直接返回：${test_code}"
    code="${test_code}"
  else
    ok "验证码已发送，请查收邮箱（含垃圾邮件箱）"
    prompt_line code '请输入邮箱验证码：'
  fi
  if [ -z "${code}" ]; then
    error "验证码不能为空。"
    return 1
  fi

  if [ -z "${username}" ]; then
    # 默认用邮箱前缀作为用户名，去掉平台不接受的字符，减少一次输入
    local suggested="${email%%@*}"
    suggested="$(printf '%s' "${suggested}" | tr -cd 'A-Za-z0-9_-')"
    prompt_line username "请输入用户名（直接回车使用 ${suggested}）："
    [ -z "${username}" ] && username="${suggested}"
  fi
  if [ -z "${username}" ]; then
    error "用户名不能为空。"
    return 1
  fi

  if [ -z "${password}" ]; then
    prompt_secret password '请设置密码（至少 6 位，输入不会显示）：'
    prompt_secret password_confirm '请再次输入密码：'
    if [ "${password}" != "${password_confirm}" ]; then
      error "两次输入的密码不一致。"
      return 1
    fi
  fi
  if [ ${#password} -lt 6 ]; then
    error "密码长度不能少于 6 位。"
    return 1
  fi

  # 邀请码可选：命令行未提供且处于交互模式时询问一次，回车跳过
  if [ -z "${invite_code}" ] && has_tty; then
    prompt_line invite_code '邀请码（没有请直接回车）：'
  fi

  info "正在注册账号..."
  body="{\"username\":$(json_escape "${username}"),\"email\":$(json_escape "${email}")"
  body="${body},\"password\":$(json_escape "${password}")"
  body="${body},\"verification_code\":$(json_escape "${code}")"
  [ -n "${invite_code}" ] && body="${body},\"invite_code\":$(json_escape "${invite_code}")"
  body="${body}}"

  if ! api_request POST "/api/user/register" "${body}"; then
    error "无法连接 ${BASE_URL}，请检查网络后重试。"
    return 1
  fi
  if ! api_succeeded; then
    error "注册失败：$(api_error_message '请检查输入后重试')"
    return 1
  fi

  STALLIONX_JWT="$(json_get "${API_RESPONSE}" "data.token" || true)"
  if [ -z "${STALLIONX_JWT}" ]; then
    error "注册响应中没有找到登录令牌，请改用登录方式重试。"
    return 1
  fi
  STALLIONX_USERNAME="$(json_get "${API_RESPONSE}" "data.user.username" || printf '%s' "${username}")"

  save_credentials "${STALLIONX_JWT}" "${STALLIONX_USERNAME}"
  ok "注册成功：${STALLIONX_USERNAME}"
  return 0
}

# 拉取当前用户可绑定的渠道分组，解析到 GROUP_IDS[]/GROUP_CODES[]/GROUP_NAMES[]。
# 失败（网络错误、接口报错）时给出提示并返回 1，调用方应当降级为不传选择，
# 交由服务端按默认分组处理，而不是把整个开通流程卡在这一步。
list_bindable_channel_groups() {
  if ! api_request GET "/api/cli/channel-groups" "" "${STALLIONX_JWT}"; then
    warn "查询可绑定渠道分组失败，将使用账号默认分组。"
    return 1
  fi
  if ! api_succeeded; then
    warn "查询可绑定渠道分组失败：$(api_error_message '请稍后重试')，将使用账号默认分组。"
    return 1
  fi
  parse_channel_groups "${API_RESPONSE}" "data"
  return 0
}

# 在支持交互的终端中渲染渠道分组勾选列表。
# 操作：↑/↓ 或 j/k 移动，空格勾选，Enter 确认；默认只勾选第一项——列表接口按 id
# 倒序返回，第一项即服务端「默认分组」，与网页后台 Token 创建页的默认选择口径一致
# （见 controller/cli.go 的 listBindableChannelGroups 注释）。
# 全部取消勾选后按 Enter 会被拒绝，避免建出一个不绑定任何分组、发请求必 403 的空令牌。
# 结果写入全局 SELECTED_CHANNEL_GROUP_IDS（逗号分隔的分组 ID）。
select_channel_groups_interactively() {
  local current=0 key sequence index count marker any_checked c
  local checked=()
  count=${#GROUP_IDS[@]}
  for ((index = 0; index < count; index++)); do
    checked[index]=0
  done
  checked[0]=1

  printf '\033[?25l' > /dev/tty
  trap 'printf "\033[?25h" > /dev/tty' EXIT
  trap 'printf "\033[?25h" > /dev/tty; trap - INT TERM EXIT; exit 130' INT
  trap 'printf "\033[?25h" > /dev/tty; trap - INT TERM EXIT; exit 143' TERM

  while true; do
    printf '\r请选择要绑定的渠道分组（↑/↓ 移动，空格勾选，Enter 确认，至少保留一项）：\n' > /dev/tty
    for ((index = 0; index < count; index++)); do
      if [ "${checked[index]}" -eq 1 ]; then
        marker="[x]"
      else
        marker="[ ]"
      fi
      if [ "${index}" -eq "${current}" ]; then
        printf '\033[36m> %s %s（%s）\033[0m\n' "${marker}" "${GROUP_NAMES[index]}" "${GROUP_CODES[index]}" > /dev/tty
      else
        printf '  %s %s（%s）\n' "${marker}" "${GROUP_NAMES[index]}" "${GROUP_CODES[index]}" > /dev/tty
      fi
    done

    prompt_key key
    case "${key}" in
      $'\x1b')
        prompt_key sequence 2
        case "${sequence}" in
          '[A') current=$((current - 1)) ;;
          '[B') current=$((current + 1)) ;;
        esac
        ;;
      k|K) current=$((current - 1)) ;;
      j|J) current=$((current + 1)) ;;
      ' ')
        checked[current]=$((1 - checked[current]))
        ;;
      '')
        # 至少要保留一个分组，否则新令牌绑不上任何渠道，等于一把打不开门的钥匙
        any_checked=0
        for c in "${checked[@]}"; do
          [ "${c}" -eq 1 ] && any_checked=1 && break
        done
        if [ "${any_checked}" -eq 1 ]; then
          break
        else
          printf '\a' > /dev/tty
        fi
        ;;
    esac

    [ "${current}" -lt 0 ] && current=$((count - 1))
    [ "${current}" -ge "${count}" ] && current=0
    printf '\033[%dA' "$((count + 1))" > /dev/tty
  done

  printf '\033[?25h' > /dev/tty
  trap - INT TERM EXIT

  SELECTED_CHANNEL_GROUP_IDS=""
  for ((index = 0; index < count; index++)); do
    if [ "${checked[index]}" -eq 1 ]; then
      SELECTED_CHANNEL_GROUP_IDS="${SELECTED_CHANNEL_GROUP_IDS:+${SELECTED_CHANNEL_GROUP_IDS},}${GROUP_IDS[index]}"
    fi
  done
}

# 决定新建令牌要绑定的渠道分组，结果写入全局 SELECTED_CHANNEL_GROUP_IDS
# （逗号分隔的分组 ID；留空表示不显式指定，交由服务端按默认分组处理）。
# 只在即将新建令牌时才有意义——命中同名令牌复用的话，这里的选择会被服务端忽略。
resolve_channel_group_selection() {
  SELECTED_CHANNEL_GROUP_IDS=""

  if [ -n "${CHANNEL_GROUPS_INPUT}" ]; then
    # --channel-groups 显式给了编码：多为非交互批量装机场景，按编码精确匹配 ID，
    # 匹配不到就直接报错退出，不能悄悄换成别的分组。
    if ! list_bindable_channel_groups; then
      error "无法获取可绑定的渠道分组列表，--channel-groups 无法生效。"
      return 1
    fi
    local old_ifs="${IFS}" code idx found
    local requested=()
    IFS=','
    for code in ${CHANNEL_GROUPS_INPUT}; do
      code="$(printf '%s' "${code}" | tr -d '[:space:]')"
      [ -n "${code}" ] && requested+=("${code}")
    done
    IFS="${old_ifs}"

    for code in "${requested[@]}"; do
      found=0
      for ((idx = 0; idx < ${#GROUP_CODES[@]}; idx++)); do
        if [ "${GROUP_CODES[idx]}" = "${code}" ]; then
          SELECTED_CHANNEL_GROUP_IDS="${SELECTED_CHANNEL_GROUP_IDS:+${SELECTED_CHANNEL_GROUP_IDS},}${GROUP_IDS[idx]}"
          found=1
          break
        fi
      done
      if [ "${found}" -eq 0 ]; then
        error "渠道分组编码不存在或当前账号不可绑定：${code}"
        return 1
      fi
    done
    return 0
  fi

  # 没有显式指定编码时，只有交互终端才弹出勾选界面；非交互环境（CI、批量装机）
  # 保持沉默，交给服务端按默认分组处理，避免卡住自动化流程。
  has_tty || return 0

  if ! list_bindable_channel_groups; then
    return 0
  fi
  if [ "${#GROUP_IDS[@]}" -eq 0 ]; then
    # 没有可绑定分组是站点侧配置问题，留给 do_provision 的失败提示报出明确原因
    return 0
  fi
  if [ "${#GROUP_IDS[@]}" -eq 1 ]; then
    info "当前账号只有一个可绑定渠道分组，已自动选择：${GROUP_NAMES[0]}（${GROUP_CODES[0]}）"
    SELECTED_CHANNEL_GROUP_IDS="${GROUP_IDS[0]}"
    return 0
  fi

  select_channel_groups_interactively
  return 0
}

# 用登录令牌换取可用的 API Key。
# 服务端接口是幂等的：同名令牌已存在则复用，重复执行脚本不会刷出一堆令牌。
# 成功时把 Key 写入全局 API_KEY，并把余额记入 ACCOUNT_BALANCE 供最后提示使用。
do_provision() {
  local body="" fields=""

  info "正在获取 API Key..."
  if [ -n "${TOKEN_NAME_INPUT}" ]; then
    fields="\"name\":$(json_escape "${TOKEN_NAME_INPUT}")"
  fi
  if [ -n "${SELECTED_CHANNEL_GROUP_IDS}" ]; then
    # 服务端只在新建令牌时读取该字段，复用同名令牌时会被忽略；
    # Public IDs are opaque strings. Validate their alphabet before constructing
    # JSON so every parser backend (including sed fallback) submits the same type.
    local quoted_ids="" public_group_id
    local -a public_group_ids
    IFS=',' read -r -a public_group_ids <<< "${SELECTED_CHANNEL_GROUP_IDS}"
    for public_group_id in "${public_group_ids[@]}"; do
      if [[ ! "${public_group_id}" =~ ^cgroup_[0-9a-f]{32}$ ]]; then
        error "渠道分组标识无效，请重新选择。"
        return 1
      fi
      quoted_ids="${quoted_ids:+${quoted_ids},}\"${public_group_id}\""
    done
    fields="${fields:+${fields},}\"channel_group_ids\":[${quoted_ids}]"
  fi
  body="{${fields}}"

  if ! api_request POST "/api/cli/provision" "${body}" "${STALLIONX_JWT}"; then
    error "无法连接 ${BASE_URL}，请检查网络后重试。"
    return 1
  fi
  if [ "${API_STATUS}" = "401" ]; then
    # 令牌过期或失效：清掉本地缓存，让调用方重新走登录流程
    clear_credentials
    STALLIONX_JWT=""
    error "登录状态已失效，请重新登录。"
    return 1
  fi
  if [ "${API_STATUS}" = "400" ]; then
    # 所选分组不可绑定（已被禁用/隐藏等）：这是选择本身的问题，不清登录态，
    # 让调用方可以直接重跑一次选择分组的流程。
    error "获取 API Key 失败：$(api_error_message '所选渠道分组不可用')"
    return 1
  fi
  if ! api_succeeded; then
    error "获取 API Key 失败：$(api_error_message '请稍后重试')"
    return 1
  fi

  API_KEY="$(json_get "${API_RESPONSE}" "data.key" || true)"
  if [ -z "${API_KEY}" ]; then
    error "接口未返回 API Key，请登录网页后台手动创建令牌后使用 --key 配置。"
    return 1
  fi

  ACCOUNT_BALANCE="$(json_get "${API_RESPONSE}" "data.balance" || true)"
  local is_new token_name groups_label
  is_new="$(json_get "${API_RESPONSE}" "data.is_new" || true)"
  token_name="$(json_get "${API_RESPONSE}" "data.token_name" || true)"
  if [ "${is_new}" = "true" ]; then
    ok "已为你创建 API Key：${token_name:-CLI 一键配置}"
  else
    ok "已复用账号中已有的 API Key：${token_name:-CLI 一键配置}"
  fi

  # 展示实际绑定的分组，让用户在完成配置的同一屏就知道这把 Key 能访问什么，
  # 而不用再跳去网页后台确认。
  parse_channel_groups "${API_RESPONSE}" "data.channel_groups"
  groups_label="$(format_channel_group_labels)"
  [ -n "${groups_label}" ] && info "已绑定渠道分组：${groups_label}"

  return 0
}

# 交互式选择获取 Key 的方式，返回值写入全局 KEY_SOURCE。
# 与客户端选择器保持一致的操作方式（↑/↓ 移动、Enter 确认），按键统一从 /dev/tty 读取。
select_key_source_interactively() {
  local current=0 key sequence index count
  local labels=() values=()

  # 已经配置过的用户重复执行脚本，多半只是想同步配置或换客户端，
  # 因此把「沿用当前 Key」放在第一位作为默认项。
  if [ -n "${EXISTING_KEY}" ]; then
    labels+=("沿用当前 Key（$(mask_key "${EXISTING_KEY}")）")
    values+=("existing")
  fi
  if [ -n "${STALLIONX_JWT}" ]; then
    labels+=("使用已登录账号自动获取 Key（${STALLIONX_USERNAME}）")
    values+=("session")
  fi
  labels+=("登录已有账号，自动获取 Key")
  values+=("login")
  labels+=("注册新账号，自动获取 Key")
  values+=("register")
  labels+=("手动粘贴已有的 API Key")
  values+=("manual")
  count=${#labels[@]}

  printf '\033[?25l' > /dev/tty
  trap 'printf "\033[?25h" > /dev/tty' EXIT
  trap 'printf "\033[?25h" > /dev/tty; trap - INT TERM EXIT; exit 130' INT
  trap 'printf "\033[?25h" > /dev/tty; trap - INT TERM EXIT; exit 143' TERM

  while true; do
    printf '\r请选择获取 API Key 的方式（↑/↓ 移动，Enter 确认）：\n' > /dev/tty
    for ((index = 0; index < count; index++)); do
      if [ "${index}" -eq "${current}" ]; then
        printf '\033[36m> %s\033[0m\n' "${labels[index]}" > /dev/tty
      else
        printf '  %s\n' "${labels[index]}" > /dev/tty
      fi
    done

    prompt_key key
    case "${key}" in
      $'\x1b')
        prompt_key sequence 2
        case "${sequence}" in
          '[A') current=$((current - 1)) ;;
          '[B') current=$((current + 1)) ;;
        esac
        ;;
      k|K) current=$((current - 1)) ;;
      j|J) current=$((current + 1)) ;;
      '') break ;;
    esac

    [ "${current}" -lt 0 ] && current=$((count - 1))
    [ "${current}" -ge "${count}" ] && current=0
    printf '\033[%dA' "$((count + 1))" > /dev/tty
  done

  printf '\033[?25h' > /dev/tty
  trap - INT TERM EXIT
  KEY_SOURCE="${values[current]}"
}

# 走账号链路拿 Key：先确保有可用的登录令牌，再调用开通接口。
# mode 取值 login / register / session。
acquire_key_via_account() {
  local mode="$1"

  case "${mode}" in
    session)
      # 复用本地缓存的登录令牌；若已失效则回退到登录流程
      if [ -z "${STALLIONX_JWT}" ]; then
        do_login || return 1
      fi
      ;;
    login)
      do_login || return 1
      ;;
    register)
      do_register || return 1
      ;;
    *)
      error "未知的账号操作：${mode}"
      return 1
      ;;
  esac

  # 只在真的可能新建令牌时才需要决定分组（复用同名令牌时服务端会忽略这里的选择，
  # 但事先无法知道会不会命中复用，因此统一在这里解析一次）。
  resolve_channel_group_selection || return 1

  if ! do_provision; then
    # 令牌失效导致的失败已清空 JWT，这里再给一次登录机会，避免用户重跑整个脚本
    if [ -z "${STALLIONX_JWT}" ] && [ "${mode}" = "session" ] && has_tty; then
      do_login || return 1
      resolve_channel_group_selection || return 1
      do_provision || return 1
    else
      return 1
    fi
  fi
  return 0
}

# ----------------------------- 参数解析 --------------------------------------

API_KEY=""          # 最终写入配置的 API Key
SHOW_ONLY=0         # 是否只查看当前配置
TARGETS=""          # 要配置的客户端列表；交互模式下默认选择 Codex
FORCE_OVERWRITE=0   # 是否备份后完整覆盖 Codex config.toml
CODEX_BACKUP_PATH="" # --force 生成的备份路径，供完成提示展示

# 账号链路相关参数。密码只接受环境变量 STALLIONX_PASSWORD 传入，
# 不提供命令行参数：命令行参数会进入 shell 历史记录和 ps 输出。
KEY_SOURCE=""            # 获取 Key 的方式：existing / session / login / register / manual
ACCOUNT_INPUT=""         # 登录账号（用户名或邮箱），注册时作为用户名
EMAIL_INPUT=""           # 注册邮箱
INVITE_CODE_INPUT=""     # 邀请码（分销推荐关系）
TOKEN_NAME_INPUT=""      # 自定义令牌名称，留空则由服务端使用默认名称
ACCOUNT_BALANCE=""       # 开通接口返回的账号余额，用于结尾提示
LOGOUT_ONLY=0            # 是否只清除本地登录缓存
BASE_URL_FROM_ARG=0      # API 地址是否由 --base-url 显式指定（指定后不再交互询问）
CHANNEL_GROUPS_INPUT=""          # --channel-groups 显式指定的渠道分组编码（逗号分隔）
SELECTED_CHANNEL_GROUP_IDS=""    # resolve_channel_group_selection 解析出的分组 ID（逗号分隔）

while [ $# -gt 0 ]; do
  case "$1" in
    -k|--key)
      # 非交互式传入 Key，需要跟一个参数值
      if [ $# -lt 2 ] || [ -z "$2" ]; then
        error "--key 需要提供一个非空的 API Key。"
        exit 1
      fi
      API_KEY="$2"
      shift 2
      ;;
    --key=*)
      API_KEY="${1#--key=}"
      shift
      ;;
    -t|--targets)
      if [ $# -lt 2 ] || [ -z "$2" ]; then
        error "--targets 需要提供客户端列表。"
        exit 1
      fi
      TARGETS="$2"
      shift 2
      ;;
    --targets=*)
      TARGETS="${1#--targets=}"
      shift
      ;;
    -s|--show)
      SHOW_ONLY=1
      shift
      ;;
    -f|--force)
      FORCE_OVERWRITE=1
      shift
      ;;
    --login)
      # 跳过选择菜单，直接走登录流程
      KEY_SOURCE="login"
      shift
      ;;
    --register)
      # 跳过选择菜单，直接走注册流程
      KEY_SOURCE="register"
      shift
      ;;
    --manual-key)
      # 保留旧行为：手动粘贴已有 Key
      KEY_SOURCE="manual"
      shift
      ;;
    --email)
      if [ $# -lt 2 ] || [ -z "$2" ]; then
        error "--email 需要提供邮箱地址。"
        exit 1
      fi
      EMAIL_INPUT="$2"
      shift 2
      ;;
    --email=*)
      EMAIL_INPUT="${1#--email=}"
      shift
      ;;
    -u|--username)
      if [ $# -lt 2 ] || [ -z "$2" ]; then
        error "--username 需要提供账号。"
        exit 1
      fi
      ACCOUNT_INPUT="$2"
      shift 2
      ;;
    --username=*)
      ACCOUNT_INPUT="${1#--username=}"
      shift
      ;;
    --invite-code)
      if [ $# -lt 2 ] || [ -z "$2" ]; then
        error "--invite-code 需要提供邀请码。"
        exit 1
      fi
      INVITE_CODE_INPUT="$2"
      shift 2
      ;;
    --invite-code=*)
      INVITE_CODE_INPUT="${1#--invite-code=}"
      shift
      ;;
    --token-name)
      if [ $# -lt 2 ] || [ -z "$2" ]; then
        error "--token-name 需要提供令牌名称。"
        exit 1
      fi
      TOKEN_NAME_INPUT="$2"
      shift 2
      ;;
    --token-name=*)
      TOKEN_NAME_INPUT="${1#--token-name=}"
      shift
      ;;
    --channel-groups)
      if [ $# -lt 2 ] || [ -z "$2" ]; then
        error "--channel-groups 需要提供渠道分组编码（逗号分隔）。"
        exit 1
      fi
      CHANNEL_GROUPS_INPUT="$2"
      shift 2
      ;;
    --channel-groups=*)
      CHANNEL_GROUPS_INPUT="${1#--channel-groups=}"
      shift
      ;;
    --base-url)
      if [ $# -lt 2 ] || [ -z "$2" ]; then
        error "--base-url 需要提供服务地址。"
        exit 1
      fi
      BASE_URL="$2"
      BASE_URL_FROM_ARG=1
      shift 2
      ;;
    --base-url=*)
      BASE_URL="${1#--base-url=}"
      BASE_URL_FROM_ARG=1
      shift
      ;;
    --logout)
      LOGOUT_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      error "未知参数：$1"
      echo ""
      usage
      exit 1
      ;;
  esac
done

if [ "${SHOW_ONLY}" -eq 1 ] && [ "${FORCE_OVERWRITE}" -eq 1 ]; then
  error "--show 与 --force 不能同时使用。"
  exit 1
fi

# --base-url 可能带末尾斜杠，也可能被粘成 OpenAI 兼容地址（.../v1 之类），
# 统一削回站点根地址后再派生各客户端需要的地址：
#   - Codex 走 OpenAI 兼容协议，需要在根地址后补 /v1；
#   - Claude Code 走 Anthropic 原生协议，直接用根地址（客户端自己拼 /v1/messages）。
# 不归一化就会拼出 https://host//v1 或 https://host/v1/v1/messages 这类坏 URL。
BASE_URL="$(normalize_site_base_url "${BASE_URL}")"
CODEX_BASE_URL="${BASE_URL}/v1"
ANTHROPIC_BASE_URL="${BASE_URL}"

# --logout：只清除本地登录缓存，不触碰任何客户端配置
if [ "${LOGOUT_ONLY}" -eq 1 ]; then
  clear_credentials
  ok "已清除本地登录缓存：${CREDENTIAL_FILE}"
  exit 0
fi

# 未指定 --targets 时提供交互选择；非交互终端直接采用默认的 Codex。
if [ "${SHOW_ONLY}" -eq 0 ] && [ -z "${TARGETS}" ]; then
  if [ -t 0 ]; then
    TARGETS="$(select_targets_interactively)"
  else
    TARGETS="codex"
  fi
fi

if [ "${SHOW_ONLY}" -eq 0 ]; then
  TARGETS="$(normalize_targets "${TARGETS}")" || exit 1
  if [ "${FORCE_OVERWRITE}" -eq 1 ] && ! is_target_selected "codex"; then
    warn "--force 仅影响 Codex config.toml；当前未选择 codex，不会执行强制覆盖。"
  fi

  # 显式 --force 直接沿用命令行选择；交互模式只有在旧配置确实存在时才询问，首次安装
  # 不展示无意义的覆盖问题。非交互环境保持普通模式，确保自动化调用不会等待输入。
  if [ "${FORCE_OVERWRITE}" -eq 0 ] \
    && is_target_selected "codex" \
    && [ -f "${CODEX_CONFIG}" ] \
    && has_tty; then
    if prompt_codex_force_overwrite; then
      FORCE_OVERWRITE=1
      info "已选择强制覆盖；写入前会先备份 ${CODEX_CONFIG}。"
    else
      info "已选择普通模式；将保留 Codex 的其他本地配置。"
    fi
  fi
fi

# ----------------------------- 读取 API Key ----------------------------------

# 探测已有配置（用于展示当前 Key、支持"回车保留"）
EXISTING_KEY="$(detect_existing_key || true)"

# --show 模式：只展示当前配置状态，不做任何修改
if [ "${SHOW_ONLY}" -eq 1 ]; then
  if [ -n "${EXISTING_KEY}" ]; then
    ok "已检测到 ${PROVIDER_NAME} 配置"
    echo "  当前 API Key：$(mask_key "${EXISTING_KEY}")"
    echo "  API 地址：    $(detect_existing_base_url || printf '%s' "${BASE_URL}")"
    echo "  Codex 模型：  $(detect_existing_model || printf '%s' "${DEFAULT_CODEX_MODEL}（未配置）")"
    SHOWN_CATALOG="$(detect_existing_model_catalog || true)"
    [ -n "${SHOWN_CATALOG}" ] && echo "  Codex 模型目录：${SHOWN_CATALOG}"
    SHOWN_PROFILES="$(list_managed_codex_profiles 2>/dev/null | paste -sd ',' - | sed 's/,/, /g' || true)"
    if [ -n "${SHOWN_PROFILES}" ]; then
      echo "  Codex 可切换模型（codex -p <名称>）：${SHOWN_PROFILES}"
    else
      echo "  Codex 可切换模型：尚未生成，重新执行 bash install.sh 会按 /v1/models 生成 profiles"
    fi
    echo ""
    echo "如需修改 Key，执行：bash install.sh"
  else
    warn "尚未检测到 ${PROVIDER_NAME} 配置，请执行 bash install.sh 进行首次配置。"
  fi
  exit 0
fi

# 未用 --base-url 指定时，在交互模式下确认一次 API 地址：
# 服务可能部署在多个站点，写死单一地址会让其他部署的用户无从下手。
# 非交互环境保持原样使用默认值，不阻断自动化脚本。
if [ "${BASE_URL_FROM_ARG}" -eq 0 ] && has_tty; then
  BASE_URL="$(select_base_url_interactively "$(detect_existing_base_url || printf '%s' "${BASE_URL}")")"
  CODEX_BASE_URL="${BASE_URL}/v1"
  ANTHROPIC_BASE_URL="${BASE_URL}"
fi

info "开始配置 ${PROVIDER_NAME} 第三方 API"
info "本次选择的客户端：${TARGETS}"
info "API 地址：${BASE_URL}"
echo ""

# 仅在未通过 --key 指定时才需要决定 Key 的来源
if [ -z "${API_KEY}" ]; then
  # 本地缓存的登录令牌若仍在有效期内，可直接用于开通，省掉一次登录
  load_credentials || true

  # 未通过 --login/--register/--manual-key 指定来源时决定走哪条路径：
  # 有终端就弹菜单让用户选；无终端（CI、批量装机）则按已提供的参数推断，
  # 推断不出来时给出可直接照抄的命令，而不是抛一句「Key 不能为空」。
  if [ -z "${KEY_SOURCE}" ]; then
    if has_tty; then
      select_key_source_interactively
    elif [ -n "${STALLIONX_JWT}" ]; then
      KEY_SOURCE="session"
    elif [ -n "${EMAIL_INPUT}" ]; then
      KEY_SOURCE="register"
    elif [ -n "${ACCOUNT_INPUT}" ] && [ -n "${STALLIONX_PASSWORD:-}" ]; then
      KEY_SOURCE="login"
    elif [ -n "${EXISTING_KEY}" ]; then
      KEY_SOURCE="existing"
    else
      error "未提供 API Key，且当前环境无法交互。请任选一种非交互方式："
      error "  bash install.sh --key <API_KEY>"
      error "  STALLIONX_PASSWORD=<密码> bash install.sh --login --username <账号>"
      error "  STALLIONX_PASSWORD=<密码> bash install.sh --register --email <邮箱>"
      exit 1
    fi
  fi

  case "${KEY_SOURCE}" in
    existing)
      if [ -z "${EXISTING_KEY}" ]; then
        error "本机没有检测到已配置的 API Key。"
        exit 1
      fi
      API_KEY="${EXISTING_KEY}"
      info "沿用当前 Key，并重新同步所选客户端的配置。"
      ;;
    session|login|register)
      # 账号链路：登录或注册拿到 JWT，再换取可用的 API Key
      acquire_key_via_account "${KEY_SOURCE}" || exit 1
      ;;
    manual)
      if [ -n "${EXISTING_KEY}" ]; then
        # 已配置过：展示掩码后的当前 Key，允许直接回车保留
        info "检测到已有配置：${ENV_KEY_NAME} = $(mask_key "${EXISTING_KEY}")"
        prompt_secret API_KEY "请输入新的 ${PROVIDER_NAME} API Key（输入不会显示；直接回车保留当前 Key）："
      else
        prompt_secret API_KEY "请输入你的 ${PROVIDER_NAME} API Key（输入不会显示）："
      fi

      # 输入为空时：已有配置则沿用旧 Key（可用于修复配置不同步），否则报错退出
      if [ -z "${API_KEY}" ]; then
        if [ -n "${EXISTING_KEY}" ]; then
          API_KEY="${EXISTING_KEY}"
          info "未输入新 Key，将沿用当前 Key 并重新同步各处配置。"
        else
          error "API Key 不能为空，已退出。"
          exit 1
        fi
      fi
      ;;
    *)
      error "未知的 Key 获取方式：${KEY_SOURCE}"
      exit 1
      ;;
  esac
fi

# 最终兜底校验，避免把空值写进配置文件
if [ -z "${API_KEY}" ]; then
  error "API Key 不能为空，已退出。"
  exit 1
fi

# 提示本次将要写入的 Key（掩码），便于用户确认是否改对了
if [ -n "${EXISTING_KEY}" ] && [ "${API_KEY}" != "${EXISTING_KEY}" ]; then
  info "API Key 将由 $(mask_key "${EXISTING_KEY}") 更新为 $(mask_key "${API_KEY}")"
else
  info "本次写入的 API Key：$(mask_key "${API_KEY}")"
fi
echo ""

# ======================= 第一部分：配置 Claude Code ===========================

# 合并写入 Claude 协议兼容客户端的 settings.json：
# 优先使用 python3 / node 做 JSON 合并，保留用户已有的其他配置项；
# 两者都不存在时，仅在文件不存在的情况下写入全新配置。
#
# 写入的是 Anthropic 原生链路：ANTHROPIC_BASE_URL 为站点根地址，Claude Code
# 会自己请求 <根地址>/v1/messages。同时清掉 env 中会让客户端绕开这条链路的开关
# （Bedrock / Vertex 开关、与 ANTHROPIC_AUTH_TOKEN 冲突的 ANTHROPIC_API_KEY），
# 否则请求会转到别的网关或带着旧凭据发出，cache_control 与 anthropic-beta 也就
# 不可能原样透传到上游。
write_anthropic_settings() {
  local settings_path="$1"
  if command -v python3 >/dev/null 2>&1; then
    # 使用 python3 合并 JSON（通过环境变量传参，避免 Key 出现在命令行参数中）
    SETTINGS_PATH="${settings_path}" SX_BASE_URL="${ANTHROPIC_BASE_URL}" SX_API_KEY="${API_KEY}" \
    python3 <<'PYEOF'
import json
import os
import sys

path = os.environ["SETTINGS_PATH"]
data = {}
# 已有配置则读入，做合并而不是覆盖
if os.path.exists(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception as e:
        # 异常时输出错误日志并终止，避免损坏用户配置
        print(f"[错误] 解析 {path} 失败: {e}", file=sys.stderr)
        sys.exit(1)

env = data.setdefault("env", {})
env["ANTHROPIC_BASE_URL"] = os.environ["SX_BASE_URL"]
env["ANTHROPIC_AUTH_TOKEN"] = os.environ["SX_API_KEY"]

# 这些键会让 Claude Code 不再按 ANTHROPIC_BASE_URL 直连原生 /v1/messages
removed = [k for k in (
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "ANTHROPIC_BEDROCK_BASE_URL",
    "ANTHROPIC_VERTEX_BASE_URL",
) if k in env]
for key in removed:
    del env[key]
if removed:
    print("已移除会绕开原生端点的配置项：" + "、".join(removed))

with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
PYEOF
  elif command -v node >/dev/null 2>&1; then
    # 无 python3 时退回使用 node 合并 JSON
    SETTINGS_PATH="${settings_path}" SX_BASE_URL="${ANTHROPIC_BASE_URL}" SX_API_KEY="${API_KEY}" \
    node <<'JSEOF'
const fs = require("fs");
const path = process.env.SETTINGS_PATH;
let data = {};
if (fs.existsSync(path)) {
  try {
    data = JSON.parse(fs.readFileSync(path, "utf-8"));
  } catch (e) {
    // 异常时输出错误日志并终止，避免损坏用户配置
    console.error(`[错误] 解析 ${path} 失败: ${e.message}`);
    process.exit(1);
  }
}
data.env = data.env || {};
data.env.ANTHROPIC_BASE_URL = process.env.SX_BASE_URL;
data.env.ANTHROPIC_AUTH_TOKEN = process.env.SX_API_KEY;
// 这些键会让 Claude Code 不再按 ANTHROPIC_BASE_URL 直连原生 /v1/messages
const removed = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "ANTHROPIC_VERTEX_BASE_URL",
].filter((key) => key in data.env);
for (const key of removed) {
  delete data.env[key];
}
if (removed.length > 0) {
  console.log(`已移除会绕开原生端点的配置项：${removed.join("、")}`);
}
fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
JSEOF
  else
    # 既无 python3 也无 node：仅当文件不存在时才直接写入，避免覆盖已有配置
    if [ -f "${settings_path}" ]; then
      error "未找到 python3 或 node，无法安全合并已有的 ${settings_path}。"
      error "请手动在该文件的 env 块中添加："
      error "  \"ANTHROPIC_BASE_URL\": \"${ANTHROPIC_BASE_URL}\""
      error "  \"ANTHROPIC_AUTH_TOKEN\": \"<你的 API Key>\""
      return 1
    fi
    cat > "${settings_path}" <<JSONEOF
{
  "env": {
    "ANTHROPIC_BASE_URL": "${ANTHROPIC_BASE_URL}",
    "ANTHROPIC_AUTH_TOKEN": "${API_KEY}"
  }
}
JSONEOF
  fi
}

# 探测站点是否真的提供 Anthropic 原生端点 <根地址>/v1/messages。
# 故意只发一个空 JSON：鉴权发生在请求体校验之前，所以状态码足以区分三种情况——
#   404 / 405 / 501  站点没有这个端点，Claude Code 无法直连原生协议；
#   401 / 403        端点存在，但当前 Key 没通过鉴权；
#   其他             端点可达且鉴权通过（空请求体被判 400 属于预期结果）。
# 刻意不发真实对话请求，避免为一次探测消耗账号额度。
verify_anthropic_native_endpoint() {
  local url="${ANTHROPIC_BASE_URL}/v1/messages" status="" status_file=""

  if ! command -v curl >/dev/null 2>&1; then
    warn "未找到 curl，跳过 Anthropic 原生端点探测。"
    return 0
  fi

  status_file="$(mktemp)"
  # 通过 stdin 传递请求头，避免 API Key 出现在 curl 的命令行参数中。
  if ! curl --silent --show-error --location --max-time 20 \
    --request POST --data-binary '{}' \
    --output /dev/null --write-out '%{http_code}' \
    --config - "${url}" > "${status_file}" 2>/dev/null <<CURLEOF
header = "x-api-key: ${API_KEY}"
header = "anthropic-version: 2023-06-01"
header = "anthropic-beta: prompt-caching-2024-07-31"
header = "Content-Type: application/json"
CURLEOF
  then
    rm -f "${status_file}"
    warn "无法连接 ${url}，本次跳过原生端点探测；请确认网络后重新执行本脚本。"
    return 0
  fi

  status="$(cat "${status_file}" 2>/dev/null || true)"
  rm -f "${status_file}"

  case "${status}" in
    404|405|501)
      error "${url} 未提供 Anthropic 原生端点（HTTP ${status}）。"
      error "只有直连该端点才能把 cache_control 标注和 anthropic-beta 头原样送到上游，请确认 API 地址填写是否正确。"
      return 1
      ;;
    401|403)
      warn "${url} 可达，但当前 API Key 未通过鉴权（HTTP ${status}）；请确认 Key 是否有效。"
      return 0
      ;;
    "")
      warn "未取到 ${url} 的响应状态码，本次跳过原生端点探测。"
      return 0
      ;;
    *)
      ok "已确认 Anthropic 原生端点可用：${url}"
      return 0
      ;;
  esac
}

CLAUDE_NATIVE_READY=0   # Claude Code 的原生端点是否探测通过，决定完成提示的措辞

if is_target_selected "claude"; then
  info "正在配置 Claude Code（${CLAUDE_SETTINGS}）..."
  mkdir -p "${HOME}/.claude"
  if write_anthropic_settings "${CLAUDE_SETTINGS}"; then
    # settings.json 里保存的是长期有效的 API Key，权限收紧到 600。
    chmod 600 "${CLAUDE_SETTINGS}" 2>/dev/null || true
    # 先探测端点再下结论：地址填错时不该让用户先看到一句无条件的“配置完成”。
    # 探测失败也不阻断整体安装，配置已经写好，用户改对地址后重跑即可。
    if verify_anthropic_native_endpoint; then
      ok "Claude Code 配置完成（Anthropic 原生协议，直连 ${ANTHROPIC_BASE_URL}/v1/messages）。"
      CLAUDE_NATIVE_READY=1
    else
      warn "配置已写入 ${CLAUDE_SETTINGS}，但原生端点当前不可用；请换用正确的 API 地址后重新执行本脚本。"
    fi
  else
    error "Claude Code 配置未完成，请按上面的提示手动处理。"
  fi
fi

generate_codebuddy_models() {
  local models_response="$(mktemp)"
  mkdir -p "${HOME}/.codebuddy"
  if ! command -v curl >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
    error "生成 CodeBuddy 模型配置需要 curl 和 python3。"
    rm -f "${models_response}"
    return 1
  fi
  if ! curl --fail --silent --show-error --location --max-time 20 --config - \
    --output "${models_response}" "${CODEX_BASE_URL}/models" <<CURLEOF
header = "Authorization: Bearer ${API_KEY}"
header = "Accept: application/json"
CURLEOF
  then
    error "获取 StallionX 模型列表失败，请检查网络、API Key 和服务状态。"
    rm -f "${models_response}"
    return 1
  fi
  SX_RESPONSE_PATH="${models_response}" SX_API_KEY="${API_KEY}" SX_OUTPUT_PATH="${CODEBUDDY_MODELS_FILE}" SX_URL="${CODEX_BASE_URL}/chat/completions" \
    python3 <<'PYEOF'
import json as json_module
import os as os_module
import sys as sys_module
response_path = os_module.environ["SX_RESPONSE_PATH"]
output_path = os_module.environ["SX_OUTPUT_PATH"]
try:
    with open(response_path, "r", encoding="utf-8") as response_file:
        payload = json_module.load(response_file)
    items = payload.get("data", []) if isinstance(payload, dict) else []
    ids = sorted({item.get("id") for item in items if isinstance(item, dict) and item.get("id")})
    if not ids:
        raise ValueError("/v1/models 未返回有效模型")
    result = {"models": [{
        "id": model_id,
        "name": model_id,
        "vendor": "StallionX",
        "url": os_module.environ["SX_URL"],
        # CodeBuddy 官方支持 ${VAR_NAME} 引用，避免把明文 Key 写入 models.json。
        "apiKey": "${STALLIONX_API_KEY}",
        "supportsToolCall": True,
        "supportsImages": "image" in model_id.lower(),
        "supportsReasoning": True,
    } for model_id in ids]}
    with open(output_path, "w", encoding="utf-8") as output_file:
        json_module.dump(result, output_file, ensure_ascii=False, indent=2)
        output_file.write("\n")
except (OSError, ValueError, TypeError) as error:
    print(f"[错误] 生成 CodeBuddy models.json 失败: {error}", file=sys_module.stderr)
    sys_module.exit(1)
PYEOF
  local status=$?
  rm -f "${models_response}"
  [ "${status}" -eq 0 ] || return 1
  chmod 600 "${CODEBUDDY_MODELS_FILE}"
}

if is_target_selected "codebuddy"; then
  info "正在生成 CodeBuddy 模型配置（${CODEBUDDY_MODELS_FILE}）..."
  if generate_codebuddy_models; then
    ok "CodeBuddy 模型配置完成。"
  else
    error "CodeBuddy 配置未完成，请查看上面的错误日志。"
    exit 1
  fi
fi

# WorkBuddy 使用 ~/.workbuddy/models.json，并同时兼容顶层数组与 models 包装对象。
# 这里按 WorkBuddy 自身设置界面生成的顶层数组格式写入，避免与 CodeBuddy 的
# chat/completions 完整 URL 格式混用。
generate_workbuddy_models() {
  local models_response="$(mktemp)"
  mkdir -p "${HOME}/.workbuddy"
  if ! command -v curl >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
    error "生成 WorkBuddy 模型配置需要 curl 和 python3。"
    rm -f "${models_response}"
    return 1
  fi
  if ! curl --fail --silent --show-error --location --max-time 20 --config - \
    --output "${models_response}" "${CODEX_BASE_URL}/models" <<CURLEOF
header = "Authorization: Bearer ${API_KEY}"
header = "Accept: application/json"
CURLEOF
  then
    error "获取 StallionX 模型列表失败，请检查网络、API Key 和服务状态。"
    rm -f "${models_response}"
    return 1
  fi
  SX_RESPONSE_PATH="${models_response}" SX_API_KEY="${API_KEY}" \
    SX_OUTPUT_PATH="${WORKBUDDY_MODELS_FILE}" SX_URL="${CODEX_BASE_URL}" \
    python3 <<'PYEOF'
import json as json_module
import os as os_module
import sys as sys_module

response_path = os_module.environ["SX_RESPONSE_PATH"]
output_path = os_module.environ["SX_OUTPUT_PATH"]
try:
    with open(response_path, "r", encoding="utf-8") as response_file:
        payload = json_module.load(response_file)
    items = payload.get("data", []) if isinstance(payload, dict) else []
    model_ids = sorted({
        item.get("id")
        for item in items
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item.get("id")
    })
    if not model_ids:
        raise ValueError("/v1/models 未返回有效模型")
    models = [{
        "id": model_id,
        "name": model_id,
        "vendor": "StallionX",
        "url": os_module.environ["SX_URL"],
        # WorkBuddy 当前直接从 models.json 读取凭据，不依赖 shell 环境变量展开。
        "apiKey": os_module.environ["SX_API_KEY"],
        "supportsToolCall": True,
        "supportsImages": True,
        "supportsReasoning": True,
        "useCustomProtocol": False,
    } for model_id in model_ids]
    with open(output_path, "w", encoding="utf-8") as output_file:
        json_module.dump(models, output_file, ensure_ascii=False, indent=2)
        output_file.write("\n")
except (OSError, ValueError, TypeError) as error:
    # 网络响应解析或配置写入异常必须输出错误日志，方便定位问题。
    print(f"[错误] 生成 WorkBuddy models.json 失败: {error}", file=sys_module.stderr)
    sys_module.exit(1)
PYEOF
  local status=$?
  rm -f "${models_response}"
  [ "${status}" -eq 0 ] || return 1
  chmod 600 "${WORKBUDDY_MODELS_FILE}"
}

if is_target_selected "workbuddy"; then
  info "正在生成 WorkBuddy 模型配置（${WORKBUDDY_MODELS_FILE}）..."
  if generate_workbuddy_models; then
    ok "WorkBuddy 模型配置完成。"
  else
    error "WorkBuddy 配置未完成，请查看上面的错误日志。"
    exit 1
  fi
fi

# ========================== 第二部分：生成 Trae 配置 =========================

# Trae 官方支持在 Settings > Models 中添加 OpenAI Compatible 自定义模型，
# 但没有公开稳定的配置文件导入格式。因此这里从 StallionX 实时获取账号支持的
# 全部模型，生成结构化清单和操作说明，供用户导入（若后续版本支持）或逐项添加。
generate_trae_models() {
  local models_response
  mkdir -p "${TRAE_CONFIG_DIR}"

  if ! command -v curl >/dev/null 2>&1; then
    error "获取 Trae 模型清单需要 curl，但当前环境未找到该命令。"
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    error "生成 Trae 模型清单需要 python3，但当前环境未找到该命令。"
    return 1
  fi

  models_response="$(mktemp)"
  # 通过 stdin 传递鉴权头，避免 API Key 出现在 curl 的命令行参数中。
  if ! curl --fail --silent --show-error --location --max-time 20 \
    --config - --output "${models_response}" "${CODEX_BASE_URL}/models" <<CURLEOF
header = "Authorization: Bearer ${API_KEY}"
header = "Accept: application/json"
CURLEOF
  then
    error "获取 StallionX 模型列表失败，请检查网络、API Key 和服务状态。"
    rm -f "${models_response}"
    return 1
  fi

  SX_RESPONSE_PATH="${models_response}" SX_API_KEY="${API_KEY}" \
    SX_BASE_URL="${CODEX_BASE_URL}" SX_OUTPUT_PATH="${TRAE_MODELS_FILE}" \
    python3 <<'PYEOF'
import json as json_module
import os as os_module
import sys as sys_module

api_key = os_module.environ["SX_API_KEY"]
base_url = os_module.environ["SX_BASE_URL"]
output_path = os_module.environ["SX_OUTPUT_PATH"]
response_path = os_module.environ["SX_RESPONSE_PATH"]

try:
    with open(response_path, "r", encoding="utf-8") as response_file:
        payload = json_module.load(response_file)
except (OSError, ValueError) as error:
    # 解析异常时输出错误日志，避免生成空的或具有误导性的模型清单。
    print(f"[错误] 解析 StallionX 模型列表失败: {error}", file=sys_module.stderr)
    sys_module.exit(1)

items = payload.get("data", []) if isinstance(payload, dict) else []
model_ids = sorted(
    {
        item.get("id")
        for item in items
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item.get("id")
    }
)
if not model_ids:
    print("[错误] StallionX /v1/models 未返回有效模型。", file=sys_module.stderr)
    sys_module.exit(1)

config = {
    "description": "Trae 自定义模型配置清单；请在 Settings > Models 中导入或逐项添加。",
    "provider": "StallionX",
    "api_format": "OpenAI Compatible",
    "base_url": base_url,
    "full_url": False,
    "api_key": api_key,
    "models": [
        {"model_id": model_id, "multimodal": True}
        for model_id in model_ids
    ],
}

try:
    with open(output_path, "w", encoding="utf-8") as output_file:
        json_module.dump(config, output_file, ensure_ascii=False, indent=2)
        output_file.write("\n")
except OSError as error:
    # 写入异常必须输出错误日志，方便定位权限或磁盘问题。
    print(f"[错误] 写入 Trae 模型清单失败: {error}", file=sys_module.stderr)
    sys_module.exit(1)
PYEOF
  if [ $? -ne 0 ]; then
    rm -f "${models_response}"
    return 1
  fi
  rm -f "${models_response}"

  if ! chmod 600 "${TRAE_MODELS_FILE}"; then
    error "设置 ${TRAE_MODELS_FILE} 文件权限失败。"
    return 1
  fi
  cat > "${TRAE_GUIDE_FILE}" <<GUIDEEOF
# Trae 使用 StallionX 模型

模型清单位于：\`${TRAE_MODELS_FILE}\`。

Trae 当前未公开稳定的配置文件导入格式。如果你的版本提供“导入配置”，请选择上面的 JSON 文件；否则请按以下步骤逐项添加：

1. 打开 Trae 的 \`Settings > Models\`。
2. 点击 \`Add Model\`，选择 \`Custom configuration\`。
3. API Format 选择 \`OpenAI Compatible\`。
4. 关闭 \`Full URL\`，Base URL 填写 \`${CODEX_BASE_URL}\`。
5. 从 \`models.json\` 的 \`models\` 列表复制每个 \`model_id\`。
6. API Key 使用 \`models.json\` 中的 \`api_key\`。

\`models.json\` 包含明文 API Key，文件权限已设置为仅当前用户可读写（600）。
GUIDEEOF
  if ! chmod 600 "${TRAE_GUIDE_FILE}"; then
    error "设置 ${TRAE_GUIDE_FILE} 文件权限失败。"
    return 1
  fi
}

if is_target_selected "trae"; then
  info "正在获取模型并生成 Trae 配置清单（${TRAE_MODELS_FILE}）..."
  if generate_trae_models; then
    ok "Trae 模型配置清单已生成：${TRAE_MODELS_FILE}"
    ok "Trae 导入/添加说明已生成：${TRAE_GUIDE_FILE}"
  else
    error "Trae 配置清单生成失败，请查看上面的错误日志。"
    exit 1
  fi
fi

# ========================== 第二部分（续）：配置 pi ============================

# pi（pi coding agent，https://github.com/badlogic/pi-mono）通过 ~/.pi/agent/models.json
# 的 providers 段接入自定义 provider。这里按 StallionX /v1/models 生成两个 provider：
#   - <PROVIDER_ID>：OpenAI 兼容入口（根地址 + /v1）。provider 级 api 为 chat completions，
#     GPT-5 / GPT-6 / o 系列 / codex 模型在模型级覆盖为 openai-responses，与 Codex 走同一条链路；
#   - <PROVIDER_ID>-anthropic：只放 Claude 模型，api 为 anthropic-messages，baseUrl 是站点
#     根地址（pi 内部用 Anthropic SDK，自己拼 /v1/messages）。和 Claude Code 一样，只有原生
#     链路能把 cache_control 与 anthropic-beta 原样透传，Prompt Caching 才有效。
# 文件里用户自己加的其他 provider 一律保留，只覆盖这两个 id；解析失败的旧文件先备份再重建。
# pi 会在打开 /model 菜单时重新读取该文件，不需要重启。
generate_pi_models() {
  local models_response backup_path

  if ! command -v curl >/dev/null 2>&1; then
    error "生成 pi 模型配置需要 curl，但当前环境未找到该命令。"
    return 1
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    error "生成 pi 模型配置需要 python3，但当前环境未找到该命令。"
    return 1
  fi
  if ! mkdir -p "${PI_CONFIG_DIR}"; then
    error "创建目录 ${PI_CONFIG_DIR} 失败。"
    return 1
  fi

  models_response="$(mktemp)"
  # 通过 stdin 传递鉴权头，避免 API Key 出现在 curl 的命令行参数中。
  if ! curl --fail --silent --show-error --location --max-time 20 \
    --config - --output "${models_response}" "${CODEX_BASE_URL}/models" <<CURLEOF
header = "Authorization: Bearer ${API_KEY}"
header = "Accept: application/json"
CURLEOF
  then
    error "获取 StallionX 模型列表失败，请检查网络、API Key 和服务状态。"
    rm -f "${models_response}"
    return 1
  fi

  # 旧文件不是合法 JSON 对象时先备份，避免把用户手改坏的文件静默覆盖掉。
  backup_path="${PI_MODELS_FILE}.backup-$(date +%Y%m%d-%H%M%S)"
  SX_RESPONSE_PATH="${models_response}" SX_API_KEY="${API_KEY}" \
    SX_BASE_URL="${BASE_URL}" SX_OUTPUT_PATH="${PI_MODELS_FILE}" \
    SX_BACKUP_PATH="${backup_path}" SX_PROVIDER_NAME="${PROVIDER_NAME}" \
    SX_PROVIDER_ID="${PI_PROVIDER_ID}" SX_ANTHROPIC_PROVIDER_ID="${PI_ANTHROPIC_PROVIDER_ID}" \
    python3 <<'PYEOF'
import json as json_module
import os as os_module
import re as re_module
import shutil as shutil_module
import sys as sys_module

api_key = os_module.environ["SX_API_KEY"]
base_url = os_module.environ["SX_BASE_URL"].rstrip("/")
output_path = os_module.environ["SX_OUTPUT_PATH"]
backup_path = os_module.environ["SX_BACKUP_PATH"]
response_path = os_module.environ["SX_RESPONSE_PATH"]
provider_name = os_module.environ["SX_PROVIDER_NAME"]
provider_id = os_module.environ["SX_PROVIDER_ID"]
anthropic_provider_id = os_module.environ["SX_ANTHROPIC_PROVIDER_ID"]

try:
    with open(response_path, "r", encoding="utf-8") as response_file:
        payload = json_module.load(response_file)
except (OSError, ValueError) as error:
    # 解析异常时输出错误日志，避免生成空的或具有误导性的模型清单。
    print(f"[错误] 解析 StallionX 模型列表失败: {error}", file=sys_module.stderr)
    sys_module.exit(1)

items = payload.get("data", []) if isinstance(payload, dict) else []
# 与 Codex 目录同一套过滤口径：只保留对话模型，ID 字符集必须可安全写入配置。
model_ids = sorted(
    {
        item.get("id").strip()
        for item in items
        if isinstance(item, dict)
        and isinstance(item.get("id"), str)
        and re_module.match(r"^[A-Za-z0-9._:/-]+$", item.get("id").strip())
        and not re_module.search(r"image|embed|tts|whisper|audio|realtime|moderation", item.get("id"), re_module.I)
    }
)
if not model_ids:
    print("[错误] StallionX /v1/models 未返回可用于 pi 的对话模型。", file=sys_module.stderr)
    sys_module.exit(1)


def escape_secret(value):
    """pi 对 apiKey 做 $VAR 插值、! 前缀当作命令执行；字面量必须按其转义规则写入。"""
    escaped = value.replace("$", "$$")
    if escaped.startswith("!"):
        escaped = "$!" + escaped[1:]
    return escaped


def describe(model_id):
    """按模型 ID 推断 pi 需要的能力元数据；猜不准的字段留空让 pi 用默认值。"""
    lower = model_id.lower()
    is_claude = lower.startswith("claude")
    is_gpt5_family = bool(re_module.match(r"^gpt-[5-9]", lower))
    is_o_series = bool(re_module.match(r"^o[1-9]", lower))
    is_codex = "codex" in lower
    is_gemini = lower.startswith("gemini")
    entry = {"id": model_id, "name": model_id}
    if is_claude:
        entry["api"] = "anthropic-messages"
    elif is_gpt5_family or is_o_series or is_codex:
        # 与 Codex 一致走 Responses；其余模型沿用 provider 级的 chat completions。
        entry["api"] = "openai-responses"
    entry["reasoning"] = bool(
        is_claude or is_gpt5_family or is_o_series or is_codex
        or re_module.search(r"thinking|reason|(^|[-_/])r1", lower)
    )
    if is_claude or lower.startswith("gpt") or is_o_series or is_gemini or re_module.search(r"vision|[-_]vl", lower):
        entry["input"] = ["text", "image"]
    else:
        entry["input"] = ["text"]
    if is_claude:
        entry["contextWindow"], entry["maxTokens"] = 200000, 32000
    elif is_gpt5_family or is_codex:
        entry["contextWindow"], entry["maxTokens"] = 400000, 128000
    elif is_o_series:
        entry["contextWindow"], entry["maxTokens"] = 200000, 100000
    elif is_gemini:
        entry["contextWindow"], entry["maxTokens"] = 1000000, 65536
    return entry


claude_models, openai_models = [], []
for model_id in model_ids:
    entry = describe(model_id)
    if entry.get("api") == "anthropic-messages":
        entry.pop("api")
        claude_models.append(entry)
    else:
        openai_models.append(entry)

config = {}
if os_module.path.exists(output_path):
    try:
        with open(output_path, "r", encoding="utf-8") as existing_file:
            loaded = json_module.load(existing_file)
        if not isinstance(loaded, dict):
            raise ValueError("顶层不是 JSON 对象")
        config = loaded
    except (OSError, ValueError) as error:
        # 旧文件损坏时备份后重建，并输出告警让用户知道自己的手改内容去了哪里。
        print(f"[警告] {output_path} 不是合法的 pi 配置（{error}），已备份到 {backup_path} 后重建。", file=sys_module.stderr)
        try:
            shutil_module.copy2(output_path, backup_path)
        except OSError as copy_error:
            print(f"[错误] 备份旧的 pi 配置失败: {copy_error}", file=sys_module.stderr)
            sys_module.exit(1)
        config = {}

providers = config.get("providers")
if not isinstance(providers, dict):
    providers = {}
config["providers"] = providers

if openai_models:
    providers[provider_id] = {
        "name": provider_name,
        "baseUrl": f"{base_url}/v1",
        "api": "openai-completions",
        "apiKey": escape_secret(api_key),
        "models": openai_models,
    }
else:
    providers.pop(provider_id, None)
if claude_models:
    providers[anthropic_provider_id] = {
        "name": f"{provider_name} (Anthropic)",
        "baseUrl": base_url,
        "api": "anthropic-messages",
        "apiKey": escape_secret(api_key),
        "models": claude_models,
    }
else:
    # 站点已下线全部 Claude 模型时，同步移除旧的 Anthropic provider，避免菜单里留下失效项。
    providers.pop(anthropic_provider_id, None)

try:
    with open(output_path, "w", encoding="utf-8") as output_file:
        json_module.dump(config, output_file, ensure_ascii=False, indent=2)
        output_file.write("\n")
except OSError as error:
    # 写入异常必须输出错误日志，方便定位权限或磁盘问题。
    print(f"[错误] 写入 pi 模型配置失败: {error}", file=sys_module.stderr)
    sys_module.exit(1)

print(f"[信息] pi 模型：Anthropic 原生 {len(claude_models)} 个，OpenAI 兼容 {len(openai_models)} 个。")
PYEOF
  if [ $? -ne 0 ]; then
    rm -f "${models_response}"
    return 1
  fi
  rm -f "${models_response}"

  # models.json 含明文 API Key，收紧为仅当前用户可读写。
  if ! chmod 600 "${PI_MODELS_FILE}"; then
    error "设置 ${PI_MODELS_FILE} 文件权限失败。"
    return 1
  fi
}

if is_target_selected "pi"; then
  info "正在获取模型并生成 pi 配置（${PI_MODELS_FILE}）..."
  if generate_pi_models; then
    ok "pi 模型配置完成：${PI_MODELS_FILE}"
  else
    error "pi 配置未完成，请查看上面的错误日志。"
    exit 1
  fi
fi

# ========================== 第三部分：配置 Codex ==============================

if is_target_selected "codex"; then
info "正在配置 Codex（${CODEX_CONFIG}）..."

mkdir -p "${CODEX_DIR}"

# 先拉取模型并生成目录，再决定增量或强制写配置。强制模式下若目录生成失败会在备份和
# 覆盖前退出；普通模式则继续更新 provider，并保留已有目录与 profiles。
info "正在获取 ${PROVIDER_NAME} 模型列表，刷新 Codex 模型目录与 profiles..."
CODEX_CATALOG_READY=0
if CODEX_MODEL_IDS="$(fetch_codex_model_ids)"; then
  if generate_codex_model_catalog "${CODEX_MODEL_IDS}"; then
    CODEX_CATALOG_READY=1
    ok "已刷新 Codex 模型选择器目录：${CODEX_MODEL_CATALOG}"
  fi
  CODEX_PROFILE_NAMES="$(printf '%s\n' "${CODEX_MODEL_IDS}" | write_codex_profiles)"
  ok "已生成 $(printf '%s\n' "${CODEX_PROFILE_NAMES}" | grep -c .) 个 Codex profile（${CODEX_DIR}/<名称>.config.toml）"
else
  CODEX_MODEL_IDS=""
  warn "本次未能获取模型列表，跳过 Codex 模型目录与 profiles 刷新（已有文件原样保留）。"
fi

if [ "${FORCE_OVERWRITE}" -eq 1 ]; then
  if [ "${CODEX_CATALOG_READY}" -ne 1 ]; then
    error "--force 需要先成功生成 Codex 模型目录；旧 config.toml 未被覆盖。"
    exit 1
  fi
  if printf '%s\n' "${CODEX_MODEL_IDS}" | grep -qxF "${DEFAULT_CODEX_MODEL}"; then
    CODEX_MODEL="${DEFAULT_CODEX_MODEL}"
  else
    CODEX_MODEL="$(printf '%s\n' "${CODEX_MODEL_IDS}" | head -n 1)"
  fi
  CODEX_BACKUP_PATH="$(backup_codex_config)" || exit 1
  if [ -n "${CODEX_BACKUP_PATH}" ]; then
    ok "已备份原 Codex 配置：${CODEX_BACKUP_PATH}"
  fi
  write_forced_codex_config "${CODEX_MODEL}"
  chmod 600 "${CODEX_CONFIG}"
  ok "已强制覆盖 ${CODEX_CONFIG}"
else
  # 普通模式保留用户默认模型。只有模型目录未配置或已由本脚本管理时，才把选择器切到
  # 本次刷新的 StallionX 目录；自定义目录需由用户显式传 --force 才会替换。
  CODEX_MODEL="$(detect_existing_model || true)"
  if [ -n "${CODEX_MODEL}" ]; then
    info "保留 config.toml 中已有的模型配置：${CODEX_MODEL}"
  else
    if [ -n "${CODEX_MODEL_IDS}" ] && ! printf '%s\n' "${CODEX_MODEL_IDS}" | grep -qxF "${DEFAULT_CODEX_MODEL}"; then
      CODEX_MODEL="$(printf '%s\n' "${CODEX_MODEL_IDS}" | head -n 1)"
    else
      CODEX_MODEL="${DEFAULT_CODEX_MODEL}"
    fi
  fi
  CODEX_CATALOG_CONFIG=""
  EXISTING_CODEX_CATALOG="$(detect_existing_model_catalog || true)"
  if [ "${CODEX_CATALOG_READY}" -eq 1 ]; then
    if [ -z "${EXISTING_CODEX_CATALOG}" ] || is_managed_codex_catalog_path "${EXISTING_CODEX_CATALOG}"; then
      CODEX_CATALOG_CONFIG="${CODEX_MODEL_CATALOG}"
    else
      warn "保留自定义 model_catalog_json：${EXISTING_CODEX_CATALOG}；如需让 StallionX 模型覆盖选择器，请使用 --force。"
    fi
  fi
  # 凭据直接写入 experimental_bearer_token，避免当前 Codex 进程尚未重新加载环境变量。
  update_codex_config "${CODEX_CATALOG_CONFIG}"
  chmod 600 "${CODEX_CONFIG}"
  ok "已增量更新 ${CODEX_CONFIG}（其他用户配置已保留）"
fi

# 写入 auth.json 作为 Key 的本地备份。
# 注意：自定义 provider 不会使用 auth.json 完成请求鉴权；该文件仅用于备份。
cat > "${CODEX_AUTH}" <<AUTHEOF
{
  "OPENAI_API_KEY": "${API_KEY}"
}
AUTHEOF
chmod 600 "${CODEX_AUTH}"
ok "已写入 ${CODEX_AUTH}"
fi

# ==================== 第四部分：持久化环境变量 ================================

# 同步持久化环境变量，供终端中的其他兼容工具使用。Codex 本身直接从权限为
# 600 的 config.toml 读取凭据，因此不依赖当前进程是否已加载该环境变量。
# 使用成对标记包裹，方便重复执行时先删除旧块再写入新块。

if is_target_selected "codex" || is_target_selected "codebuddy"; then
info "正在写入环境变量到 ${PROFILE_FILE} ..."

touch "${PROFILE_FILE}"

# 若已有旧的 StallionX 配置块，先删除（保证脚本可重复执行，且修改 Key 时不会残留旧值）
if grep -qF "${MARK_BEGIN}" "${PROFILE_FILE}"; then
  # 使用 awk 删除标记之间的内容（sed 的地址语法在 BSD/GNU 上有差异，awk 更通用）
  awk -v begin="${MARK_BEGIN}" -v end="${MARK_END}" '
    $0 == begin { skip = 1; next }
    $0 == end   { skip = 0; next }
    !skip { print }
  ' "${PROFILE_FILE}" > "${PROFILE_FILE}.tmp" && mv "${PROFILE_FILE}.tmp" "${PROFILE_FILE}"
fi

# 追加新的配置块
cat >> "${PROFILE_FILE}" <<ENVEOF
${MARK_BEGIN}
export ${ENV_KEY_NAME}="${API_KEY}"
${MARK_END}
ENVEOF
ok "环境变量 ${ENV_KEY_NAME} 已写入 ${PROFILE_FILE}"
fi

# ----------------------------- 完成提示 --------------------------------------

echo ""
ok "全部配置完成！当前 API Key：$(mask_key "${API_KEY}")"
echo "已配置客户端：${TARGETS}"
[ -n "${STALLIONX_USERNAME}" ] && echo "当前账号：${STALLIONX_USERNAME}"

# 账号余额为 0 时配置虽然写好了，第一个请求仍会失败。这里把余额和充值入口
# 直接摆在完成提示里，避免用户以为是配置出了问题。
if [ -n "${ACCOUNT_BALANCE}" ]; then
  if [ "$(printf '%s' "${ACCOUNT_BALANCE}" | awk '{ print ($1 > 0) ? 1 : 0 }')" = "1" ]; then
    echo "账号余额：\$${ACCOUNT_BALANCE}"
  else
    warn "账号余额为 0，现在发起请求会被拒绝。请先充值：${BASE_URL}"
  fi
fi
echo ""
echo "后续步骤："
echo "  - 重新启动所选客户端，使其加载最新配置"
if is_target_selected "claude" && [ "${CLAUDE_NATIVE_READY}" -eq 1 ]; then
  echo "  - Claude Code 已固定走 Anthropic 原生协议，请求直达 ${ANTHROPIC_BASE_URL}/v1/messages"
  echo "    （cache_control 与 anthropic-beta 头原样透传；请勿把 ANTHROPIC_BASE_URL 改成带 /v1 的 OpenAI 兼容地址）"
fi
if is_target_selected "codex" || is_target_selected "codebuddy"; then
  echo "  - Codex 配置可即时生效；CodeBuddy 及其他终端工具读取环境变量时请执行：source ${PROFILE_FILE}"
fi
if is_target_selected "codex"; then
  if [ -f "${CODEX_MODEL_CATALOG}" ]; then
    echo "  - Codex 模型选择器已刷新；请完全退出并重新启动 Codex 后加载最新列表"
  fi
  DONE_PROFILES="$(list_managed_codex_profiles 2>/dev/null | paste -sd ',' - | sed 's/,/, /g' || true)"
  if [ -n "${DONE_PROFILES}" ]; then
    echo "  - Codex CLI 也可使用 codex -p <名称> 切换，可选："
    echo "      ${DONE_PROFILES}"
  fi
  [ -n "${CODEX_BACKUP_PATH}" ] && echo "  - 原 Codex 配置备份：${CODEX_BACKUP_PATH}"
fi
if is_target_selected "workbuddy"; then
  echo "  - WorkBuddy 请重启应用，以重新加载 ${WORKBUDDY_MODELS_FILE}"
fi
if is_target_selected "trae"; then
  echo "  - Trae：请打开 ${TRAE_GUIDE_FILE}，按说明导入或添加全部模型"
fi
if is_target_selected "pi"; then
  echo "  - pi：在 pi 里执行 /model 即可看到 ${PI_PROVIDER_ID} / ${PI_ANTHROPIC_PROVIDER_ID} 两个 provider 下的模型，无需重启"
  echo "    （Claude 模型走 Anthropic 原生协议直达 ${ANTHROPIC_BASE_URL}/v1/messages，其余走 ${CODEX_BASE_URL}）"
fi
echo ""
echo "以后想修改 API Key，重新执行 bash install.sh 即可（或 bash install.sh --key <新Key>）。"
if [ -n "${STALLIONX_JWT}" ]; then
  echo "本机已缓存登录状态（24 小时内免登录）；清除请执行：bash install.sh --logout"
fi
