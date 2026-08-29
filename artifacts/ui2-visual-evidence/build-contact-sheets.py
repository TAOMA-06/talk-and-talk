from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
PAGE_NAMES = [
    "consent", "home", "discover", "community", "orders", "order-detail", "order-payment",
    "order-aftercare", "order-dispute", "messages", "notifications", "profile", "account",
    "adult-eligibility", "deletion-status", "safety", "crisis", "support", "support-detail",
    "companion-detail", "companion-workbench", "companion-onboarding", "companion-schedule",
    "companion-development", "companion-earnings", "companion-safety", "companion-services",
    "companion-availability", "chat", "voice", "legal"
]


def files(theme: str):
    found = sorted((ROOT / theme).glob("[0-9][0-9]-*.png"))
    if len(found) != 31:
        raise SystemExit(f"{theme}: expected 31 screenshots, found {len(found)}")
    return found


def font(size: int):
    candidates = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def make_theme_sheet(theme: str, paths):
    thumb_w, thumb_h, gap, label_h, columns = 220, 424, 28, 54, 5
    rows = (len(paths) + columns - 1) // columns
    canvas = Image.new("RGB", (columns * (thumb_w + gap) + gap, rows * (thumb_h + label_h + gap) + gap), "#F7F5F2" if theme == "light" else "#0E0F10")
    draw = ImageDraw.Draw(canvas)
    text_color = "#171717" if theme == "light" else "#F5F3F0"
    for index, path in enumerate(paths):
        image = Image.open(path).convert("RGB")
        image.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = gap + (index % columns) * (thumb_w + gap)
        y = gap + (index // columns) * (thumb_h + label_h + gap)
        canvas.paste(image, (x + (thumb_w - image.width) // 2, y))
        draw.text((x, y + thumb_h + 10), f"{index + 1:02d}  {PAGE_NAMES[index]}", fill=text_color, font=font(20))
    output = ROOT / f"{theme}-contact-sheet.png"
    canvas.save(output, optimize=True)
    return output


light = files("light")
dark = files("dark")
outputs = [make_theme_sheet("light", light), make_theme_sheet("dark", dark)]
print("\n".join(str(path) for path in outputs))
