#!/usr/bin/env python3
# 生成 18 张场景图并转为 WebP，落盘到 outputs/beijing-rider-game/assets/images/
#
# 用法（密钥只经环境变量，绝不写进任何文件）：
#   export IMG_API=http://136.115.80.70/v1
#   export IMG_TOKEN=<管理密钥>
#   python3 work/generate-images.py                # 生成全部缺失的
#   python3 work/generate-images.py 07-storm 12-phonelost   # 只重做指定几张
#
# 需要 cwebp（brew install webp）。当前该 API 的图片额度 429 时会明确报错，
# 额度恢复后重跑即可；文件名与 story.js 的 IMAGES 一一对应，无需改代码。

import base64, json, os, subprocess, sys, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROMPTS = os.path.join(ROOT, "work", "prompts.json")
OUTDIR = os.path.join(ROOT, "outputs", "beijing-rider-game", "assets", "images")
TMPDIR = os.path.join(ROOT, "work", "imagegen")

API = os.environ.get("IMG_API", "http://136.115.80.70/v1").rstrip("/")
TOKEN = os.environ.get("IMG_TOKEN", "")
MODEL = os.environ.get("IMG_MODEL", "gpt-image-2")


def die(msg):
    print("ERROR:", msg, file=sys.stderr)
    sys.exit(1)


def load_prompts():
    with open(PROMPTS, encoding="utf-8") as f:
        return json.load(f)


def gen_one(style, size, key, prompt):
    body = json.dumps({
        "model": MODEL,
        "prompt": style + "\n\nScene: " + prompt,
        "size": size,
        "n": 1,
    }).encode("utf-8")
    req = urllib.request.Request(
        API + "/images/generations", data=body,
        headers={"Authorization": "Bearer " + TOKEN,
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "ignore")[:200]
        raise RuntimeError("HTTP %s: %s" % (e.code, detail))

    item = (data.get("data") or [{}])[0]
    png = os.path.join(TMPDIR, key + ".png")
    if item.get("b64_json"):
        with open(png, "wb") as f:
            f.write(base64.b64decode(item["b64_json"]))
    elif item.get("url"):
        with urllib.request.urlopen(item["url"], timeout=180) as r:
            with open(png, "wb") as f:
                f.write(r.read())
    else:
        raise RuntimeError("no image in response: " + json.dumps(data)[:200])

    webp = os.path.join(OUTDIR, key + ".webp")
    subprocess.run(["cwebp", "-quiet", "-q", "82", png, "-o", webp], check=True)
    return webp


def main():
    if not TOKEN:
        die("set IMG_TOKEN env var (never store the key in a file)")
    if subprocess.run(["which", "cwebp"], capture_output=True).returncode != 0:
        die("cwebp not found — run: brew install webp")

    os.makedirs(OUTDIR, exist_ok=True)
    os.makedirs(TMPDIR, exist_ok=True)

    cfg = load_prompts()
    only = set(sys.argv[1:])
    todo = [im for im in cfg["images"] if not only or im["key"] in only]

    ok, fail = 0, 0
    for im in todo:
        key = im["key"]
        dest = os.path.join(OUTDIR, key + ".webp")
        if not only and os.path.exists(dest):
            print("skip (exists):", key)
            continue
        try:
            print("generating:", key, "...", flush=True)
            path = gen_one(cfg["style"], cfg.get("size", "1024x1024"), key, im["prompt"])
            print("  ->", os.path.relpath(path, ROOT))
            ok += 1
        except Exception as e:
            print("  FAILED:", e, file=sys.stderr)
            fail += 1

    print("\ndone. ok=%d fail=%d" % (ok, fail))
    if fail:
        print("额度/网络恢复后，重跑本脚本即可补齐失败项。")
        sys.exit(2)


if __name__ == "__main__":
    main()
