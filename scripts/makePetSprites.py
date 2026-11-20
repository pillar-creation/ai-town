"""Generate 32x32 RPG-style cat/dog walk spritesheets (3x4 frames)."""
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


def draw_cat_body(draw, facing, step=0):
    orange = (232, 148, 60, 255)
    orange_d = (196, 110, 40, 255)
    cream = (250, 230, 200, 255)
    pink = (240, 150, 160, 255)
    black = (40, 30, 25, 255)
    white = (255, 255, 255, 255)
    nose = (230, 100, 110, 255)
    lx = {0: 0, 1: -1, 2: 1}[step]

    if facing == 'down':
        fill_rect(draw, 9, 6, 12, 10, orange)
        fill_rect(draw, 19, 6, 22, 10, orange)
        fill_rect(draw, 10, 7, 11, 9, pink)
        fill_rect(draw, 20, 7, 21, 9, pink)
        fill_rect(draw, 10, 9, 21, 18, orange)
        fill_rect(draw, 12, 16, 19, 18, cream)
        fill_rect(draw, 12, 12, 13, 14, black)
        fill_rect(draw, 18, 12, 19, 14, black)
        fill_rect(draw, 12, 12, 12, 12, white)
        fill_rect(draw, 18, 12, 18, 12, white)
        fill_rect(draw, 15, 15, 16, 15, nose)
        fill_rect(draw, 14, 16, 17, 16, black)
        fill_rect(draw, 11, 18, 20, 26, orange)
        fill_rect(draw, 13, 20, 18, 25, cream)
        fill_rect(draw, 11 + lx, 26, 13 + lx, 29, orange_d)
        fill_rect(draw, 18 - lx, 26, 20 - lx, 29, orange_d)
        fill_rect(draw, 21, 20, 24, 21, orange_d)
        fill_rect(draw, 23, 18, 24, 20, orange_d)
    elif facing == 'up':
        fill_rect(draw, 9, 6, 12, 10, orange)
        fill_rect(draw, 19, 6, 22, 10, orange)
        fill_rect(draw, 10, 9, 21, 18, orange)
        fill_rect(draw, 11, 18, 20, 26, orange)
        fill_rect(draw, 11 + lx, 26, 13 + lx, 29, orange_d)
        fill_rect(draw, 18 - lx, 26, 20 - lx, 29, orange_d)
        fill_rect(draw, 7, 20, 10, 21, orange_d)
        fill_rect(draw, 7, 18, 8, 20, orange_d)
    elif facing == 'left':
        fill_rect(draw, 8, 7, 11, 11, orange)
        fill_rect(draw, 14, 7, 16, 10, orange)
        fill_rect(draw, 9, 8, 10, 10, pink)
        fill_rect(draw, 7, 10, 18, 19, orange)
        fill_rect(draw, 7, 15, 11, 18, cream)
        fill_rect(draw, 9, 13, 10, 15, black)
        fill_rect(draw, 8, 16, 9, 16, nose)
        fill_rect(draw, 12, 18, 22, 26, orange)
        fill_rect(draw, 13 + lx, 26, 15 + lx, 29, orange_d)
        fill_rect(draw, 18 - lx, 26, 20 - lx, 29, orange_d)
        fill_rect(draw, 22, 16, 25, 18, orange_d)
        fill_rect(draw, 24, 14, 26, 16, orange_d)


def draw_dog_body(draw, facing, step=0):
    brown = (170, 110, 55, 255)
    brown_d = (120, 75, 35, 255)
    cream = (240, 220, 180, 255)
    black = (35, 28, 22, 255)
    nose = (30, 30, 30, 255)
    white = (255, 255, 255, 255)
    lx = {0: 0, 1: -1, 2: 1}[step]

    if facing == 'down':
        fill_rect(draw, 7, 10, 10, 16, brown_d)
        fill_rect(draw, 21, 10, 24, 16, brown_d)
        fill_rect(draw, 10, 8, 21, 18, brown)
        fill_rect(draw, 12, 14, 19, 18, cream)
        fill_rect(draw, 12, 11, 13, 13, black)
        fill_rect(draw, 18, 11, 19, 13, black)
        fill_rect(draw, 12, 11, 12, 11, white)
        fill_rect(draw, 14, 15, 17, 18, cream)
        fill_rect(draw, 15, 16, 16, 17, nose)
        fill_rect(draw, 10, 18, 21, 26, brown)
        fill_rect(draw, 13, 20, 18, 24, cream)
        fill_rect(draw, 11 + lx, 26, 13 + lx, 30, brown_d)
        fill_rect(draw, 18 - lx, 26, 20 - lx, 30, brown_d)
        fill_rect(draw, 21, 16, 23, 19, brown_d)
        fill_rect(draw, 22, 14, 24, 16, brown_d)
    elif facing == 'up':
        fill_rect(draw, 7, 10, 10, 16, brown_d)
        fill_rect(draw, 21, 10, 24, 16, brown_d)
        fill_rect(draw, 10, 8, 21, 18, brown)
        fill_rect(draw, 10, 18, 21, 26, brown)
        fill_rect(draw, 11 + lx, 26, 13 + lx, 30, brown_d)
        fill_rect(draw, 18 - lx, 26, 20 - lx, 30, brown_d)
        fill_rect(draw, 8, 16, 10, 19, brown_d)
        fill_rect(draw, 7, 14, 9, 16, brown_d)
    elif facing == 'left':
        fill_rect(draw, 6, 10, 9, 17, brown_d)
        fill_rect(draw, 8, 9, 18, 19, brown)
        fill_rect(draw, 6, 14, 10, 18, cream)
        fill_rect(draw, 6, 16, 7, 17, nose)
        fill_rect(draw, 12, 12, 13, 14, black)
        fill_rect(draw, 14, 18, 24, 26, brown)
        fill_rect(draw, 15 + lx, 26, 17 + lx, 30, brown_d)
        fill_rect(draw, 20 - lx, 26, 22 - lx, 30, brown_d)
        fill_rect(draw, 24, 15, 27, 18, brown_d)


def make_animal(kind):
    sheet = Image.new('RGBA', (96, 128), (0, 0, 0, 0))
    draw_fn = draw_cat_body if kind == 'cat' else draw_dog_body
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
    cat = make_animal('cat')
    dog = make_animal('dog')
    cat.save(f'{OUT_DIR}\\cat.png')
    dog.save(f'{OUT_DIR}\\dog.png')
    print('saved', cat.size, dog.size)


if __name__ == '__main__':
    main()
