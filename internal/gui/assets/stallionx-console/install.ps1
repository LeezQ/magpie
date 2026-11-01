<#
=============================================================================
 StallionX 一键配置脚本（Windows PowerShell）
=============================================================================
 功能：
   - 在终端内完成账号注册 / 登录，并自动开通一把可用的 API Key
   - 通过复选框按需配置 Codex、Claude Code、CodeBuddy、WorkBuddy、Trae 或 pi
   - Trae 会从 StallionX 获取账号支持的全部模型并生成导入/添加清单
   - pi（pi coding agent）合并写入 ~/.pi/agent/models.json 的 providers 段，保留其他 provider；
     Claude 模型走 Anthropic 原生协议，GPT-5 / o 系列 / codex 走 Responses，其余走 Chat Completions
   - 默认只配置 Codex，也支持通过 -Targets 进行非交互多选

 API 地址在交互模式下可确认或改写（服务可能部署在多个站点），回车即用默认值。
 新建令牌绑定的渠道分组同样可在交互模式下勾选，回车沿用账号默认分组；也可用
 -ChannelGroups 非交互指定。

 使用方式（在 PowerShell 中执行，Windows PowerShell 5.1 与 PowerShell 7 通用）：
   irm https://objectstorageapi.hzh.sealos.run/y1h1rhrc-shell/install.ps1 | iex   # 交互式：登录 / 注册 / 手动粘贴 Key

   需要传参时改用脚本块形式，参数跟在末尾（下文 <地址> 即上面的脚本地址）：
   & ([scriptblock]::Create((irm <地址>))) -Register              # 注册新账号并自动获取 Key
   & ([scriptblock]::Create((irm <地址>))) -Login                 # 登录已有账号并自动获取 Key
   & ([scriptblock]::Create((irm <地址>))) -Key <API_KEY>         # 非交互式指定 Key
   & ([scriptblock]::Create((irm <地址>))) -Targets "codex,claude" # 指定客户端
   & ([scriptblock]::Create((irm <地址>))) -Force                 # 备份后强制覆盖 Codex 配置
   & ([scriptblock]::Create((irm <地址>))) -Show                  # 仅查看当前 Key（掩码）

 文件编码：
   本文件必须保存为「无 BOM 的 UTF-8」。irm 会按响应头 charset=utf-8 解码，但不会剥掉
   BOM，BOM 变成字符 U+FEFF 留在文本开头，iex 会把它当成命令名，导致首行 <# 注释块
   无法识别、整段中文注释被当成代码解析报错。代价是 Windows PowerShell 5.1 用
   -File 直接运行下载到本地的文件时会按系统 ANSI 代码页读取而乱码，因此不再提供
   -File 用法；PowerShell 7（pwsh -File）默认 UTF-8，不受影响。

 修改 API Key：
   重新执行本脚本即可。脚本会自动检测已有配置并以掩码形式展示当前 Key，
   输入新 Key 覆盖；直接回车则保留当前 Key（用于修复配置不同步的情况）。

 说明：
   - 脚本可重复执行，重复执行会覆盖上一次写入的 StallionX 相关配置
   - Claude Code 固定走 Anthropic 原生协议：ANTHROPIC_BASE_URL 写站点根地址，
     由客户端自行请求 <根地址>/v1/messages。不走 OpenAI 兼容那条路，因为只有
     原生链路能把 cache_control 标注和 anthropic-beta 头原样带到上游
   - 普通模式保留 config.toml 中用户自定义的 model 与其他配置
   - -Force 会先备份旧 config.toml，再用 StallionX 配置完整覆盖
   - 每次执行都会按 StallionX /v1/models 刷新 Codex 模型目录与 profiles；
     重启 Codex 后，模型会出现在客户端模型选择器中
=============================================================================
#>

param(
    # 非交互式传入 API Key（适合自动化脚本调用）
    [string]$Key = "",
    # 指定要配置的客户端，支持 codex、claude、codebuddy、workbuddy、trae、pi（逗号分隔）
    [string]$Targets = "",
    # 仅查看当前已配置的 Key（掩码显示），不做任何修改
    [switch]$Show,
    # 仅影响 Codex：备份后完整覆盖 config.toml，清除冲突的本地配置
    [switch]$Force,
    # 直接走登录流程，跳过来源选择菜单
    [switch]$Login,
    # 直接走注册流程，跳过来源选择菜单
    [switch]$Register,
    # 手动粘贴已有的 API Key（旧版行为）
    [switch]$ManualKey,
    # 清除本机缓存的登录状态后退出
    [switch]$Logout,
    # 登录账号（用户名或邮箱）；注册时作为用户名
    [string]$Username = "",
    # 注册使用的邮箱，用于接收验证码
    [string]$Email = "",
    # 注册时绑定推荐人
    [string]$InviteCode = "",
    # 自定义生成的令牌名称，留空则由服务端使用默认名称
    [string]$TokenName = "",
    # 新建令牌要绑定的渠道分组编码，逗号分隔（如 reverse-won,official）；
    # 交互终端不传会弹出勾选列表（默认勾选账号的默认分组），非交互环境不传则只绑定默认分组
    [string]$ChannelGroups = "",
    # 指定服务地址（自建或测试环境使用）
    [string]$BaseUrlOverride = ""
)

# 出错即停止，避免半成品配置
$ErrorActionPreference = "Stop"

# ----------------------------- 基础常量定义 ----------------------------------

# Provider 名称与 API 地址（如需更换服务商，只需要改这里）
$ProviderName = "StallionX"
$ProviderId   = "stallionx"                      # Codex 配置中使用的 provider id（小写）
$BaseUrl      = "https://x.stallion-api.com"     # 基础地址（不带末尾斜杠）
$CodexBaseUrl = "$BaseUrl/v1"                    # Codex 走 OpenAI 兼容协议，需要 /v1 路径
# Claude Code 走 Anthropic 原生协议：客户端自己在 base 后面拼 /v1/messages，
# 所以这里必须是站点根地址。只有这条原生链路才能把 cache_control 标注和
# anthropic-beta 请求头原样送到上游；换成 OpenAI 兼容地址会被格式转换吃掉。
$AnthropicBaseUrl = $BaseUrl                     # Claude Code 走 Anthropic 原生协议，用站点根地址
$EnvKeyName   = "STALLIONX_API_KEY"              # Codex 读取 API Key 的环境变量名
$DefaultCodexModel = "gpt-5.6-sol"               # 首次安装时写入的默认模型
<#
 以无 BOM 的 UTF-8 写入文本文件，替代 Set-Content -Encoding UTF8。
 Windows PowerShell 5.1 的 Set-Content -Encoding UTF8 会在文件开头写 BOM（PowerShell 7 不会），
 而 WorkBuddy / CodeBuddy / Claude Code 的 JSON.parse、Codex 的 TOML 解析器遇到 BOM 会解析失败，
 客户端随之静默忽略整份配置。与 Set-Content 保持一致：数组按行拼接，末尾补一个换行。
#>
function Write-Utf8NoBomFile([string]$Path, $Value) {
    $text = (@($Value) | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    $encoding = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $text + [Environment]::NewLine, $encoding)
}

# 脚本发布地址，用于在提示中给出可直接复制的重新执行命令
$InstallerUrl = "https://objectstorageapi.hzh.sealos.run/y1h1rhrc-shell/install.ps1"

# 相关配置文件路径
$ClaudeDir      = Join-Path $env:USERPROFILE ".claude"
$ClaudeSettings = Join-Path $ClaudeDir "settings.json"
$CodeBuddyDir      = Join-Path $env:USERPROFILE ".codebuddy"
$CodeBuddyModelsFile = Join-Path $CodeBuddyDir "models.json"
$WorkBuddyDir      = Join-Path $env:USERPROFILE ".workbuddy"
$WorkBuddyModelsFile = Join-Path $WorkBuddyDir "models.json"
$TraeConfigDir  = Join-Path $env:USERPROFILE ".stallionx\trae"
$TraeModelsFile = Join-Path $TraeConfigDir "models.json"
$TraeGuideFile  = Join-Path $TraeConfigDir "README.md"
# pi（pi coding agent）的自定义 provider 配置：一个文件可并存多个 provider，
# 脚本只接管自己这两个 provider id，其余原样保留。
$PiConfigDir    = Join-Path $env:USERPROFILE ".pi\agent"
$PiModelsFile   = Join-Path $PiConfigDir "models.json"
$PiProviderId   = $ProviderId                  # OpenAI 兼容 provider（chat / responses）
$PiAnthropicProviderId = "$ProviderId-anthropic"  # Claude 模型专用 provider（Anthropic 原生协议）
$CodexDir       = Join-Path $env:USERPROFILE ".codex"
$CodexConfig    = Join-Path $CodexDir "config.toml"
$CodexAuth      = Join-Path $CodexDir "auth.json"
$CodexModelCatalog = Join-Path $CodexDir "stallionx-models.json"

# 平台登录令牌的本地缓存位置（仅缓存 JWT，不缓存密码）
$CredentialDir  = Join-Path $env:USERPROFILE ".stallionx"
$CredentialFile = Join-Path $CredentialDir "credentials.json"

# 把任意形态的站点地址削回站点根地址。
# Claude Code 请求时会自己拼 /v1/messages，Codex 则需要在根地址后补 /v1；
# 两者都要求配置里保存的是根地址。用户很容易把站点上展示的 OpenAI 兼容地址
# （.../v1、.../v1/chat/completions）或整条 .../v1/messages 直接粘进来，
# 不削掉就会拼出 /v1/v1/messages，或者把 Claude Code 引到 OpenAI 兼容那条路上——
# 那条路要做格式转换，cache_control 与 anthropic-beta 无法原样透传。
# 与 install.sh 的 normalize_site_base_url 保持同一套规则（后缀区分大小写）。
# 必须定义在下方 -BaseUrlOverride 处理之前：脚本自上而下执行，函数先定义后调用。
function ConvertTo-SiteBaseUrl([string]$Url) {
    if ([string]::IsNullOrWhiteSpace($Url)) { return "" }
    $normalized = $Url.Trim().TrimEnd('/')
    $suffixes = @("/v1/messages", "/v1/chat/completions", "/v1/responses", "/v1")
    $stripped = $true
    # 循环削减，覆盖 .../v1/v1 这类重复粘贴的情况
    while ($stripped) {
        $stripped = $false
        foreach ($suffix in $suffixes) {
            if ($normalized.EndsWith($suffix, [StringComparison]::Ordinal)) {
                $normalized = $normalized.Substring(0, $normalized.Length - $suffix.Length).TrimEnd('/')
                $stripped = $true
                break
            }
        }
    }
    return $normalized
}

# -BaseUrlOverride 可能带末尾斜杠，也可能被粘成 OpenAI 兼容地址（.../v1 之类），
# 统一削回站点根地址后再派生各客户端需要的地址：
#   - Codex 走 OpenAI 兼容协议，需要在根地址后补 /v1；
#   - Claude Code 走 Anthropic 原生协议，直接用根地址（客户端自己拼 /v1/messages）。
# 不归一化就会拼出 https://host//v1 或 https://host/v1/v1/messages 这类坏 URL。
if (-not [string]::IsNullOrWhiteSpace($BaseUrlOverride)) {
    $BaseUrl = ConvertTo-SiteBaseUrl $BaseUrlOverride
    $CodexBaseUrl = "$BaseUrl/v1"
    $AnthropicBaseUrl = $BaseUrl
}

# 生成时间戳（写入 config.toml 头部注释，标记配置由本脚本何时生成）

# ----------------------------- 工具函数 --------------------------------------

# 打印带颜色的信息，便于用户区分普通日志 / 成功 / 警告 / 错误
function Write-Info($msg)  { Write-Host "[信息] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "[成功] $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "[警告] $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[错误] $msg" -ForegroundColor Red }

# 规范化并校验逗号分隔的客户端列表，同时兼容 trea 的常见拼写。
function ConvertTo-NormalizedTargets([string]$RawTargets) {
    $normalized = [System.Collections.Generic.List[string]]::new()
    foreach ($item in ($RawTargets -split ',')) {
        $target = $item.Trim().ToLowerInvariant()
        if ($target -eq "trea") { $target = "trae" }
        if ([string]::IsNullOrWhiteSpace($target)) { continue }
        if ($target -eq "qoder") {
            throw "Qoder 暂未提供可验证的第三方 API 配置入口，当前脚本不会写入无效配置。"
        }
        if ($target -notin @("codex", "claude", "codebuddy", "workbuddy", "trae", "pi")) {
            throw "不支持的客户端：$target（支持 codex、claude、codebuddy、workbuddy、trae、pi）"
        }
        if (-not $normalized.Contains($target)) { $normalized.Add($target) }
    }
    if ($normalized.Count -eq 0) { $normalized.Add("codex") }
    return ($normalized -join ',')
}

# Windows 控制台复选框：↑/↓ 移动，空格勾选，Enter 确认，Codex 默认勾选。
function Select-TargetsInteractively {
    $labels = @(
        "Codex（默认）",
        "Claude Code",
        "CodeBuddy",
        "WorkBuddy",
        "Trae（生成模型配置清单）",
        "pi（pi coding agent）",
        "Qoder（暂不支持第三方 API 配置）"
    )
    $values = @("codex", "claude", "codebuddy", "workbuddy", "trae", "pi", "qoder")
    $checked = @($true, $false, $false, $false, $false, $false, $false)
    $enabled = @($true, $true, $true, $true, $true, $true, $false)
    $current = 0
    $top = [Console]::CursorTop
    $oldCursorVisible = [Console]::CursorVisible

    try {
        [Console]::CursorVisible = $false
        while ($true) {
            [Console]::SetCursorPosition(0, $top)
            Write-Host "请选择要配置的客户端（↑/↓ 移动，空格勾选，Enter 确认）："
            for ($index = 0; $index -lt $labels.Count; $index++) {
                $marker = if (-not $enabled[$index]) { "[-]" } elseif ($checked[$index]) { "[x]" } else { "[ ]" }
                $prefix = if ($index -eq $current) { ">" } else { " " }
                $color = if ($index -eq $current) { "Cyan" } elseif (-not $enabled[$index]) { "DarkGray" } else { "Gray" }
                # 补足行尾空格，覆盖上一轮可能残留的内容。
                Write-Host (("{0} {1} {2}" -f $prefix, $marker, $labels[$index]).PadRight(80)) -ForegroundColor $color
            }

            $pressed = [Console]::ReadKey($true)
            switch ($pressed.Key) {
                "UpArrow"   { $current = ($current - 1 + $labels.Count) % $labels.Count }
                "DownArrow" { $current = ($current + 1) % $labels.Count }
                "Spacebar"  {
                    if ($enabled[$current]) { $checked[$current] = -not $checked[$current] }
                    else { [Console]::Beep() }
                }
                "Enter" {
                    $selected = [System.Collections.Generic.List[string]]::new()
                    for ($index = 0; $index -lt $values.Count; $index++) {
                        if ($enabled[$index] -and $checked[$index]) { $selected.Add($values[$index]) }
                    }
                    if ($selected.Count -eq 0) { $selected.Add("codex") }
                    return ($selected -join ',')
                }
            }
        }
    } catch {
        # 控制台交互异常必须输出错误日志，并回退到默认 Codex。
        Write-Warn "复选框选择器不可用，将默认选择 Codex：$($_.Exception.Message)"
        return "codex"
    } finally {
        [Console]::CursorVisible = $oldCursorVisible
    }
}

function Test-TargetSelected([string]$Name) {
    return (($Targets -split ',') -contains $Name)
}

# 掩码显示 API Key：保留首 4 位与末 4 位，中间用 * 代替，避免明文泄露
function Get-MaskedKey($key) {
    if ([string]::IsNullOrEmpty($key)) { return "" }
    # 过短的 Key 全部打码，防止泄露有效信息
    if ($key.Length -le 8) { return "********" }
    return $key.Substring(0, 4) + "****" + $key.Substring($key.Length - 4)
}

# 把 SecureString 转成明文字符串（用于读取无回显输入）
function ConvertFrom-SecureStringPlain($secure) {
    if ($null -eq $secure) { return "" }
    $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secure)
    try {
        return [System.Runtime.InteropServices.Marshal]::PtrToStringUni($ptr)
    } finally {
        # 及时释放非托管内存，避免 Key 长期驻留
        [System.Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($ptr)
    }
}

# 从 JSON 文件中读取指定字段的值（这些文件均由本脚本生成，格式可控）
function Get-KeyFromJson($file, $field) {
    if (-not (Test-Path $file)) { return "" }
    try {
        $raw = Get-Content $file -Raw
        if ([string]::IsNullOrWhiteSpace($raw)) { return "" }
        $obj = $raw | ConvertFrom-Json
        # WorkBuddy 的 models.json 顶层是数组，从第一条模型读取 apiKey。
        if ($obj -is [System.Array] -and $field -eq "apiKey") {
            if ($obj.Count -gt 0 -and $null -ne $obj[0].apiKey) { return [string]$obj[0].apiKey }
            return ""
        }
        # settings.json 的 Key 在 env 块里，auth.json 则在顶层
        if ($field -eq "ANTHROPIC_AUTH_TOKEN") {
            if ($null -ne $obj.env -and $null -ne $obj.env.ANTHROPIC_AUTH_TOKEN) {
                return [string]$obj.env.ANTHROPIC_AUTH_TOKEN
            }
            return ""
        }
        $prop = $obj.PSObject.Properties[$field]
        if ($null -ne $prop -and $null -ne $prop.Value) { return [string]$prop.Value }
        return ""
    } catch {
        # 异常时输出错误日志，但不中断流程（探测失败按"无配置"处理）
        Write-Warn "读取 $file 失败：$($_.Exception.Message)"
        return ""
    }
}

# 读取 pi models.json 中本脚本托管 provider 的 apiKey。
# 同一文件可能包含多个 provider，各自带 apiKey，不能按字段名粗提取，必须定位到
# providers.<PiProviderId>；写入时 $ 被转义成 $$（pi 的环境变量插值语法），读取时还原。
function Get-PiKey() {
    if (-not (Test-Path $PiModelsFile)) { return "" }
    try {
        $raw = Get-Content -Path $PiModelsFile -Raw -Encoding UTF8
        if ([string]::IsNullOrWhiteSpace($raw)) { return "" }
        $config = $raw | ConvertFrom-Json
        if ($null -eq $config.providers) { return "" }
        $provider = $config.providers.PSObject.Properties[$PiProviderId]
        if ($null -eq $provider -or $null -eq $provider.Value -or $null -eq $provider.Value.apiKey) { return "" }
        return ([string]$provider.Value.apiKey).Replace('$$', '$')
    } catch {
        # 用户手改坏的文件不应阻断探测，记录后按“未配置”处理。
        Write-Warn "读取 $PiModelsFile 失败：$($_.Exception.Message)"
        return ""
    }
}

# 综合探测当前已配置的 API Key（用户级环境变量 > Codex > Claude > CodeBuddy > WorkBuddy > Trae > pi）
function Get-ExistingKey() {
    $k = [Environment]::GetEnvironmentVariable($EnvKeyName, "User")
    if (-not [string]::IsNullOrWhiteSpace($k)) { return $k }

    $k = Get-KeyFromJson $CodexAuth "OPENAI_API_KEY"
    if (-not [string]::IsNullOrWhiteSpace($k)) { return $k }

    $k = Get-KeyFromJson $ClaudeSettings "ANTHROPIC_AUTH_TOKEN"
    if (-not [string]::IsNullOrWhiteSpace($k)) { return $k }

    $k = Get-KeyFromJson $CodeBuddyModelsFile "apiKey"
    if (-not [string]::IsNullOrWhiteSpace($k)) { return $k }

    $k = Get-KeyFromJson $WorkBuddyModelsFile "apiKey"
    if (-not [string]::IsNullOrWhiteSpace($k)) { return $k }

    $k = Get-KeyFromJson $TraeModelsFile "api_key"
    if (-not [string]::IsNullOrWhiteSpace($k)) { return $k }

    $k = Get-PiKey
    if (-not [string]::IsNullOrWhiteSpace($k)) { return $k }

    return ""
}

# 读取 config.toml 中已有的 model 字段，保留用户的自定义模型选择。
# 注意正则只匹配 model 而不匹配 model_provider（model 后必须紧跟空白或等号）。
<#
.SYNOPSIS
探测本机已配置的 API 地址。
.DESCRIPTION
同一台机器可能先后接入过不同部署（自建、测试环境、备用域名），重复执行脚本时
默认值应当沿用上次实际使用的地址，而不是回到脚本内置的默认站点。
优先级：登录缓存（最近一次真正登录过的站点）> Codex > Claude Code。
#>
function Get-ExistingBaseUrl() {
    if (Test-Path $CredentialFile) {
        try {
            $cached = Get-Content -Path $CredentialFile -Raw -Encoding UTF8 | ConvertFrom-Json
            if (-not [string]::IsNullOrWhiteSpace($cached.base_url)) {
                return ConvertTo-SiteBaseUrl ([string]$cached.base_url)
            }
        } catch {
            Write-Warn "读取 $CredentialFile 失败：$($_.Exception.Message)"
        }
    }

    # Codex 配置里保存的是带 /v1 的地址，且同一份 config.toml 可能存在多个 provider，
    # 因此必须限定在本脚本管理的 provider 段内读取，再去掉 /v1 还原站点根地址。
    if (Test-Path $CodexConfig) {
        try {
            $inBlock = $false
            foreach ($line in (Get-Content -Path $CodexConfig)) {
                $trimmed = $line.Trim()
                if ($trimmed -eq "[model_providers.$ProviderId]") { $inBlock = $true; continue }
                if ($inBlock -and $trimmed.StartsWith("[")) { break }
                if ($inBlock -and $trimmed -match '^base_url\s*=\s*"?([^"]+)"?$') {
                    return ConvertTo-SiteBaseUrl $Matches[1]
                }
            }
        } catch {
            Write-Warn "读取 $CodexConfig 失败：$($_.Exception.Message)"
        }
    }

    # Claude Code 的地址在 env 块里，Get-KeyFromJson 只取顶层字段，这里单独解析。
    # 这里保存的本就是站点根地址，但旧版本或手工配置可能残留 /v1 后缀，
    # 同样归一化，避免把 OpenAI 兼容地址当成默认值再写回去。
    if (Test-Path $ClaudeSettings) {
        try {
            $settings = Get-Content -Path $ClaudeSettings -Raw | ConvertFrom-Json
            if ($null -ne $settings.env -and -not [string]::IsNullOrWhiteSpace($settings.env.ANTHROPIC_BASE_URL)) {
                return ConvertTo-SiteBaseUrl ([string]$settings.env.ANTHROPIC_BASE_URL)
            }
        } catch {
            Write-Warn "读取 $ClaudeSettings 失败：$($_.Exception.Message)"
        }
    }

    return ""
}

# 用户选择“其他”后读取自定义 API 地址。原配置已经是自定义地址时允许直接回车沿用；
# 从固定站点主动切到“其他”时必须明确输入，避免意外回落。
function Read-CustomBaseUrlInteractively {
    param([string]$DefaultUrl = "")

    while ($true) {
        $prompt = "请输入其他 API 地址"
        if (-not [string]::IsNullOrWhiteSpace($DefaultUrl)) {
            $prompt += "（直接回车沿用 $DefaultUrl）"
        }
        $entered = Read-Host $prompt
        $entered = ($entered -replace '\s', '')

        if ([string]::IsNullOrWhiteSpace($entered) -and -not [string]::IsNullOrWhiteSpace($DefaultUrl)) {
            return ConvertTo-SiteBaseUrl $DefaultUrl
        }
        if ($entered -like 'http://*' -or $entered -like 'https://*') { return ConvertTo-SiteBaseUrl $entered }

        Write-Err "地址必须以 http:// 或 https:// 开头，请重新输入。"
    }
}

# API 地址使用单选菜单。已有配置命中固定站点时默认选中对应项；已有自定义地址时
# 默认选中“其他”，确认后可直接回车沿用原地址。
function Select-BaseUrlInteractively {
    param([string]$DefaultUrl)

    $values = @(
        "https://x.stallion-api.com",
        "https://x.stallion-api.run",
        "https://token.openvi.com",
        "__other__"
    )
    $labels = @(
        "https://x.stallion-api.com/",
        "https://x.stallion-api.run/",
        "https://token.openvi.com/",
        "其他（手动输入）"
    )
    $normalizedDefault = if ([string]::IsNullOrWhiteSpace($DefaultUrl)) { "" } else { $DefaultUrl.TrimEnd('/') }
    $current = [Array]::IndexOf($values, $normalizedDefault)
    $otherDefault = ""
    if ($current -lt 0) {
        $current = 3
        $otherDefault = $normalizedDefault
        $labels[3] = "其他（当前：$normalizedDefault）"
    } elseif ($current -eq 3) {
        $current = 0
    }

    $top = 0
    $oldCursorVisible = $true
    $cursorStateAvailable = $false
    $selectedValue = ""
    $menuFailed = $false
    try {
        $top = [Console]::CursorTop
        $oldCursorVisible = [Console]::CursorVisible
        $cursorStateAvailable = $true
        [Console]::CursorVisible = $false
        while ($true) {
            [Console]::SetCursorPosition(0, $top)
            Write-Host "请选择 API 地址（↑/↓ 移动，Enter 确认）："
            for ($index = 0; $index -lt $labels.Count; $index++) {
                $marker = if ($index -eq $current) { "(●)" } else { "( )" }
                $prefix = if ($index -eq $current) { ">" } else { " " }
                $color = if ($index -eq $current) { "Cyan" } else { "Gray" }
                Write-Host (("{0} {1} {2}" -f $prefix, $marker, $labels[$index]).PadRight(100)) -ForegroundColor $color
            }

            $pressed = [Console]::ReadKey($true)
            switch ($pressed.Key) {
                "UpArrow" { $current = ($current - 1 + $labels.Count) % $labels.Count }
                "DownArrow" { $current = ($current + 1) % $labels.Count }
                "Enter" {
                    $selectedValue = $values[$current]
                    break
                }
            }
            if (-not [string]::IsNullOrWhiteSpace($selectedValue)) { break }
        }
    } catch {
        # 控制台菜单不可用时保留可操作的文本输入入口，并记录失败原因。
        Write-Warn "API 地址单选菜单不可用，改为手动输入：$($_.Exception.Message)"
        $menuFailed = $true
    } finally {
        if ($cursorStateAvailable) { [Console]::CursorVisible = $oldCursorVisible }
    }

    if ($menuFailed) {
        return Read-CustomBaseUrlInteractively -DefaultUrl $normalizedDefault
    }
    if ($selectedValue -eq "__other__") {
        return Read-CustomBaseUrlInteractively -DefaultUrl $otherDefault
    }
    return $selectedValue
}

function Get-ExistingModel() {
    if (-not (Test-Path $CodexConfig)) { return "" }
    try {
        $line = Select-String -Path $CodexConfig -Pattern '^\s*model\s*=' | Select-Object -First 1
        if ($null -eq $line) { return "" }
        if ($line.Line -match '^\s*model\s*=\s*"?([^"]*)"?\s*$') { return $Matches[1].Trim() }
        return ""
    } catch {
        # 异常时输出错误日志，但不中断流程（探测失败按"无配置"处理）
        Write-Warn "读取 $CodexConfig 失败：$($_.Exception.Message)"
        return ""
    }
}

# 读取用户已配置的模型目录。普通模式只接管未配置或由本脚本管理的目录；其他自定义
# 目录原样保留，用户必须显式传 -Force 才会替换。
function Get-ExistingModelCatalog() {
    if (-not (Test-Path $CodexConfig)) { return "" }
    try {
        $line = Select-String -Path $CodexConfig -Pattern '^\s*model_catalog_json\s*=' | Select-Object -First 1
        if ($null -eq $line) { return "" }
        if ($line.Line -match '^\s*model_catalog_json\s*=\s*"?([^"]*)"?\s*$') { return $Matches[1].Trim() }
        return ""
    } catch {
        Write-Warn "读取 $CodexConfig 的模型目录失败：$($_.Exception.Message)"
        return ""
    }
}

function Test-ManagedCodexCatalogPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    $normalized = $Path.Replace('\', '/')
    $managed = $CodexModelCatalog.Replace('\', '/')
    return ($normalized -ieq $managed -or $normalized -eq '~/.codex/stallionx-models.json')
}

# 增量更新 Codex 配置，只管理顶层 model/model_provider、可安全接管的模型目录与
# StallionX provider 段。hooks.state、projects、MCP、sandbox 等用户配置均原样保留。
function Update-CodexConfig([string]$Model, [string]$ModelCatalogPath = "") {
    $lines = if (Test-Path $CodexConfig) { @(Get-Content -Path $CodexConfig) } else { @() }
    $result = [System.Collections.Generic.List[string]]::new()
    $insideProvider = $false
    $rootFinished = $false
    $seenModel = $false
    $seenProvider = $false
    $seenCatalog = $false
    # ScriptBlock 通过调用运算符执行时拥有子作用域，因此用可变状态对象记录写入结果，
    # 避免直接赋值局部布尔变量后无法反馈到当前函数作用域。
    $state = @{ ProviderWritten = $false }
    $providerHeader = "[model_providers.$ProviderId]"

    $addRootFields = {
        if (-not $seenModel) { $result.Add("model = `"$Model`"") }
        if (-not $seenProvider) { $result.Add("model_provider = `"$ProviderId`"") }
        if (-not [string]::IsNullOrWhiteSpace($ModelCatalogPath) -and -not $seenCatalog) {
            $catalogTomlPath = $ModelCatalogPath.Replace('\', '/')
            $result.Add("model_catalog_json = `"$catalogTomlPath`"")
        }
        if (-not $seenModel -or -not $seenProvider -or
            (-not [string]::IsNullOrWhiteSpace($ModelCatalogPath) -and -not $seenCatalog)) {
            $result.Add("")
        }
    }
    $addProviderSection = {
        $result.Add($providerHeader)
        $result.Add("name = `"$ProviderName`"")
        $result.Add("base_url = `"$CodexBaseUrl`"")
        # 直接写入 bearer token，避免安装脚本子进程无法修改父终端环境而导致请求失败。
        $result.Add("experimental_bearer_token = `"$ApiKey`"")
        $result.Add("# StallionX 使用 Responses API 格式")
        $result.Add('wire_api = "responses"')
        $state.ProviderWritten = $true
    }

    foreach ($line in $lines) {
        if ($insideProvider) {
            if ($line -match '^\s*\[') { $insideProvider = $false } else { continue }
        }

        if ($line.Trim() -eq $providerHeader) {
            if (-not $rootFinished) {
                & $addRootFields
                $rootFinished = $true
            }
            & $addProviderSection
            $insideProvider = $true
            continue
        }

        if (-not $rootFinished -and $line -match '^\s*\[') {
            & $addRootFields
            $rootFinished = $true
        }
        if (-not $rootFinished -and $line -match '^\s*model\s*=') { $seenModel = $true }
        if (-not $rootFinished -and $line -match '^\s*model_provider\s*=') {
            $result.Add("model_provider = `"$ProviderId`"")
            $seenProvider = $true
            continue
        }
        if (-not $rootFinished -and $line -match '^\s*model_catalog_json\s*=') {
            $seenCatalog = $true
            if (-not [string]::IsNullOrWhiteSpace($ModelCatalogPath)) {
                $catalogTomlPath = $ModelCatalogPath.Replace('\', '/')
                $result.Add("model_catalog_json = `"$catalogTomlPath`"")
                continue
            }
        }
        $result.Add($line)
    }

    if (-not $rootFinished) { & $addRootFields }
    if (-not $state.ProviderWritten) {
        $result.Add("")
        & $addProviderSection
    }
    Write-Utf8NoBomFile -Path $CodexConfig -Value $result
}

# ---- Codex 模型目录与 profiles ---------------------------------------------
# Codex 不会自动用第三方 provider 的 GET /models 填充模型选择器。官方支持通过
# model_catalog_json 在启动时加载自定义目录，因此脚本生成独立的 StallionX 目录；
# profile 文件继续保留，兼容 `codex -p <名称>` 与旧版 Codex。
#
# profile 名称只允许字母、数字、连字符和下划线，而模型 ID 常含 "."（如 gpt-5.6-sol），
# 因此名称由模型 ID 把非法字符替换为 "-" 得到（gpt-5.6-sol -> gpt-5-6-sol）。
# 脚本生成的文件首行带有下面的标记，重复执行时只删除带标记的文件再重新生成；
# 用户自己写的 profile 文件（无标记）原样保留，同名时也不覆盖。标记前缀必须保持稳定。
$CodexProfileMarkPrefix = "# managed-by: stallionx-install"
$CodexProfileMark = "$CodexProfileMarkPrefix（脚本按 StallionX /v1/models 自动生成，重复执行会刷新，请勿手改）"

# 请求 StallionX /v1/models，返回适合 Codex 使用的对话模型 ID（已排序去重）。
# 图像、向量、语音等非对话模型会被过滤；失败时抛出异常，由调用方决定是否中断。
function Get-CodexModelIds() {
    $headers = @{ Authorization = "Bearer $ApiKey"; Accept = "application/json" }
    $response = Invoke-RestMethod -Uri "$CodexBaseUrl/models" -Headers $headers -Method Get -TimeoutSec 20
    $ids = @($response.data | ForEach-Object { [string]$_.id } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Where-Object { $_ -match '^[A-Za-z0-9._:/-]+$' } |
        Where-Object { $_ -notmatch '(?i)image|embed|tts|whisper|audio|realtime|moderation' } |
        Sort-Object -Unique)
    if ($ids.Count -eq 0) { throw "StallionX /v1/models 未返回可用于 Codex 的对话模型。" }
    return $ids
}

# 复用当前 Codex 客户端提供的完整模型对象作为 schema 模板，再按 /v1/models 过滤或
# 克隆。这样目录字段会随用户安装的 Codex 版本保持兼容，避免脚本硬编码内部 schema。
function New-CodexModelCatalog([string[]]$ModelIds) {
    $sourceCatalog = $null
    $codexCommand = Get-Command codex -ErrorAction SilentlyContinue
    if ($null -ne $codexCommand) {
        try {
            $raw = (& $codexCommand.Source debug models 2>$null | Out-String)
            if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($raw)) {
                $candidate = $raw | ConvertFrom-Json
                if (@($candidate.models).Count -gt 0) { $sourceCatalog = $candidate }
            }
        } catch {
            Write-Warn "读取 Codex 内置模型目录失败，将尝试本地缓存：$($_.Exception.Message)"
        }
    }

    if ($null -eq $sourceCatalog) {
        $cachePath = Join-Path $CodexDir "models_cache.json"
        if (Test-Path $cachePath) {
            try {
                $candidate = Get-Content -Path $cachePath -Raw -Encoding UTF8 | ConvertFrom-Json
                if (@($candidate.models).Count -gt 0) { $sourceCatalog = $candidate }
            } catch {
                Write-Warn "读取 Codex 模型缓存失败：$($_.Exception.Message)"
            }
        }
    }
    if ($null -eq $sourceCatalog) {
        # 首次安装或 codex 不在 PATH 时使用经过当前 Codex 解析器验证的最小模板。
        # 后续运行若能读取客户端目录，会自动改用该版本的完整模型元数据。
        $sourceCatalog = [pscustomobject]@{
            models = @([pscustomobject]@{
                slug = 'stallionx-template'
                display_name = 'StallionX'
                description = 'Available through StallionX.'
                default_reasoning_level = 'medium'
                supported_reasoning_levels = @(
                    [pscustomobject]@{ effort = 'low'; description = 'Fast responses with lighter reasoning' },
                    [pscustomobject]@{ effort = 'medium'; description = 'Balanced reasoning for everyday tasks' },
                    [pscustomobject]@{ effort = 'high'; description = 'Greater reasoning depth for complex tasks' },
                    [pscustomobject]@{ effort = 'xhigh'; description = 'Extra reasoning depth for demanding tasks' }
                )
                shell_type = 'shell_command'
                visibility = 'list'
                supported_in_api = $true
                priority = 1
                support_verbosity = $true
                truncation_policy = [pscustomobject]@{ mode = 'tokens'; limit = 10000 }
                experimental_supported_tools = @()
                base_instructions = 'You are Codex, a coding agent. Follow system, developer, and user instructions while completing software engineering tasks.'
            })
        }
    }

    $sourceModels = @($sourceCatalog.models)
    $bySlug = @{}
    foreach ($item in $sourceModels) {
        if ($null -ne $item -and -not [string]::IsNullOrWhiteSpace([string]$item.slug)) {
            $bySlug[[string]$item.slug] = $item
        }
    }
    $template = if ($bySlug.ContainsKey("gpt-5.6-sol")) { $bySlug["gpt-5.6-sol"] } else { $sourceModels[0] }

    $models = [System.Collections.Generic.List[object]]::new()
    $priority = 1
    foreach ($modelId in @($ModelIds | Sort-Object -Unique)) {
        if ([string]::IsNullOrWhiteSpace($modelId)) { continue }
        $known = $bySlug.ContainsKey($modelId)
        $source = if ($known) { $bySlug[$modelId] } else { $template }
        $model = ($source | ConvertTo-Json -Depth 100 | ConvertFrom-Json)
        $model.slug = $modelId
        if (-not $known) {
            $parts = [regex]::Split($modelId, '([._:/-]+)')
            $displayParts = foreach ($part in $parts) {
                if ($part -ieq 'gpt') { 'GPT' }
                elseif ($part.Length -gt 0) { $part.Substring(0, 1).ToUpperInvariant() + $part.Substring(1) }
            }
            $model.display_name = ($displayParts -join '')
            $model.description = "Available through StallionX: $modelId."
            # 不同 Codex 版本的目录 schema 可能没有这些可选属性。Add-Member -Force
            # 同时兼容“已有属性”和“属性缺失”，避免站点新模型克隆旧模板时赋值失败。
            $model | Add-Member -NotePropertyName availability_nux -NotePropertyValue $null -Force
            $model | Add-Member -NotePropertyName upgrade -NotePropertyValue $null -Force
        }
        $model.visibility = "list"
        $model.supported_in_api = $true
        $model.priority = $priority
        $models.Add($model)
        $priority++
    }
    if ($models.Count -eq 0) { throw "没有可写入 Codex 模型目录的模型" }

    $temporaryPath = "$CodexModelCatalog.tmp.$PID"
    try {
        $catalogJson = @{ models = @($models) } | ConvertTo-Json -Depth 100
        # Windows PowerShell 5.1 的 Set-Content -Encoding UTF8 会写 BOM；Codex 的 JSON
        # 解析器要求标准 UTF-8，因此显式使用无 BOM 编码写入模型目录。
        $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($temporaryPath, "$catalogJson`n", $utf8WithoutBom)
        Move-Item -Path $temporaryPath -Destination $CodexModelCatalog -Force
    } catch {
        Write-Err "写入 Codex 模型目录失败：$($_.Exception.Message)"
        if (Test-Path $temporaryPath) { Remove-Item -Path $temporaryPath -Force -ErrorAction SilentlyContinue }
        throw
    }
}

# 模型 ID -> Codex profile 名称：非 [A-Za-z0-9_-] 的字符统一替换为 "-"。
function Get-CodexProfileName([string]$ModelId) {
    return ($ModelId -replace '[^A-Za-z0-9_-]+', '-')
}

# 判断一个 profile 文件是否由脚本生成（首行带标记前缀）。
function Test-ManagedCodexProfile([string]$Path) {
    if (-not (Test-Path $Path)) { return $false }
    try {
        $first = Get-Content -Path $Path -TotalCount 1 -ErrorAction Stop
        return ([string]$first).StartsWith($CodexProfileMarkPrefix)
    } catch {
        Write-Warn "读取 $Path 失败：$($_.Exception.Message)"
        return $false
    }
}

# 列出脚本生成的 profile 名称，供 -Show 与完成提示使用。
function Get-ManagedCodexProfiles() {
    if (-not (Test-Path $CodexDir)) { return @() }
    $names = [System.Collections.Generic.List[string]]::new()
    foreach ($file in (Get-ChildItem -Path $CodexDir -Filter "*.config.toml" -File -ErrorAction SilentlyContinue)) {
        if (Test-ManagedCodexProfile $file.FullName) {
            $names.Add($file.Name.Substring(0, $file.Name.Length - ".config.toml".Length))
        }
    }
    return @($names | Sort-Object)
}

# 按模型 ID 列表刷新 ~/.codex/<名称>.config.toml：先删除全部带标记的旧文件
# （后端下线的模型随之消失），再逐个写入新文件。返回本次写入的 profile 名称。
function Write-CodexProfiles([string[]]$ModelIds) {
    foreach ($file in (Get-ChildItem -Path $CodexDir -Filter "*.config.toml" -File -ErrorAction SilentlyContinue)) {
        if (Test-ManagedCodexProfile $file.FullName) { Remove-Item -Path $file.FullName -Force }
    }
    $written = [System.Collections.Generic.List[string]]::new()
    foreach ($modelId in $ModelIds) {
        if ([string]::IsNullOrWhiteSpace($modelId)) { continue }
        $name = Get-CodexProfileName $modelId
        $path = Join-Path $CodexDir "$name.config.toml"
        if (Test-Path $path) {
            Write-Warn "跳过模型 ${modelId}：$path 已存在且不是脚本生成的，保留你的文件。"
            continue
        }
        $content = @($CodexProfileMark, "model = `"$modelId`"", "model_provider = `"$ProviderId`"")
        Write-Utf8NoBomFile -Path $path -Value $content
        $written.Add($name)
    }
    return @($written)
}

# 强制覆盖前复制原 config.toml。备份与原文件同目录并带时间戳；同一秒重复执行时
# 追加序号，确保任何一份旧配置都不会被后续备份覆盖。
function Backup-CodexConfig() {
    if (-not (Test-Path $CodexConfig)) { return "" }
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupPath = "$CodexConfig.backup-$timestamp"
    $suffix = 1
    while (Test-Path $backupPath) {
        $backupPath = "$CodexConfig.backup-$timestamp-$suffix"
        $suffix++
    }
    try {
        Copy-Item -LiteralPath $CodexConfig -Destination $backupPath -Force -ErrorAction Stop
        return $backupPath
    } catch {
        Write-Err "备份 Codex 配置失败：$($_.Exception.Message)"
        throw
    }
}

# -Force 只写 StallionX 运行所需字段。调用方必须先生成模型目录并完成备份，避免
# 网络或磁盘失败后把用户原本可用的配置替换成半成品。
function Write-ForcedCodexConfig([string]$Model) {
    $catalogTomlPath = $CodexModelCatalog.Replace('\', '/')
    $content = @(
        '# managed-by: stallionx-install -Force',
        "model = `"$Model`"",
        "model_provider = `"$ProviderId`"",
        "model_catalog_json = `"$catalogTomlPath`"",
        '',
        "[model_providers.$ProviderId]",
        "name = `"$ProviderName`"",
        "base_url = `"$CodexBaseUrl`"",
        "experimental_bearer_token = `"$ApiKey`"",
        '# StallionX 使用 Responses API 格式',
        'wire_api = "responses"'
    )
    Write-Utf8NoBomFile -Path $CodexConfig -Value $content
}

# ----------------------------- 平台账号流程 ----------------------------------
# 让新用户在终端里完成「注册 / 登录 → 开通 API Key」，无需先访问网页后台。

# Windows PowerShell 5.1 默认可能未启用 TLS 1.2，直接请求 HTTPS 接口会握手失败。
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
} catch {
    # 新版 .NET 已由系统统一管理协议版本，设置失败不影响后续请求，仅记录告警。
    Write-Warn "启用 TLS 1.2 失败，若接口请求异常请升级 PowerShell：$($_.Exception.Message)"
}

# 当前会话的登录状态（脚本级变量，供各流程共享）
$script:PlatformJwt      = ""   # 平台登录令牌
$script:PlatformUsername = ""   # 当前账号名，仅用于展示
$script:AccountBalance   = $null # 开通接口返回的余额，用于结尾提示
$script:BindableChannelGroups  = @() # Get-BindableChannelGroups 拉取的可绑定渠道分组
# Resource IDs are strings; never coerce opaque public identities to integers.
$script:SelectedChannelGroupIds = @() # Resolve-ChannelGroupSelection 解析出的分组 ID（新建令牌用）

<#
.SYNOPSIS
调用平台 API。
.DESCRIPTION
统一处理 UTF-8 编码、鉴权头与错误响应解析。
Windows PowerShell 5.1 下 Invoke-RestMethod 默认按 ISO-8859-1 发送请求体，
中文用户名或密码会在服务端变成乱码，因此这里显式转成 UTF-8 字节数组再发送。
返回哈希表：成功为 @{ Success = $true; Data = <响应对象> }，
失败为 @{ Success = $false; Message = <错误提示>; StatusCode = <状态码> }。
#>
function Invoke-PlatformApi {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Body = $null,
        [string]$Jwt = ""
    )

    $uri = "$BaseUrl$Path"
    $headers = @{}
    if (-not [string]::IsNullOrWhiteSpace($Jwt)) { $headers["Authorization"] = "Bearer $Jwt" }

    $payload = $null
    if ($null -ne $Body) {
        $json = ($Body | ConvertTo-Json -Depth 5 -Compress)
        $payload = [System.Text.Encoding]::UTF8.GetBytes($json)
    }

    try {
        $response = Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers `
            -Body $payload -ContentType "application/json; charset=utf-8" -TimeoutSec 30 -ErrorAction Stop
        return @{ Success = $true; Data = $response }
    } catch {
        # 4xx/5xx 会抛异常，响应体按 PowerShell 版本分别落在 ErrorDetails 或响应流里
        $message = ""
        $statusCode = 0

        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        }
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            try { $message = ($_.ErrorDetails.Message | ConvertFrom-Json).message }
            catch { $message = $_.ErrorDetails.Message }
        }
        if ([string]::IsNullOrWhiteSpace($message) -and $_.Exception.Response) {
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $raw = $reader.ReadToEnd()
                $reader.Close()
                $message = ($raw | ConvertFrom-Json).message
            } catch {
                # 响应体不是 JSON（例如网关返回的 HTML 错误页），保留原始异常信息
            }
        }
        if ([string]::IsNullOrWhiteSpace($message)) { $message = $_.Exception.Message }

        return @{ Success = $false; Message = $message; StatusCode = $statusCode }
    }
}

# 把登录令牌缓存到 credentials.json，并尽量收紧文件 ACL 到当前用户。
# 只缓存 JWT 不缓存密码：JWT 24 小时后自然失效，泄露影响面远小于长期密码。
function Save-Credential {
    param([string]$Jwt, [string]$Username)

    try {
        if (-not (Test-Path $CredentialDir)) {
            New-Item -ItemType Directory -Path $CredentialDir -Force | Out-Null
        }
        $payload = [ordered]@{
            base_url   = $BaseUrl
            username   = $Username
            token      = $Jwt
            # 服务端签发有效期 24 小时，本地按 23 小时记账，留出时钟偏差余量
            expires_at = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 23 * 3600)
        }
        Write-Utf8NoBomFile -Path $CredentialFile -Value ($payload | ConvertTo-Json -Depth 4)

        # 去掉继承的权限，只保留当前用户完全控制；部分受管环境不允许改 ACL，失败仅告警
        try {
            & icacls $CredentialFile /inheritance:r /grant:r "$($env:USERNAME):(F)" | Out-Null
        } catch {
            Write-Warn "无法收紧 $CredentialFile 的访问权限：$($_.Exception.Message)"
        }
    } catch {
        # 缓存失败不影响本次配置，只是下次需要重新登录
        Write-Warn "保存登录状态失败：$($_.Exception.Message)"
    }
}

# 读取本地缓存的登录令牌；已过期、属于其他站点或读取失败时返回 $false
function Get-CachedCredential {
    if (-not (Test-Path $CredentialFile)) { return $false }
    try {
        $cached = Get-Content -Path $CredentialFile -Raw -Encoding UTF8 | ConvertFrom-Json
        # 换过 -BaseUrl 后旧令牌对新站点无效
        if ($cached.base_url -ne $BaseUrl) { return $false }
        if ([string]::IsNullOrWhiteSpace($cached.token)) { return $false }
        if ([int64]$cached.expires_at -le [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()) { return $false }

        $script:PlatformJwt = $cached.token
        $script:PlatformUsername = $cached.username
        return $true
    } catch {
        Write-Warn "读取本地登录状态失败，将重新登录：$($_.Exception.Message)"
        return $false
    }
}

# 清除本地缓存的登录令牌
function Clear-Credential {
    if (-not (Test-Path $CredentialFile)) { return }
    try {
        Remove-Item -Path $CredentialFile -Force
    } catch {
        Write-Err "清除登录状态失败：$($_.Exception.Message)"
    }
}

# 读取密码：优先环境变量 STALLIONX_PASSWORD（便于无人值守执行），否则交互输入。
# 不提供命令行参数，避免密码进入 PowerShell 历史记录与进程命令行。
function Read-AccountPassword {
    param([string]$Prompt = "请输入密码（输入不会显示）")

    if (-not [string]::IsNullOrWhiteSpace($env:STALLIONX_PASSWORD)) {
        return $env:STALLIONX_PASSWORD
    }
    return (ConvertFrom-SecureStringPlain (Read-Host $Prompt -AsSecureString))
}

# 登录已有账号，成功后写入 $script:PlatformJwt 并缓存到本地
function Invoke-AccountLogin {
    $account = $Username
    if ([string]::IsNullOrWhiteSpace($account)) {
        $account = Read-Host "请输入账号（用户名或邮箱）"
    }
    if ([string]::IsNullOrWhiteSpace($account)) {
        Write-Err "账号不能为空。"
        return $false
    }

    $password = Read-AccountPassword
    if ([string]::IsNullOrWhiteSpace($password)) {
        Write-Err "密码不能为空。"
        return $false
    }

    Write-Info "正在登录 $ProviderName..."
    $result = Invoke-PlatformApi -Method "POST" -Path "/api/user/login" -Body @{
        username = $account
        password = $password
    }
    if (-not $result.Success) {
        Write-Err "登录失败：$($result.Message)"
        return $false
    }

    $token = $result.Data.data.token
    if ([string]::IsNullOrWhiteSpace($token)) {
        Write-Err "登录响应中没有找到登录令牌，请联系管理员。"
        return $false
    }

    $script:PlatformJwt = $token
    $script:PlatformUsername = $result.Data.data.user.username
    if ([string]::IsNullOrWhiteSpace($script:PlatformUsername)) { $script:PlatformUsername = $account }

    Save-Credential -Jwt $script:PlatformJwt -Username $script:PlatformUsername
    Write-Ok "登录成功：$($script:PlatformUsername)"
    return $true
}

# 注册新账号：邮箱验证码 → 设置账号密码 → 注册并直接拿到登录令牌
function Invoke-AccountRegister {
    $mail = $Email
    if ([string]::IsNullOrWhiteSpace($mail)) {
        $mail = Read-Host "请输入邮箱（用于接收验证码）"
    }
    if ([string]::IsNullOrWhiteSpace($mail)) {
        Write-Err "邮箱不能为空。"
        return $false
    }

    Write-Info "正在向 $mail 发送验证码..."
    $result = Invoke-PlatformApi -Method "POST" -Path "/api/user/verification" -Body @{ email = $mail }
    if (-not $result.Success) {
        Write-Err "验证码发送失败：$($result.Message)"
        return $false
    }

    # 站点未配置邮件服务时进入测试模式并直接返回验证码，此时无需查收邮件
    $code = $result.Data.data.code
    if (-not [string]::IsNullOrWhiteSpace($code)) {
        Write-Warn "站点处于邮件测试模式，验证码直接返回：$code"
    } else {
        Write-Ok "验证码已发送，请查收邮箱（含垃圾邮件箱）"
        $code = Read-Host "请输入邮箱验证码"
    }
    if ([string]::IsNullOrWhiteSpace($code)) {
        Write-Err "验证码不能为空。"
        return $false
    }

    $account = $Username
    if ([string]::IsNullOrWhiteSpace($account)) {
        # 默认用邮箱前缀作为用户名，去掉平台不接受的字符，减少一次输入
        $suggested = ($mail -split '@')[0] -replace '[^A-Za-z0-9_-]', ''
        $account = Read-Host "请输入用户名（直接回车使用 $suggested）"
        if ([string]::IsNullOrWhiteSpace($account)) { $account = $suggested }
    }
    if ([string]::IsNullOrWhiteSpace($account)) {
        Write-Err "用户名不能为空。"
        return $false
    }

    $password = ""
    if (-not [string]::IsNullOrWhiteSpace($env:STALLIONX_PASSWORD)) {
        $password = $env:STALLIONX_PASSWORD
    } else {
        $password = ConvertFrom-SecureStringPlain (Read-Host "请设置密码（至少 6 位，输入不会显示）" -AsSecureString)
        $confirm = ConvertFrom-SecureStringPlain (Read-Host "请再次输入密码" -AsSecureString)
        if ($password -ne $confirm) {
            Write-Err "两次输入的密码不一致。"
            return $false
        }
    }
    if ($password.Length -lt 6) {
        Write-Err "密码长度不能少于 6 位。"
        return $false
    }

    # 邀请码可选：命令行未提供且处于交互环境时询问一次，回车跳过
    $invite = $InviteCode
    if ([string]::IsNullOrWhiteSpace($invite) -and [Environment]::UserInteractive) {
        $invite = Read-Host "邀请码（没有请直接回车）"
    }

    Write-Info "正在注册账号..."
    $body = @{
        username          = $account
        email             = $mail
        password          = $password
        verification_code = $code
    }
    if (-not [string]::IsNullOrWhiteSpace($invite)) { $body["invite_code"] = $invite }

    $result = Invoke-PlatformApi -Method "POST" -Path "/api/user/register" -Body $body
    if (-not $result.Success) {
        Write-Err "注册失败：$($result.Message)"
        return $false
    }

    $token = $result.Data.data.token
    if ([string]::IsNullOrWhiteSpace($token)) {
        Write-Err "注册响应中没有找到登录令牌，请改用登录方式重试。"
        return $false
    }

    $script:PlatformJwt = $token
    $script:PlatformUsername = $result.Data.data.user.username
    if ([string]::IsNullOrWhiteSpace($script:PlatformUsername)) { $script:PlatformUsername = $account }

    Save-Credential -Jwt $script:PlatformJwt -Username $script:PlatformUsername
    Write-Ok "注册成功：$($script:PlatformUsername)"
    return $true
}

# 拉取当前用户可绑定的渠道分组，写入 $script:BindableChannelGroups
# （PSCustomObject 数组，每项含 id/code/name；列表接口按 id 倒序返回，第一项即
# 服务端「默认分组」，与网页后台 Token 创建页的默认分组口径一致）。
# 失败时给出提示并返回 $false，调用方应降级为不传选择，交由服务端按默认分组处理。
function Get-BindableChannelGroups {
    $result = Invoke-PlatformApi -Method "GET" -Path "/api/cli/channel-groups" -Jwt $script:PlatformJwt
    if (-not $result.Success) {
        Write-Warn "查询可绑定渠道分组失败：$($result.Message)，将使用账号默认分组。"
        return $false
    }
    $groups = @($result.Data.data)
    $script:BindableChannelGroups = $groups
    return $true
}

# 在支持交互的控制台渲染渠道分组勾选列表。
# 操作：↑/↓ 移动，空格勾选，Enter 确认；默认只勾选第一项（服务端「默认分组」，
# 见 Get-BindableChannelGroups 注释）。全部取消勾选后按 Enter 会被拒绝，避免建出
# 一个不绑定任何分组、发请求必 403 的空令牌。返回值为分组 ID 数组。
function Select-ChannelGroupsInteractively {
    $groups = $script:BindableChannelGroups
    $checked = New-Object bool[] $groups.Count
    $checked[0] = $true
    $current = 0
    $top = [Console]::CursorTop
    $oldCursorVisible = [Console]::CursorVisible

    try {
        [Console]::CursorVisible = $false
        while ($true) {
            [Console]::SetCursorPosition(0, $top)
            Write-Host "请选择要绑定的渠道分组（↑/↓ 移动，空格勾选，Enter 确认，至少保留一项）："
            for ($index = 0; $index -lt $groups.Count; $index++) {
                $marker = if ($checked[$index]) { "[x]" } else { "[ ]" }
                $prefix = if ($index -eq $current) { ">" } else { " " }
                $color = if ($index -eq $current) { "Cyan" } else { "Gray" }
                $label = "$($groups[$index].name)（$($groups[$index].code)）"
                Write-Host (("{0} {1} {2}" -f $prefix, $marker, $label).PadRight(80)) -ForegroundColor $color
            }

            $pressed = [Console]::ReadKey($true)
            switch ($pressed.Key) {
                "UpArrow"   { $current = ($current - 1 + $groups.Count) % $groups.Count }
                "DownArrow" { $current = ($current + 1) % $groups.Count }
                "Spacebar"  { $checked[$current] = -not $checked[$current] }
                "Enter" {
                    # 至少要保留一个分组，否则新令牌绑不上任何渠道，等于一把打不开门的钥匙。
                    # 不满足时不 return，让 while 循环自然回到顶部重新渲染。
                    if (($checked | Where-Object { $_ }).Count -eq 0) {
                        [Console]::Beep()
                    } else {
                        $selected = [System.Collections.Generic.List[string]]::new()
                        for ($index = 0; $index -lt $groups.Count; $index++) {
                            if ($checked[$index]) { $selected.Add([string]$groups[$index].id) }
                        }
                        return $selected.ToArray()
                    }
                }
            }
        }
    } catch {
        # 控制台交互异常必须输出错误日志，并回退到默认分组（列表首项）
        Write-Warn "分组勾选界面不可用，将使用默认分组：$($_.Exception.Message)"
        return @([string]$groups[0].id)
    } finally {
        [Console]::CursorVisible = $oldCursorVisible
    }
}

# 决定新建令牌要绑定的渠道分组，结果写入 $script:SelectedChannelGroupIds
# （分组 ID 数组；为空表示不显式指定，交由服务端按默认分组处理）。
# 只在即将新建令牌时才有意义——命中同名令牌复用的话，这里的选择会被服务端忽略。
function Resolve-ChannelGroupSelection {
    $script:SelectedChannelGroupIds = @()

    if (-not [string]::IsNullOrWhiteSpace($ChannelGroups)) {
        # -ChannelGroups 显式给了编码：多为非交互批量装机场景，按编码精确匹配 ID，
        # 匹配不到就直接报错退出，不能悄悄换成别的分组。
        if (-not (Get-BindableChannelGroups)) {
            Write-Err "无法获取可绑定的渠道分组列表，-ChannelGroups 无法生效。"
            return $false
        }
        $ids = [System.Collections.Generic.List[string]]::new()
        foreach ($code in ($ChannelGroups -split ',')) {
            $code = $code.Trim()
            if ([string]::IsNullOrWhiteSpace($code)) { continue }
            $match = $script:BindableChannelGroups | Where-Object { $_.code -eq $code } | Select-Object -First 1
            if ($null -eq $match) {
                Write-Err "渠道分组编码不存在或当前账号不可绑定：$code"
                return $false
            }
            $ids.Add([string]$match.id)
        }
        $script:SelectedChannelGroupIds = $ids.ToArray()
        return $true
    }

    # 没有显式指定编码时，只有交互终端才弹出勾选界面；无人值守环境（CI、批量装机）
    # 保持沉默，交给服务端按默认分组处理，避免卡住自动化流程。
    if (-not ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected)) {
        return $true
    }

    if (-not (Get-BindableChannelGroups)) { return $true }
    if ($script:BindableChannelGroups.Count -eq 0) {
        # 没有可绑定分组是站点侧配置问题，留给 Invoke-KeyProvision 的失败提示报出明确原因
        return $true
    }
    if ($script:BindableChannelGroups.Count -eq 1) {
        $only = $script:BindableChannelGroups[0]
        Write-Info "当前账号只有一个可绑定渠道分组，已自动选择：$($only.name)（$($only.code)）"
        $script:SelectedChannelGroupIds = @([string]$only.id)
        return $true
    }

    $script:SelectedChannelGroupIds = Select-ChannelGroupsInteractively
    return $true
}

# 用登录令牌换取可用的 API Key。
# 服务端接口是幂等的：同名令牌已存在则复用，重复执行脚本不会刷出一堆令牌。
function Invoke-KeyProvision {
    Write-Info "正在获取 API Key..."

    $body = @{}
    if (-not [string]::IsNullOrWhiteSpace($TokenName)) { $body["name"] = $TokenName }
    if ($script:SelectedChannelGroupIds.Count -gt 0) {
        # 服务端只在新建令牌时读取该字段，复用同名令牌时会被忽略。
        $body["channel_group_ids"] = @($script:SelectedChannelGroupIds)
    }

    $result = Invoke-PlatformApi -Method "POST" -Path "/api/cli/provision" -Body $body -Jwt $script:PlatformJwt
    if (-not $result.Success) {
        if ($result.StatusCode -eq 401) {
            # 令牌过期或失效：清掉本地缓存，让调用方重新走登录流程
            Clear-Credential
            $script:PlatformJwt = ""
            Write-Err "登录状态已失效，请重新登录。"
        } else {
            # StatusCode 400 时是所选分组不可绑定（已被禁用/隐藏等），选择本身的问题，
            # 不清登录态，让调用方可以直接重跑一次选择分组的流程；其余情况按普通失败处理。
            Write-Err "获取 API Key 失败：$($result.Message)"
        }
        return ""
    }

    $key = $result.Data.data.key
    if ([string]::IsNullOrWhiteSpace($key)) {
        Write-Err "接口未返回 API Key，请登录网页后台手动创建令牌后使用 -Key 配置。"
        return ""
    }

    $script:AccountBalance = $result.Data.data.balance
    $label = $result.Data.data.token_name
    if ([string]::IsNullOrWhiteSpace($label)) { $label = "CLI 一键配置" }
    if ($result.Data.data.is_new) {
        Write-Ok "已为你创建 API Key：$label"
    } else {
        Write-Ok "已复用账号中已有的 API Key：$label"
    }

    # 展示实际绑定的分组，让用户在完成配置的同一屏就知道这把 Key 能访问什么，
    # 而不用再跳去网页后台确认。
    $boundGroups = @($result.Data.data.channel_groups)
    if ($boundGroups.Count -gt 0) {
        $groupsLabel = ($boundGroups | ForEach-Object { "$($_.name)（$($_.code)）" }) -join '、'
        Write-Info "已绑定渠道分组：$groupsLabel"
    }

    return $key
}

# 交互式选择获取 Key 的方式，返回 existing / session / login / register / manual
function Select-KeySourceInteractively {
    $labels = [System.Collections.Generic.List[string]]::new()
    $values = [System.Collections.Generic.List[string]]::new()

    # 已经配置过的用户重复执行脚本，多半只是想同步配置或换客户端，
    # 因此把「沿用当前 Key」放在第一位作为默认项。
    if (-not [string]::IsNullOrWhiteSpace($ExistingKey)) {
        $labels.Add("沿用当前 Key（$(Get-MaskedKey $ExistingKey)）")
        $values.Add("existing")
    }
    if (-not [string]::IsNullOrWhiteSpace($script:PlatformJwt)) {
        $labels.Add("使用已登录账号自动获取 Key（$($script:PlatformUsername)）")
        $values.Add("session")
    }
    $labels.Add("登录已有账号，自动获取 Key");   $values.Add("login")
    $labels.Add("注册新账号，自动获取 Key");     $values.Add("register")
    $labels.Add("手动粘贴已有的 API Key");       $values.Add("manual")

    $current = 0
    $top = [Console]::CursorTop
    $oldCursorVisible = [Console]::CursorVisible

    try {
        [Console]::CursorVisible = $false
        while ($true) {
            [Console]::SetCursorPosition(0, $top)
            Write-Host "请选择获取 API Key 的方式（↑/↓ 移动，Enter 确认）："
            for ($index = 0; $index -lt $labels.Count; $index++) {
                $prefix = if ($index -eq $current) { ">" } else { " " }
                $color = if ($index -eq $current) { "Cyan" } else { "Gray" }
                Write-Host (("{0} {1}" -f $prefix, $labels[$index]).PadRight(80)) -ForegroundColor $color
            }

            $pressed = [Console]::ReadKey($true)
            switch ($pressed.Key) {
                "UpArrow"   { $current = ($current - 1 + $labels.Count) % $labels.Count }
                "DownArrow" { $current = ($current + 1) % $labels.Count }
                "Enter"     { return $values[$current] }
            }
        }
    } catch {
        # 控制台交互异常必须输出错误日志，并回退到最保守的手动输入方式
        Write-Warn "选择器不可用，回退到手动输入 Key：$($_.Exception.Message)"
        return "manual"
    } finally {
        [Console]::CursorVisible = $oldCursorVisible
    }
}

# 走账号链路拿 Key：先确保有可用的登录令牌，再调用开通接口。
# Mode 取值 login / register / session；失败返回空字符串。
function Get-KeyViaAccount {
    param([string]$Mode)

    switch ($Mode) {
        "session" {
            # 复用本地缓存的登录令牌；若已失效则回退到登录流程
            if ([string]::IsNullOrWhiteSpace($script:PlatformJwt)) {
                if (-not (Invoke-AccountLogin)) { return "" }
            }
        }
        "login"    { if (-not (Invoke-AccountLogin))    { return "" } }
        "register" { if (-not (Invoke-AccountRegister)) { return "" } }
        default {
            Write-Err "未知的账号操作：$Mode"
            return ""
        }
    }

    # 只在真的可能新建令牌时才需要决定分组（复用同名令牌时服务端会忽略这里的选择，
    # 但事先无法知道会不会命中复用，因此统一在这里解析一次）。
    if (-not (Resolve-ChannelGroupSelection)) { return "" }

    $key = Invoke-KeyProvision
    if ([string]::IsNullOrWhiteSpace($key) -and [string]::IsNullOrWhiteSpace($script:PlatformJwt)) {
        # 令牌失效导致的失败已清空 JWT，这里再给一次登录机会，避免用户重跑整个脚本
        if ([Environment]::UserInteractive) {
            if (-not (Invoke-AccountLogin)) { return "" }
            if (-not (Resolve-ChannelGroupSelection)) { return "" }
            $key = Invoke-KeyProvision
        }
    }
    return $key
}

# ----------------------------- 读取 API Key ----------------------------------

# -Logout：只清除本地登录缓存，不触碰任何客户端配置
if ($Logout) {
    Clear-Credential
    Write-Ok "已清除本地登录缓存：$CredentialFile"
    exit 0
}

# 交互终端显示复选框；自动化环境未传 -Targets 时默认只配置 Codex。
if ($Show -and $Force) {
    Write-Err "-Show 与 -Force 不能同时使用。"
    exit 1
}
if (-not $Show -and [string]::IsNullOrWhiteSpace($Targets)) {
    if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
        $Targets = Select-TargetsInteractively
    } else {
        $Targets = "codex"
    }
}
if (-not $Show) {
    try {
        $Targets = ConvertTo-NormalizedTargets $Targets
    } catch {
        # 参数校验异常必须输出错误日志。
        Write-Err $_.Exception.Message
        exit 1
    }
    if ($Force -and -not (Test-TargetSelected "codex")) {
        Write-Warn "-Force 仅影响 Codex config.toml；当前未选择 codex，不会执行强制覆盖。"
    }
}

# 探测已有配置（用于展示当前 Key、支持"回车保留"）
$ExistingKey = Get-ExistingKey

# -Show 模式：只展示当前配置状态，不做任何修改
if ($Show) {
    if (-not [string]::IsNullOrWhiteSpace($ExistingKey)) {
        Write-Ok "已检测到 $ProviderName 配置"
        $m = Get-ExistingModel
        if ([string]::IsNullOrWhiteSpace($m)) { $m = "$DefaultCodexModel（未配置）" }
        Write-Host "  当前 API Key：$(Get-MaskedKey $ExistingKey)"
        $shownBaseUrl = Get-ExistingBaseUrl
        if ([string]::IsNullOrWhiteSpace($shownBaseUrl)) { $shownBaseUrl = $BaseUrl }
        Write-Host "  API 地址：    $shownBaseUrl"
        Write-Host "  Codex 模型：  $m"
        $shownCatalog = Get-ExistingModelCatalog
        if (-not [string]::IsNullOrWhiteSpace($shownCatalog)) {
            Write-Host "  Codex 模型目录：$shownCatalog"
        }
        $shownProfiles = @(Get-ManagedCodexProfiles)
        if ($shownProfiles.Count -gt 0) {
            Write-Host "  Codex 可切换模型（codex -p <名称>）：$($shownProfiles -join ', ')"
        } else {
            Write-Host "  Codex 可切换模型：尚未生成，重新执行 install.ps1 会按 /v1/models 生成 profiles"
        }
        Write-Host ""
        Write-Host "如需修改 Key，执行：irm $InstallerUrl | iex"
    } else {
        Write-Warn "尚未检测到 $ProviderName 配置，请先执行本脚本进行首次配置。"
    }
    exit 0
}

# 未用 -BaseUrlOverride 指定时，在交互模式下确认一次 API 地址：
# 服务可能部署在多个站点，写死单一地址会让其他部署的用户无从下手。
# 无人值守环境保持原样使用默认值，不阻断自动化脚本。
if ([string]::IsNullOrWhiteSpace($BaseUrlOverride) -and
    [Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    $defaultBaseUrl = Get-ExistingBaseUrl
    if ([string]::IsNullOrWhiteSpace($defaultBaseUrl)) { $defaultBaseUrl = $BaseUrl }
    $BaseUrl = Select-BaseUrlInteractively -DefaultUrl $defaultBaseUrl
    $CodexBaseUrl = "$BaseUrl/v1"
    $AnthropicBaseUrl = $BaseUrl
}

Write-Info "开始配置 $ProviderName 第三方 API"
Write-Info "本次选择的客户端：$Targets"
Write-Info "API 地址：$BaseUrl"
Write-Host ""

$ApiKey = $Key

# 仅在未通过 -Key 指定时才需要决定 Key 的来源
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    # 本地缓存的登录令牌若仍在有效期内，可直接用于开通，省掉一次登录
    Get-CachedCredential | Out-Null

    $KeySource = ""
    if ($Login)          { $KeySource = "login" }
    elseif ($Register)   { $KeySource = "register" }
    elseif ($ManualKey)  { $KeySource = "manual" }

    # 未通过开关指定来源时决定走哪条路径：有控制台就弹菜单让用户选；
    # 无人值守环境按已提供的参数推断，推断不出来时给出可直接照抄的命令。
    if ([string]::IsNullOrWhiteSpace($KeySource)) {
        if ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
            $KeySource = Select-KeySourceInteractively
        } elseif (-not [string]::IsNullOrWhiteSpace($script:PlatformJwt)) {
            $KeySource = "session"
        } elseif (-not [string]::IsNullOrWhiteSpace($Email)) {
            $KeySource = "register"
        } elseif ((-not [string]::IsNullOrWhiteSpace($Username)) -and (-not [string]::IsNullOrWhiteSpace($env:STALLIONX_PASSWORD))) {
            $KeySource = "login"
        } elseif (-not [string]::IsNullOrWhiteSpace($ExistingKey)) {
            $KeySource = "existing"
        } else {
            Write-Err "未提供 API Key，且当前环境无法交互。请任选一种非交互方式："
            Write-Err "  install.ps1 -Key <API_KEY>"
            Write-Err "  `$env:STALLIONX_PASSWORD='<密码>'; install.ps1 -Login -Username <账号>"
            Write-Err "  `$env:STALLIONX_PASSWORD='<密码>'; install.ps1 -Register -Email <邮箱>"
            exit 1
        }
    }

    if ($KeySource -eq "existing") {
        if ([string]::IsNullOrWhiteSpace($ExistingKey)) {
            Write-Err "本机没有检测到已配置的 API Key。"
            exit 1
        }
        $ApiKey = $ExistingKey
        Write-Info "沿用当前 Key，并重新同步所选客户端的配置。"
    } elseif ($KeySource -eq "session" -or $KeySource -eq "login" -or $KeySource -eq "register") {
        # 账号链路：登录或注册拿到 JWT，再换取可用的 API Key
        $ApiKey = Get-KeyViaAccount $KeySource
        if ([string]::IsNullOrWhiteSpace($ApiKey)) { exit 1 }
    } elseif ($KeySource -eq "manual") {
        if (-not [string]::IsNullOrWhiteSpace($ExistingKey)) {
            # 已配置过：展示掩码后的当前 Key，允许直接回车保留
            Write-Info "检测到已有配置：$EnvKeyName = $(Get-MaskedKey $ExistingKey)"
            $prompt = "请输入新的 $ProviderName API Key（输入不会显示；直接回车保留当前 Key）"
        } else {
            $prompt = "请输入你的 $ProviderName API Key（输入不会显示）"
        }

        # 使用 SecureString 读取，输入过程不回显，避免 Key 泄露在屏幕上
        $SecureKey = Read-Host $prompt -AsSecureString
        $ApiKey = ConvertFrom-SecureStringPlain $SecureKey

        # 输入为空时：已有配置则沿用旧 Key（可用于修复配置不同步），否则报错退出
        if ([string]::IsNullOrWhiteSpace($ApiKey)) {
            if (-not [string]::IsNullOrWhiteSpace($ExistingKey)) {
                $ApiKey = $ExistingKey
                Write-Info "未输入新 Key，将沿用当前 Key 并重新同步各处配置。"
            } else {
                Write-Err "API Key 不能为空，已退出。"
                exit 1
            }
        }
    } else {
        Write-Err "未知的 Key 获取方式：$KeySource"
        exit 1
    }
}

# 最终兜底校验，避免把空值写进配置文件
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    Write-Err "API Key 不能为空，已退出。"
    exit 1
}

# 提示本次将要写入的 Key（掩码），便于用户确认是否改对了
if ((-not [string]::IsNullOrWhiteSpace($ExistingKey)) -and ($ApiKey -ne $ExistingKey)) {
    Write-Info "API Key 将由 $(Get-MaskedKey $ExistingKey) 更新为 $(Get-MaskedKey $ApiKey)"
} else {
    Write-Info "本次写入的 API Key：$(Get-MaskedKey $ApiKey)"
}
Write-Host ""

# ======================= 第一部分：配置 Claude Code ===========================

# 合并写入 Claude 协议兼容客户端的 settings.json，保留其他已有配置。
#
# 写入的是 Anthropic 原生链路：ANTHROPIC_BASE_URL 为站点根地址，Claude Code
# 会自己请求 <根地址>/v1/messages。同时清掉 env 中会让客户端绕开这条链路的开关
# （Bedrock / Vertex 开关、与 ANTHROPIC_AUTH_TOKEN 冲突的 ANTHROPIC_API_KEY），
# 否则请求会转到别的网关或带着旧凭据发出，cache_control 与 anthropic-beta 也就
# 不可能原样透传到上游。成功提示由调用方在端点探测后给出。
function Set-AnthropicCompatibleSettings([string]$Directory, [string]$SettingsPath, [string]$ClientName) {
  try {
    # 确保目录存在
    if (-not (Test-Path $Directory)) {
        New-Item -ItemType Directory -Path $Directory -Force | Out-Null
    }
    # 读取已有配置做合并（保留用户其他配置项），不存在则新建空对象
    $settings = @{}
    if (Test-Path $SettingsPath) {
        $raw = Get-Content $SettingsPath -Raw
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
            # -AsHashtable 便于后续动态增删字段（PowerShell 5.1 不支持时退回 PSObject 处理）
            try {
                $settings = $raw | ConvertFrom-Json -AsHashtable
            } catch {
                $obj = $raw | ConvertFrom-Json
                $settings = @{}
                foreach ($p in $obj.PSObject.Properties) { $settings[$p.Name] = $p.Value }
            }
        }
    }

    # 写入 / 覆盖 env 块中的两个关键变量
    if (-not $settings.ContainsKey("env") -or $null -eq $settings["env"]) {
        $settings["env"] = @{}
    } elseif ($settings["env"] -isnot [hashtable]) {
        # ConvertFrom-Json 旧版本会得到 PSObject，这里统一转成 hashtable
        $envTable = @{}
        foreach ($p in $settings["env"].PSObject.Properties) { $envTable[$p.Name] = $p.Value }
        $settings["env"] = $envTable
    }
    $settings["env"]["ANTHROPIC_BASE_URL"]   = $AnthropicBaseUrl
    $settings["env"]["ANTHROPIC_AUTH_TOKEN"] = $ApiKey

    # 这些键会让 Claude Code 不再按 ANTHROPIC_BASE_URL 直连原生 /v1/messages
    $bypassKeys = @(
        "ANTHROPIC_API_KEY",
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "ANTHROPIC_BEDROCK_BASE_URL",
        "ANTHROPIC_VERTEX_BASE_URL"
    )
    $removedKeys = @($bypassKeys | Where-Object { $settings["env"].ContainsKey($_) })
    foreach ($bypassKey in $removedKeys) {
        $settings["env"].Remove($bypassKey)
    }
    if ($removedKeys.Count -gt 0) {
        Write-Info "已移除会绕开原生端点的配置项：$($removedKeys -join '、')"
    }

    # 写回文件（Depth 给足，避免深层结构被截断）
    Write-Utf8NoBomFile -Path $SettingsPath -Value ($settings | ConvertTo-Json -Depth 32)

    # settings.json 里保存的是长期有效的 API Key：去掉继承权限，只保留当前用户完全控制。
    # 部分受管环境不允许改 ACL，失败仅告警，不影响配置本身。
    try {
        & icacls $SettingsPath /inheritance:r /grant:r "$($env:USERNAME):(F)" | Out-Null
    } catch {
        Write-Warn "无法收紧 $SettingsPath 的访问权限：$($_.Exception.Message)"
    }
  } catch {
    # 异常时输出错误日志，方便排查。
    Write-Err "配置 $ClientName 失败：$($_.Exception.Message)"
    throw
  }
}

<#
 探测站点是否真的提供 Anthropic 原生端点 <根地址>/v1/messages。
 故意只发一个空 JSON：鉴权发生在请求体校验之前，所以状态码足以区分三种情况——
   404 / 405 / 501  站点没有这个端点，Claude Code 无法直连原生协议；
   401 / 403        端点存在，但当前 Key 没通过鉴权；
   其他             端点可达且鉴权通过（空请求体被判 400 属于预期结果）。
 刻意不发真实对话请求，避免为一次探测消耗账号额度。
 返回 $false 仅表示站点确认没有原生端点；网络不通等无法判定的情况返回 $true，只告警。
#>
function Test-AnthropicNativeEndpoint {
    $uri = "$AnthropicBaseUrl/v1/messages"
    $headers = @{
        "x-api-key"         = $ApiKey
        "anthropic-version" = "2023-06-01"
        "anthropic-beta"    = "prompt-caching-2024-07-31"
    }

    $statusCode = 0
    try {
        # -UseBasicParsing 让 Windows PowerShell 5.1 不依赖 IE 引擎；PowerShell 7 中为兼容保留的空操作
        $response = Invoke-WebRequest -Method Post -Uri $uri -Headers $headers -Body "{}" `
            -ContentType "application/json" -TimeoutSec 20 -UseBasicParsing -ErrorAction Stop
        $statusCode = [int]$response.StatusCode
    } catch {
        # 4xx/5xx 会抛异常，状态码在异常携带的响应对象上；没有响应对象说明是网络层失败
        if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
            $statusCode = [int]$_.Exception.Response.StatusCode
        } else {
            Write-Warn "无法连接 $uri，本次跳过原生端点探测：$($_.Exception.Message)"
            return $true
        }
    }

    if ($statusCode -in @(404, 405, 501)) {
        Write-Err "$uri 未提供 Anthropic 原生端点（HTTP $statusCode）。"
        Write-Err "只有直连该端点才能把 cache_control 标注和 anthropic-beta 头原样送到上游，请确认 API 地址填写是否正确。"
        return $false
    }
    if ($statusCode -in @(401, 403)) {
        Write-Warn "$uri 可达，但当前 API Key 未通过鉴权（HTTP $statusCode）；请确认 Key 是否有效。"
        return $true
    }
    Write-Ok "已确认 Anthropic 原生端点可用：$uri"
    return $true
}

$ClaudeNativeReady = $false   # Claude Code 的原生端点是否探测通过，决定完成提示的措辞

if (Test-TargetSelected "claude") {
    Write-Info "正在配置 Claude Code（$ClaudeSettings）..."
    try {
        Set-AnthropicCompatibleSettings -Directory $ClaudeDir -SettingsPath $ClaudeSettings -ClientName "Claude Code"
    } catch { exit 1 }
    # 先探测端点再下结论：地址填错时不该让用户先看到一句无条件的“配置完成”。
    # 探测失败也不中断整体安装，配置已经写好，用户改对地址后重跑即可。
    if (Test-AnthropicNativeEndpoint) {
        Write-Ok "Claude Code 配置完成（Anthropic 原生协议，直连 $AnthropicBaseUrl/v1/messages）。"
        $ClaudeNativeReady = $true
    } else {
        Write-Warn "配置已写入 $ClaudeSettings，但原生端点当前不可用；请换用正确的 API 地址后重新执行本脚本。"
    }
}

function New-CodeBuddyModelManifest {
    try {
        if (-not (Test-Path $CodeBuddyDir)) { New-Item -ItemType Directory -Path $CodeBuddyDir -Force | Out-Null }
        $headers = @{ Authorization = "Bearer $ApiKey"; Accept = "application/json" }
        $response = Invoke-RestMethod -Uri "$CodexBaseUrl/models" -Headers $headers -Method Get -TimeoutSec 20
        $modelIds = @($response.data | ForEach-Object { [string]$_.id } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
        if ($modelIds.Count -eq 0) { throw "StallionX /v1/models 未返回有效模型。" }
        $manifest = [ordered]@{ models = @($modelIds | ForEach-Object {
            [ordered]@{
                id = $_; name = $_; vendor = $ProviderName; url = "$CodexBaseUrl/chat/completions"; apiKey = "`${$EnvKeyName}"
                supportsToolCall = $true; supportsImages = ($_.ToLowerInvariant().Contains("image")); supportsReasoning = $true
            }
        }) }
        Write-Utf8NoBomFile -Path $CodeBuddyModelsFile -Value ($manifest | ConvertTo-Json -Depth 8)
        Write-Ok "CodeBuddy 模型配置完成：$CodeBuddyModelsFile"
    } catch {
        # 网络、解析或写入异常必须输出错误日志。
        Write-Err "生成 CodeBuddy models.json 失败：$($_.Exception.Message)"
        throw
    }
}

if (Test-TargetSelected "codebuddy") {
    Write-Info "正在生成 CodeBuddy 模型配置（$CodeBuddyModelsFile）..."
    try { New-CodeBuddyModelManifest } catch { exit 1 }
}

# WorkBuddy 使用顶层模型数组，并要求 URL 指向 OpenAI Compatible 的 /v1 根地址。
function New-WorkBuddyModelManifest {
    try {
        if (-not (Test-Path $WorkBuddyDir)) { New-Item -ItemType Directory -Path $WorkBuddyDir -Force | Out-Null }
        $headers = @{ Authorization = "Bearer $ApiKey"; Accept = "application/json" }
        $response = Invoke-RestMethod -Uri "$CodexBaseUrl/models" -Headers $headers -Method Get -TimeoutSec 20
        $modelIds = @($response.data | ForEach-Object { [string]$_.id } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
        if ($modelIds.Count -eq 0) { throw "StallionX /v1/models 未返回有效模型。" }
        $models = @($modelIds | ForEach-Object {
            [ordered]@{
                id = $_; name = $_; vendor = $ProviderName; url = $CodexBaseUrl; apiKey = $ApiKey
                supportsToolCall = $true; supportsImages = $true; supportsReasoning = $true; useCustomProtocol = $false
            }
        })
        # 必须用 -InputObject：管道传入数组时只有一个元素会被输出成单个对象，
        # 而 WorkBuddy 要求 models.json 顶层是数组。
        Write-Utf8NoBomFile -Path $WorkBuddyModelsFile -Value (ConvertTo-Json -InputObject $models -Depth 8)
        Write-Ok "WorkBuddy 模型配置完成：$WorkBuddyModelsFile"
    } catch {
        # 网络、解析或写入异常必须输出错误日志。
        Write-Err "生成 WorkBuddy models.json 失败：$($_.Exception.Message)"
        throw
    }
}

if (Test-TargetSelected "workbuddy") {
    Write-Info "正在生成 WorkBuddy 模型配置（$WorkBuddyModelsFile）..."
    try { New-WorkBuddyModelManifest } catch { exit 1 }
}

# ========================== 第二部分：生成 Trae 配置 =========================

# Trae 没有公开稳定的配置文件导入格式，因此生成全部模型清单和操作说明。
function New-TraeModelManifest {
    try {
        if (-not (Test-Path $TraeConfigDir)) {
            New-Item -ItemType Directory -Path $TraeConfigDir -Force | Out-Null
        }
        $headers = @{ Authorization = "Bearer $ApiKey"; Accept = "application/json" }
        $response = Invoke-RestMethod -Uri "$CodexBaseUrl/models" -Headers $headers -Method Get -TimeoutSec 20
        $modelIds = @($response.data | ForEach-Object { [string]$_.id } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
        if ($modelIds.Count -eq 0) { throw "StallionX /v1/models 未返回有效模型。" }

        $manifest = [ordered]@{
            description = "Trae 自定义模型配置清单；请在 Settings > Models 中导入或逐项添加。"
            provider = $ProviderName
            api_format = "OpenAI Compatible"
            base_url = $CodexBaseUrl
            full_url = $false
            api_key = $ApiKey
            models = @($modelIds | ForEach-Object { [ordered]@{ model_id = $_; multimodal = $true } })
        }
        Write-Utf8NoBomFile -Path $TraeModelsFile -Value ($manifest | ConvertTo-Json -Depth 8)

        $guide = @"
# Trae 使用 StallionX 模型

模型清单位于：``$TraeModelsFile``。

1. 打开 Trae 的 ``Settings > Models``。
2. 点击 ``Add Model``，选择 ``Custom configuration``。
3. API Format 选择 ``OpenAI Compatible``。
4. 关闭 ``Full URL``，Base URL 填写 ``$CodexBaseUrl``。
5. 从 ``models.json`` 复制每个 ``model_id``，并使用其中的 ``api_key``。

Trae 当前未公开稳定的配置导入格式；若当前版本支持导入，可尝试选择 ``models.json``，否则请逐项添加。
"@
        Write-Utf8NoBomFile -Path $TraeGuideFile -Value $guide
        Write-Ok "Trae 模型配置清单已生成：$TraeModelsFile"
        Write-Ok "Trae 导入/添加说明已生成：$TraeGuideFile"
    } catch {
        # 网络、解析或写入异常必须输出错误日志。
        Write-Err "生成 Trae 配置清单失败：$($_.Exception.Message)"
        throw
    }
}

if (Test-TargetSelected "trae") {
    Write-Info "正在获取模型并生成 Trae 配置清单（$TraeModelsFile）..."
    try { New-TraeModelManifest } catch { exit 1 }
}
# ========================== 第二部分（续）：配置 pi ==========================

# pi（pi coding agent，https://github.com/badlogic/pi-mono）通过 ~/.pi/agent/models.json
# 的 providers 段接入自定义 provider。这里按 StallionX /v1/models 生成两个 provider：
#   - <ProviderId>：OpenAI 兼容入口（根地址 + /v1）。provider 级 api 为 chat completions，
#     GPT-5 / GPT-6 / o 系列 / codex 模型在模型级覆盖为 openai-responses，与 Codex 走同一条链路；
#   - <ProviderId>-anthropic：只放 Claude 模型，api 为 anthropic-messages，baseUrl 是站点
#     根地址（pi 内部用 Anthropic SDK，自己拼 /v1/messages）。和 Claude Code 一样，只有原生
#     链路能把 cache_control 与 anthropic-beta 原样透传，Prompt Caching 才有效。
# 文件里用户自己加的其他 provider 一律保留，只覆盖这两个 id；解析失败的旧文件先备份再重建。
# pi 会在打开 /model 菜单时重新读取该文件，不需要重启。

# pi 对 apiKey 做 $VAR 插值、! 前缀当作命令执行；字面量必须按其转义规则写入。
function ConvertTo-PiSecretLiteral([string]$Value) {
    $escaped = $Value.Replace('$', '$$')
    if ($escaped.StartsWith('!')) { $escaped = '$!' + $escaped.Substring(1) }
    return $escaped
}

# 按模型 ID 推断 pi 需要的能力元数据；猜不准的字段不写，让 pi 用默认值。
function New-PiModelEntry([string]$ModelId) {
    $lower = $ModelId.ToLowerInvariant()
    $isClaude = $lower.StartsWith("claude")
    $isGpt5Family = $lower -match '^gpt-[5-9]'
    $isOSeries = $lower -match '^o[1-9]'
    $isCodex = $lower.Contains("codex")
    $isGemini = $lower.StartsWith("gemini")

    $entry = [ordered]@{ id = $ModelId; name = $ModelId }
    if ($isClaude) {
        $entry.api = "anthropic-messages"
    } elseif ($isGpt5Family -or $isOSeries -or $isCodex) {
        # 与 Codex 一致走 Responses；其余模型沿用 provider 级的 chat completions。
        $entry.api = "openai-responses"
    }
    $entry.reasoning = [bool]($isClaude -or $isGpt5Family -or $isOSeries -or $isCodex -or ($lower -match 'thinking|reason|(^|[-_/])r1'))
    if ($isClaude -or $lower.StartsWith("gpt") -or $isOSeries -or $isGemini -or ($lower -match 'vision|[-_]vl')) {
        $entry.input = @("text", "image")
    } else {
        $entry.input = @("text")
    }
    if ($isClaude) {
        $entry.contextWindow = 200000; $entry.maxTokens = 32000
    } elseif ($isGpt5Family -or $isCodex) {
        $entry.contextWindow = 400000; $entry.maxTokens = 128000
    } elseif ($isOSeries) {
        $entry.contextWindow = 200000; $entry.maxTokens = 100000
    } elseif ($isGemini) {
        $entry.contextWindow = 1000000; $entry.maxTokens = 65536
    }
    return $entry
}

function New-PiModelManifest {
    try {
        if (-not (Test-Path $PiConfigDir)) {
            New-Item -ItemType Directory -Path $PiConfigDir -Force | Out-Null
        }
        $headers = @{ Authorization = "Bearer $ApiKey"; Accept = "application/json" }
        $response = Invoke-RestMethod -Uri "$CodexBaseUrl/models" -Headers $headers -Method Get -TimeoutSec 20
        # 与 Codex 目录同一套过滤口径：只保留对话模型，ID 字符集必须可安全写入配置。
        $modelIds = @($response.data |
            ForEach-Object { ([string]$_.id).Trim() } |
            Where-Object { $_ -match '^[A-Za-z0-9._:/-]+$' -and $_ -notmatch '(?i)image|embed|tts|whisper|audio|realtime|moderation' } |
            Sort-Object -Unique)
        if ($modelIds.Count -eq 0) { throw "StallionX /v1/models 未返回可用于 pi 的对话模型。" }

        $claudeModels = [System.Collections.Generic.List[object]]::new()
        $openaiModels = [System.Collections.Generic.List[object]]::new()
        foreach ($modelId in $modelIds) {
            $entry = New-PiModelEntry $modelId
            if ($entry.Contains("api") -and $entry.api -eq "anthropic-messages") {
                $entry.Remove("api")
                $claudeModels.Add($entry)
            } else {
                $openaiModels.Add($entry)
            }
        }

        # 读取旧文件并合并；不是合法 JSON 对象时先备份再重建，并告警说明去向。
        $config = $null
        if (Test-Path $PiModelsFile) {
            try {
                $raw = Get-Content -Path $PiModelsFile -Raw -Encoding UTF8
                if (-not [string]::IsNullOrWhiteSpace($raw)) {
                    $config = $raw | ConvertFrom-Json
                    if ($config -isnot [System.Management.Automation.PSCustomObject]) {
                        throw "顶层不是 JSON 对象"
                    }
                }
            } catch {
                $backupPath = "$PiModelsFile.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
                Write-Warn "$PiModelsFile 不是合法的 pi 配置（$($_.Exception.Message)），已备份到 $backupPath 后重建。"
                Copy-Item -Path $PiModelsFile -Destination $backupPath -Force
                $config = $null
            }
        }
        if ($null -eq $config) { $config = [PSCustomObject]@{} }
        $providersProp = $config.PSObject.Properties['providers']
        if ($null -eq $providersProp -or $providersProp.Value -isnot [System.Management.Automation.PSCustomObject]) {
            $config | Add-Member -NotePropertyName providers -NotePropertyValue ([PSCustomObject]@{}) -Force
        }
        $providers = $config.providers
        $secret = ConvertTo-PiSecretLiteral $ApiKey

        if ($openaiModels.Count -gt 0) {
            $openaiProvider = [ordered]@{
                name = $ProviderName
                baseUrl = "$CodexBaseUrl"
                api = "openai-completions"
                apiKey = $secret
                models = @($openaiModels)
            }
            $providers | Add-Member -NotePropertyName $PiProviderId -NotePropertyValue ([PSCustomObject]$openaiProvider) -Force
        } elseif ($null -ne $providers.PSObject.Properties[$PiProviderId]) {
            $providers.PSObject.Properties.Remove($PiProviderId)
        }
        if ($claudeModels.Count -gt 0) {
            $anthropicProvider = [ordered]@{
                name = "$ProviderName (Anthropic)"
                baseUrl = "$AnthropicBaseUrl"
                api = "anthropic-messages"
                apiKey = $secret
                models = @($claudeModels)
            }
            $providers | Add-Member -NotePropertyName $PiAnthropicProviderId -NotePropertyValue ([PSCustomObject]$anthropicProvider) -Force
        } elseif ($null -ne $providers.PSObject.Properties[$PiAnthropicProviderId]) {
            # 站点已下线全部 Claude 模型时，同步移除旧的 Anthropic provider，避免菜单里留下失效项。
            $providers.PSObject.Properties.Remove($PiAnthropicProviderId)
        }

        Write-Utf8NoBomFile -Path $PiModelsFile -Value ($config | ConvertTo-Json -Depth 12)
        # models.json 含明文 API Key，收紧为仅当前用户可访问；改 ACL 失败只告警。
        try {
            & icacls $PiModelsFile /inheritance:r /grant:r "$($env:USERNAME):(F)" | Out-Null
        } catch {
            Write-Warn "无法收紧 $PiModelsFile 的访问权限：$($_.Exception.Message)"
        }
        Write-Info "pi 模型：Anthropic 原生 $($claudeModels.Count) 个，OpenAI 兼容 $($openaiModels.Count) 个。"
        Write-Ok "pi 模型配置完成：$PiModelsFile"
    } catch {
        # 网络、解析或写入异常必须输出错误日志。
        Write-Err "生成 pi 模型配置失败：$($_.Exception.Message)"
        throw
    }
}

if (Test-TargetSelected "pi") {
    Write-Info "正在获取模型并生成 pi 配置（$PiModelsFile）..."
    try { New-PiModelManifest } catch { exit 1 }
}
# ========================= 第三部分：配置 Codex ===============================

if (Test-TargetSelected "codex") {
Write-Info "正在配置 Codex（$CodexConfig）..."

try {
    if (-not (Test-Path $CodexDir)) {
        New-Item -ItemType Directory -Path $CodexDir -Force | Out-Null
    }

    # 先拉取模型并生成目录，再决定增量或强制写配置。-Force 下若目录生成失败，会在
    # 备份和覆盖旧配置之前退出，避免把用户原本可用的配置替换成半成品。
    Write-Info "正在获取 $ProviderName 模型列表，刷新 Codex 模型目录与 profiles..."
    $codexCatalogReady = $false
    $codexModelIds = @()
    try {
        $codexModelIds = Get-CodexModelIds
        New-CodexModelCatalog -ModelIds $codexModelIds
        $codexCatalogReady = $true
        Write-Ok "已刷新 Codex 模型选择器目录：$CodexModelCatalog"
        $codexProfileNames = Write-CodexProfiles -ModelIds $codexModelIds
        Write-Ok "已生成 $($codexProfileNames.Count) 个 Codex profile（$CodexDir\<名称>.config.toml）"
    } catch {
        # 网络、解析或写入异常必须输出错误日志；普通模式保留旧目录，强制模式后续中止。
        Write-Err "获取 StallionX 模型列表失败：$($_.Exception.Message)"
        Write-Warn "本次未能刷新 Codex 模型目录与 profiles（已有文件原样保留）。"
    }

    $script:CodexBackupPath = ""
    if ($Force) {
        if (-not $codexCatalogReady) {
            throw "-Force 需要先成功生成 Codex 模型目录；旧 config.toml 未被覆盖。"
        }
        $CodexModel = if ($codexModelIds -contains $DefaultCodexModel) {
            $DefaultCodexModel
        } else {
            [string]$codexModelIds[0]
        }
        $script:CodexBackupPath = Backup-CodexConfig
        if (-not [string]::IsNullOrWhiteSpace($script:CodexBackupPath)) {
            Write-Ok "已备份原 Codex 配置：$($script:CodexBackupPath)"
        }
        Write-ForcedCodexConfig -Model $CodexModel
        Write-Ok "已强制覆盖 $CodexConfig"
    } else {
        # 普通模式保留用户默认模型与其他配置。只有目录未配置或已由本脚本管理时，才把
        # 模型选择器指向本次刷新的 StallionX 目录。
        $CodexModel = Get-ExistingModel
        if (-not [string]::IsNullOrWhiteSpace($CodexModel)) {
            Write-Info "保留 config.toml 中已有的模型配置：$CodexModel"
        } else {
            $CodexModel = if ($codexModelIds.Count -gt 0 -and $codexModelIds -notcontains $DefaultCodexModel) {
                [string]$codexModelIds[0]
            } else {
                $DefaultCodexModel
            }
        }
        $catalogForConfig = ""
        $existingCatalog = Get-ExistingModelCatalog
        if ($codexCatalogReady) {
            if ([string]::IsNullOrWhiteSpace($existingCatalog) -or (Test-ManagedCodexCatalogPath $existingCatalog)) {
                $catalogForConfig = $CodexModelCatalog
            } else {
                Write-Warn "保留自定义 model_catalog_json：$existingCatalog；如需让 StallionX 模型覆盖选择器，请使用 -Force。"
            }
        }
        Update-CodexConfig -Model $CodexModel -ModelCatalogPath $catalogForConfig
        Write-Ok "已增量更新 $CodexConfig（其他用户配置已保留）"
    }

    # 写入 auth.json 作为 Key 的本地备份。
    # 自定义 provider 不使用 auth.json 完成请求鉴权；该文件仅作为本地备份。
    Write-Utf8NoBomFile -Path $CodexAuth -Value (@{ OPENAI_API_KEY = $ApiKey } | ConvertTo-Json)
    Write-Ok "已写入 $CodexAuth"
} catch {
    # 异常时输出错误日志，方便排查
    Write-Err "配置 Codex 失败：$($_.Exception.Message)"
    exit 1
}
}

# ==================== 第四部分：持久化环境变量 ================================

# 同步写入用户级环境变量，供其他兼容工具使用。Codex 直接从 config.toml
# 读取凭据，不依赖当前父终端是否重新加载环境变量。
# 直接 Set 即为覆盖，因此修改 Key 时不会残留旧值。
if ((Test-TargetSelected "codex") -or (Test-TargetSelected "codebuddy")) {
Write-Info "正在写入用户级环境变量 $EnvKeyName ..."

try {
    [Environment]::SetEnvironmentVariable($EnvKeyName, $ApiKey, "User")
    # 同时写入当前会话，当前窗口无需重启即可使用
    Set-Item -Path "Env:$EnvKeyName" -Value $ApiKey
    Write-Ok "环境变量 $EnvKeyName 已写入（用户级）"
} catch {
    # 异常时输出错误日志，方便排查
    Write-Err "写入环境变量失败：$($_.Exception.Message)"
    exit 1
}
}

# ----------------------------- 完成提示 --------------------------------------

Write-Host ""
Write-Ok "全部配置完成！当前 API Key：$(Get-MaskedKey $ApiKey)"
Write-Host "已配置客户端：$Targets"
if (-not [string]::IsNullOrWhiteSpace($script:PlatformUsername)) {
    Write-Host "当前账号：$($script:PlatformUsername)"
}

# 账号余额为 0 时配置虽然写好了，第一个请求仍会失败。这里把余额和充值入口
# 直接摆在完成提示里，避免用户以为是配置出了问题。
if ($null -ne $script:AccountBalance) {
    $balanceValue = 0
    [double]::TryParse([string]$script:AccountBalance, [ref]$balanceValue) | Out-Null
    if ($balanceValue -gt 0) {
        Write-Host "账号余额：`$$($script:AccountBalance)"
    } else {
        Write-Warn "账号余额为 0，现在发起请求会被拒绝。请先充值：$BaseUrl"
    }
}
Write-Host ""
Write-Host "后续步骤："
Write-Host "  1. 重新启动所选客户端，使其加载最新配置"
if ((Test-TargetSelected "claude") -and $ClaudeNativeReady) {
    Write-Host "  - Claude Code 已固定走 Anthropic 原生协议，请求直达 $AnthropicBaseUrl/v1/messages"
    Write-Host "    （cache_control 与 anthropic-beta 头原样透传；请勿把 ANTHROPIC_BASE_URL 改成带 /v1 的 OpenAI 兼容地址）"
}
if ((Test-TargetSelected "codex") -or (Test-TargetSelected "codebuddy")) {
    Write-Host "  - Codex 配置可即时生效；CodeBuddy 及其他工具读取环境变量时需重新打开终端"
}
if (Test-TargetSelected "codex") {
    if (Test-Path $CodexModelCatalog) {
        Write-Host "  - Codex 模型选择器已刷新；请完全退出并重新启动 Codex 后加载最新列表"
    }
    $doneProfiles = @(Get-ManagedCodexProfiles)
    if ($doneProfiles.Count -gt 0) {
        Write-Host "  - Codex CLI 也可使用 codex -p <名称> 切换，可选："
        Write-Host "      $($doneProfiles -join ', ')"
    }
    if (-not [string]::IsNullOrWhiteSpace($script:CodexBackupPath)) {
        Write-Host "  - 原 Codex 配置备份：$($script:CodexBackupPath)"
    }
}
if (Test-TargetSelected "trae") {
    Write-Host "  - Trae：请打开 $TraeGuideFile，按说明导入或添加全部模型"
}
if (Test-TargetSelected "pi") {
    Write-Host "  - pi：在 pi 里执行 /model 即可看到 $PiProviderId / $PiAnthropicProviderId 两个 provider 下的模型，无需重启"
    Write-Host "    （Claude 模型走 Anthropic 原生协议直达 $AnthropicBaseUrl/v1/messages，其余走 $CodexBaseUrl）"
}
if (Test-TargetSelected "workbuddy") {
    Write-Host "  - WorkBuddy：请重启应用，以重新加载 $WorkBuddyModelsFile"
}
Write-Host ""
Write-Host "以后想修改 API Key，重新执行即可：irm $InstallerUrl | iex"
if (-not [string]::IsNullOrWhiteSpace($script:PlatformJwt)) {
    Write-Host "本机已缓存登录状态（24 小时内免登录）；清除请执行：& ([scriptblock]::Create((irm $InstallerUrl))) -Logout"
}
