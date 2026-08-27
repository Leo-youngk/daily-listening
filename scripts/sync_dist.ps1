# 抓取完成后，把素材同步到构建产物（开发模式不需要此脚本）
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root "app\dist"
$pub = Join-Path $root "public"

if (-not (Test-Path $dist)) { Write-Error "dist 不存在，请先在 app 目录执行 npm run build"; exit 1 }

foreach ($dir in "audio", "data", "icons", "covers") {
    $src = Join-Path $pub $dir
    $dst = Join-Path $dist $dir
    if (Test-Path $src) {
        Copy-Item $src $dst -Recurse -Force
        Write-Host "synced $dir"
    }
}
# Cloudflare Pages 自定义响应头（音频长缓存）
$headers = Join-Path $pub "_headers"
if (Test-Path $headers) {
    Copy-Item $headers (Join-Path $dist "_headers") -Force
    Write-Host "synced _headers"
}

# 音频全量转码为 48kbps 单声道（仅处理 dist，不碰源素材；可重入）
# 注意：npm run build 会清空 dist，所以转码必须放在同步之后
Write-Host "transcoding audio..."
python (Join-Path $PSScriptRoot "transcode_big.py")
if ($LASTEXITCODE -ne 0) { Write-Error "转码失败"; exit 1 }

Write-Host "done -> $dist"
