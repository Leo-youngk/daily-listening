$envPath = Join-Path $PSScriptRoot '..\.env.cloudflare.local'
if (-not (Test-Path -LiteralPath $envPath)) {
    throw "缺少本地 Cloudflare 凭据文件：$envPath"
}

foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^(?<key>[^#=]+)=(?<value>.*)$') {
        [Environment]::SetEnvironmentVariable($matches.key, $matches.value, 'Process')
    }
}
