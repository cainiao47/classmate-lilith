from pathlib import Path
from PIL import Image


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "branding" / "lilith-app-icon-v1.png"
WINDOWS_ICON = ROOT / "assets" / "app.ico"
WEB_ICON = ROOT / "public" / "favicon.ico"
WEB_APP_ICON = ROOT / "public" / "assets" / "lilith-app-icon.png"
SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)]


def main():
    image = Image.open(SOURCE).convert("RGBA")
    image.save(WINDOWS_ICON, format="ICO", sizes=SIZES, bitmap_format="png")
    image.save(WEB_ICON, format="ICO", sizes=[(32, 32), (48, 48), (64, 64)], bitmap_format="png")
    image.resize((256, 256), Image.Resampling.LANCZOS).save(WEB_APP_ICON, format="PNG", optimize=True)
    print(f"Created {WINDOWS_ICON}")
    print(f"Created {WEB_ICON}")
    print(f"Created {WEB_APP_ICON}")


if __name__ == "__main__":
    main()
