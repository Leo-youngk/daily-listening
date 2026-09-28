#!/usr/bin/env bash
# 精选各期的中文翻译：Gemini 免费层经常过载或当天额度用完，每 10 分钟重试一次，
# 直到 episodes.json 里 10 期精选都有合格的中文缓存（最多试 8 小时）。
cd "$(dirname "$0")"
missing() {
  python - <<'PY'
import json, os, re
eps = json.load(open("corpus/episodes.json", encoding="utf-8"))
cjk = re.compile(r"[一-鿿]")
out = []
for slug, ep in eps.items():
    if ep.get("series") != "featured":
        continue
    path = os.path.join("corpus", "zh", slug + ".json")
    ok = False
    if os.path.exists(path):
        zh = json.load(open(path, encoding="utf-8"))["zh"]
        ok = sum(1 for z in zh if cjk.search(z)) >= 0.9 * len(zh)
    if not ok:
        out.append(slug)
featured = sum(1 for ep in eps.values() if ep.get("series") == "featured")
print(f"{featured} {len(out)}")
PY
}
for i in $(seq 1 48); do
  # Windows 版 python 输出带回车符，不去掉的话 bash 比较整数会报错
  counts=$(missing | tr -cd '0-9 ')
  featured=${counts%% *}
  left=${counts##* }
  echo "[$(date +%H:%M)] 精选已入库 $featured 期，缺翻译 $left 期"
  if [ "$featured" -ge 10 ] && [ "$left" -eq 0 ]; then
    echo "全部翻完"
    exit 0
  fi
  if [ "$left" -gt 0 ]; then
    python -u build_talks.py --translate-only --workers 3 2>&1 | grep -E "zh|!!|Error|额度|FAIL" | tail -20
  fi
  sleep 600
done
echo "超时仍未翻完"
exit 1
