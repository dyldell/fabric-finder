#!/bin/bash

# Fabric Finder - Icon Generator
# Generates placeholder PWA icons in all required sizes
# Requires: ImageMagick

set -e

# Colors
BLUE='\033[0;34m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Fabric Finder - Icon Generator${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if ImageMagick is installed
if ! command -v convert &> /dev/null; then
    echo "❌ ImageMagick not found. Installing..."
    echo ""
    echo "Run: brew install imagemagick"
    echo ""
    exit 1
fi

# Create icons directory
ICONS_DIR="client/public/icons"
mkdir -p "$ICONS_DIR"

# Brand colors
BG_COLOR="#3b82f6"  # Fabric Finder blue
TEXT_COLOR="#ffffff"  # White

# Icon sizes needed for PWA
SIZES=(16 32 72 96 120 128 144 152 180 192 384 512)

echo "📱 Generating app icons..."
echo ""

for size in "${SIZES[@]}"; do
    filename="icon-${size}x${size}.png"
    filepath="$ICONS_DIR/$filename"

    # Calculate font size (1/3 of icon size)
    fontsize=$((size / 3))

    # Generate icon with "FF" text
    convert -size ${size}x${size} \
        canvas:"$BG_COLOR" \
        -font Arial-Bold \
        -pointsize $fontsize \
        -fill "$TEXT_COLOR" \
        -gravity center \
        -annotate +0+0 "FF" \
        "$filepath"

    echo "  ✓ Created ${filename} (${size}x${size})"
done

echo ""
echo -e "${GREEN}✅ Successfully generated ${#SIZES[@]} icon sizes!${NC}"
echo ""
echo "📁 Icons saved to: $ICONS_DIR"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Next Steps:"
echo ""
echo "1. Test the PWA:"
echo "   npm run dev"
echo "   Visit: http://localhost:5173"
echo ""
echo "2. Check Chrome DevTools > Application > Manifest"
echo "   All icons should show without errors"
echo ""
echo "3. For production, replace these placeholder icons"
echo "   with a proper logo using:"
echo "   https://realfavicongenerator.net"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
