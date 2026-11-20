"""Turn the generated university concept art into a 2-frame 208x208 spritesheet."""
from PIL import Image, ImageEnhance, ImageFilter

SRC = r'C:\Users\sz\.cursor\projects\d-workspace-ai-ai-town\assets\university-modern-sprite.jpg'
OUT = r'd:\workspace\ai\ai-town\public\assets\spritesheets\university.png'
SIZE = 208


def to_rgba(im: Image.Image) -> Image.Image:
    im = im.convert('RGBA')
    px = im.load()
    w, h = im.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            mx = max(r, g, b)
            mn = min(r, g, b)
            # Uniform light-gray / near-white studio backdrop.
            if mx >= 195 and (mx - mn) <= 28:
                px[x, y] = (0, 0, 0, 0)
            # Near-black empty corners sometimes left by generators.
            elif mx <= 18 and (mx - mn) <= 8:
                px[x, y] = (0, 0, 0, 0)
    return im


def crop_content(im: Image.Image, pad: int = 8) -> Image.Image:
    bbox = im.getbbox()
    if not bbox:
        return im
    x0, y0, x1, y1 = bbox
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(im.width, x1 + pad)
    y1 = min(im.height, y1 + pad)
    return im.crop((x0, y0, x1, y1))


def fit_square(im: Image.Image, size: int) -> Image.Image:
    im = im.filter(ImageFilter.MedianFilter(size=3))
    scale = min((size - 8) / im.width, (size - 8) / im.height)
    nw = max(1, int(im.width * scale))
    nh = max(1, int(im.height * scale))
    resized = im.resize((nw, nh), Image.Resampling.NEAREST)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(resized, ((size - nw) // 2, size - nh - 2), resized)
    return canvas


def glow_windows(im: Image.Image) -> Image.Image:
    out = im.copy()
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 200:
                continue
            # Cool glass / interior light accents for modern facade.
            if b > 120 and g > 90 and r < b + 20 and b >= r:
                px[x, y] = (min(255, r + 8), min(255, g + 14), min(255, b + 22), a)
    return ImageEnhance.Brightness(out).enhance(1.02)


def main():
    raw = Image.open(SRC)
    cut = fit_square(crop_content(to_rgba(raw)), SIZE)
    frame2 = glow_windows(cut)
    sheet = Image.new('RGBA', (SIZE * 2, SIZE), (0, 0, 0, 0))
    sheet.paste(cut, (0, 0), cut)
    sheet.paste(frame2, (SIZE, 0), frame2)
    sheet.save(OUT)
    print('wrote', OUT, sheet.size, 'alpha0', list(sheet.getchannel('A').getdata()).count(0))


if __name__ == '__main__':
    main()
