#!/usr/bin/env python3
# 用 regenin (Nano Banana 2) 图片接口生成 18 张场景图 → 转 WebP → 落 assets/images/
# 传输走 curl（其 CA/UA 可正常通过 Cloudflare 与 TLS），避开 Python SSL 问题。
# 密钥只经环境变量 REGENIN_TOKEN 传入，绝不写进文件。
#   export REGENIN_TOKEN=sk-...
#   python3 work/gen-regenin.py                 # 生成全部缺失
#   python3 work/gen-regenin.py 07-storm 14-mall  # 只做指定几张

import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPTS = os.path.join(ROOT, "work", "prompts.json")
OUTDIR = os.path.join(ROOT, "outputs", "beijing-rider-game", "assets", "images")
TMPDIR = os.path.join(ROOT, "work", "imagegen")
API = os.environ.get("REGENIN_API", "https://img.regenin.online/api/chat")
TOKEN = os.environ.get("REGENIN_TOKEN", "")
MODEL = os.environ.get("REGENIN_MODEL", "Google Nano Banana 2")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

URL_RE = re.compile(r"https://cdn\.oreateai\.com/[^\s\)\"]+\.(?:png|jpg|jpeg|webp)")


def gen_one(style, key, prompt):
    body = json.dumps({
        "type": "image", "model": MODEL,
        "prompt": style + "\n\nScene: " + prompt,
        "resolution": "1K", "ratio": "16:9",
    })
    p = subprocess.run([
        "curl", "-sS", "-N", "--max-time", "240", API,
        "-A", UA,
        "-H", "Authorization: Bearer " + TOKEN,
        "-H", "Content-Type: application/json",
        "-H", "Accept: text/event-stream",
        "-d", body,
    ], capture_output=True, text=True)
    if p.returncode != 0:
        raise RuntimeError("curl failed: " + (p.stderr or "")[:180])
    raw = p.stdout
    urls = URL_RE.findall(raw)
    if not urls:
        raise RuntimeError("no image url in stream: " + raw[-200:])
    img_url = urls[-1]

    png = os.path.join(TMPDIR, key + ".png")
    d = subprocess.run(["curl", "-sS", "-L", "--max-time", "180", "-A", UA, img_url, "-o", png],
                       capture_output=True, text=True)
    if d.returncode != 0 or not os.path.exists(png) or os.path.getsize(png) < 1000:
        raise RuntimeError("download failed: " + (d.stderr or "")[:180])
    webp = os.path.join(OUTDIR, key + ".webp")
    subprocess.run(["cwebp", "-quiet", "-q", "82", png, "-o", webp], check=True)
    return webp


def main():
    if not TOKEN:
        print("ERROR: set REGENIN_TOKEN env var", file=sys.stderr); sys.exit(1)
    os.makedirs(OUTDIR, exist_ok=True); os.makedirs(TMPDIR, exist_ok=True)
    cfg = json.load(open(PROMPTS, encoding="utf-8"))
    only = set(sys.argv[1:])
    ok = fail = 0
    failed_keys = []
    for im in cfg["images"]:
        key = im["key"]
        if only and key not in only:
            continue
        dest = os.path.join(OUTDIR, key + ".webp")
        if not only and os.path.exists(dest):
            print("skip (exists):", key); continue
        try:
            print("generating:", key, "...", flush=True)
            path = gen_one(cfg["style"], key, im["prompt"])
            print("  ->", os.path.relpath(path, ROOT), "(%d bytes)" % os.path.getsize(path))
            ok += 1
        except Exception as e:
            print("  FAILED:", e, file=sys.stderr); fail += 1; failed_keys.append(key)
    print("\ndone. ok=%d fail=%d" % (ok, fail))
    if failed_keys:
        print("重跑失败项：python3 work/gen-regenin.py " + " ".join(failed_keys))
    sys.exit(2 if fail else 0)


if __name__ == "__main__":
    main()
