#!/bin/bash
# Builds dist/Nexus.dmg: a Mac window around the Nexus server. Needs Xcode's command line tools.
# The app is signed ad hoc (no Apple notarization) and uses the Node.js installed on the Mac.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
APP="$WORK/dmg/Nexus.app"
RES="$APP/Contents/Resources"
mkdir -p "$APP/Contents/MacOS" "$RES" dist

NEXUS_STANDALONE=1 npx next build
rsync -a --exclude '.env*' --exclude '.git' --exclude '/dist' --exclude '/desktop' --exclude '/docs' --exclude '/tests' --exclude '/src' --exclude '/scripts' --exclude '/*.md' --exclude '/*.mjs' --exclude '/*.mts' --exclude '/*.ts' --exclude '/tsconfig*' --exclude '/*-lock.json' .next/standalone/ "$RES/server/"
mkdir -p "$RES/server/.next/static"
rsync -a .next/static/ "$RES/server/.next/static/"
rsync -a public/ "$RES/server/public/"
# Nexus runs the Skills CLI as a program, so its files are not found by tracing imports.
mkdir -p "$RES/server/node_modules/skills"
rsync -aL node_modules/skills/ "$RES/server/node_modules/skills/"
cp desktop/boot.cjs "$RES/boot.cjs"
if find "$RES" -name '.env*' | grep -q .; then echo "Refusing to package a .env file." >&2; exit 1; fi

mkdir "$WORK/Nexus.iconset"
swiftc -O desktop/icon.swift -o "$WORK/icon"
"$WORK/icon" "$WORK/Nexus.iconset"
iconutil -c icns "$WORK/Nexus.iconset" -o "$RES/Nexus.icns"
swiftc -O -target "$(uname -m)-apple-macosx13.0" desktop/main.swift -o "$APP/Contents/MacOS/Nexus"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Nexus</string>
<key>CFBundleDisplayName</key><string>Nexus</string>
<key>CFBundleIdentifier</key><string>dev.nexus.local</string>
<key>CFBundleExecutable</key><string>Nexus</string>
<key>CFBundleIconFile</key><string>Nexus</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$VERSION</string>
<key>CFBundleVersion</key><string>$VERSION</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSMultipleInstancesProhibited</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"
ln -s /Applications "$WORK/dmg/Applications"
hdiutil create -volname Nexus -srcfolder "$WORK/dmg" -ov -format UDZO "dist/Nexus.dmg"
ls -lh dist/Nexus.dmg
