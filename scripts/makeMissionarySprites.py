"""32x32 walk sheets for two church missionaries (same 3x4 layout as folk/pets)."""
from PIL import Image, ImageDraw

OUT_DIR = r'd:\workspace\ai\ai-town\public\assets'


def fill_rect(draw, x0, y0, x1, y1, color):
    draw.rectangle([x0, y0, x1, y1], fill=color)


def mirror_h(frame):
    return frame.transpose(Image.FLIP_LEFT_RIGHT)


def shift(frame, dx=0, dy=0):
    out = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
    out.paste(frame, (dx, dy), frame)
    return out


def draw_priest(draw, facing, step=0):
    black = (28, 24, 30, 255)
    black_d = (16, 14, 18, 255)
    collar = (245, 242, 235, 255)
    skin = (232, 198, 162, 255)
    skin_d = (196, 150, 118, 255)
    hair = (90, 86, 80, 255)
    hair_l = (150, 146, 138, 255)
    shoe = (22, 18, 16, 255)
    lx = {0: 0, 1: -1, 2: 1}[step]

    if facing == 'down':
        fill_rect(draw, 11, 4, 20, 8, hair_l)
        fill_rect(draw, 12, 5, 19, 13, skin)
        fill_rect(draw, 13, 8, 14, 9, black)
        fill_rect(draw, 17, 8, 18, 9, black)
        fill_rect(draw, 14, 11, 17, 12, skin_d)
        fill_rect(draw, 11, 13, 20, 15, collar)
        fill_rect(draw, 14, 14, 17, 16, collar)
        fill_rect(draw, 12, 15, 19, 26, black)
        fill_rect(draw, 15, 17, 16, 22, collar)
        fill_rect(draw, 11 + lx, 26, 14 + lx, 30, shoe)
        fill_rect(draw, 17 - lx, 26, 20 - lx, 30, shoe)
    elif facing == 'up':
        fill_rect(draw, 11, 4, 20, 12, hair)
        fill_rect(draw, 12, 11, 19, 13, skin_d)
        fill_rect(draw, 11, 13, 20, 15, collar)
        fill_rect(draw, 12, 15, 19, 26, black)
        fill_rect(draw, 11 + lx, 26, 14 + lx, 30, shoe)
        fill_rect(draw, 17 - lx, 26, 20 - lx, 30, shoe)
    elif facing == 'left':
        fill_rect(draw, 10, 4, 18, 8, hair_l)
        fill_rect(draw, 10, 6, 18, 13, skin)
        fill_rect(draw, 12, 8, 13, 9, black)
        fill_rect(draw, 10, 13, 17, 15, collar)
        fill_rect(draw, 11, 15, 19, 26, black)
        fill_rect(draw, 12 + lx, 26, 15 + lx, 30, shoe)
        fill_rect(draw, 16 - lx, 26, 19 - lx, 30, shoe)


def draw_missionary(draw, facing, step=0):
    coat = (92, 58, 36, 255)
    coat_d = (62, 38, 24, 255)
    shirt = (236, 228, 210, 255)
    skin = (214, 168, 122, 255)
    skin_d = (176, 122, 86, 255)
    hair = (48, 32, 22, 255)
    shoe = (30, 22, 16, 255)
    book = (140, 40, 40, 255)
    lx = {0: 0, 1: -1, 2: 1}[step]

    if facing == 'down':
        fill_rect(draw, 11, 4, 20, 8, hair)
        fill_rect(draw, 12, 6, 19, 13, skin)
        fill_rect(draw, 13, 8, 14, 9, (20, 16, 14, 255))
        fill_rect(draw, 17, 8, 18, 9, (20, 16, 14, 255))
        fill_rect(draw, 14, 11, 17, 12, skin_d)
        fill_rect(draw, 12, 13, 19, 16, shirt)
        fill_rect(draw, 11, 15, 20, 26, coat)
        fill_rect(draw, 14, 16, 17, 22, shirt)
        fill_rect(draw, 20, 18, 24, 22, book)
        fill_rect(draw, 11 + lx, 26, 14 + lx, 30, shoe)
        fill_rect(draw, 17 - lx, 26, 20 - lx, 30, shoe)
    elif facing == 'up':
        fill_rect(draw, 11, 4, 20, 12, hair)
        fill_rect(draw, 12, 11, 19, 13, skin_d)
        fill_rect(draw, 11, 15, 20, 26, coat_d)
        fill_rect(draw, 11 + lx, 26, 14 + lx, 30, shoe)
        fill_rect(draw, 17 - lx, 26, 20 - lx, 30, shoe)
    elif facing == 'left':
        fill_rect(draw, 10, 4, 18, 8, hair)
        fill_rect(draw, 10, 6, 18, 13, skin)
        fill_rect(draw, 12, 8, 13, 9, (20, 16, 14, 255))
        fill_rect(draw, 10, 13, 16, 16, shirt)
        fill_rect(draw, 11, 15, 20, 26, coat)
        fill_rect(draw, 8, 17, 12, 21, book)
        fill_rect(draw, 12 + lx, 26, 15 + lx, 30, shoe)
        fill_rect(draw, 16 - lx, 26, 19 - lx, 30, shoe)


def make_sheet(draw_fn):
    sheet = Image.new('RGBA', (96, 128), (0, 0, 0, 0))
    order = ['down', 'left', 'right', 'up']
    for row, facing in enumerate(order):
        for col, step in enumerate([0, 1, 2]):
            if facing == 'right':
                tmp = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
                draw_fn(ImageDraw.Draw(tmp), 'left', step)
                frame = mirror_h(tmp)
            else:
                frame = Image.new('RGBA', (32, 32), (0, 0, 0, 0))
                draw_fn(ImageDraw.Draw(frame), facing, step)
            if step == 1:
                frame = shift(frame, 0, -1)
            sheet.paste(frame, (col * 32, row * 32), frame)
    return sheet


def main():
    priest = make_sheet(draw_priest)
    miss = make_sheet(draw_missionary)
    priest.save(f'{OUT_DIR}\\priest.png')
    miss.save(f'{OUT_DIR}\\missionary.png')
    print('saved', priest.size, miss.size)


if __name__ == '__main__':
    main()
