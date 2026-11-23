#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
root=$PWD
target=${1:-}
case "$target" in
  darwin-arm64) os=darwin; arch=arm64; label=mac-arm64 ;;
  darwin-x64) os=darwin; arch=amd64; label=mac-x64 ;;
  win32-x64) os=windows; arch=amd64; label=win-x64 ;;
  all)
    for platform in darwin-arm64 darwin-x64 win32-x64; do
      "$root/scripts/package-native.sh" "$platform"
    done
    exit
    ;;
  test) ;;
  *) echo "Usage: scripts/package-native.sh {all|darwin-arm64|darwin-x64|win32-x64|test}" >&2; exit 1 ;;
esac
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp native/*.go native/{go.mod,go.sum} "$work/"
mkdir -p "$work/frontend" "$work/controller"
cp src/{bridge.js,i18n.js,index.html,widget.js,widget.css,icon.png,trayTemplate.png} "$work/frontend/"
cp src/i18n.js src/{main,codex,dock,history,schedule}.cjs native/host.cjs "$work/controller/"
if [[ $target = darwin-* || ( $target = test && $(uname -s) = Darwin ) ]]; then
  export MACOSX_DEPLOYMENT_TARGET=13.0
  export CGO_CFLAGS="${CGO_CFLAGS:--O2 -g} -mmacosx-version-min=13.0"
  export CGO_LDFLAGS="${CGO_LDFLAGS:--O2 -g} -mmacosx-version-min=13.0"
fi
if [[ $target = test ]]; then
  cp -R test "$work/"
  (cd "$work" && go test -tags private_mac_apis -v .)
  exit
fi
read -r version < VERSION
name="Tock-$version-$label"
release_dir="$root/dist/release-$version"
if [[ $os = darwin ]]; then
  bundle="$work/Tock.app"
  mkdir -p "$bundle/Contents/"{MacOS,Resources}
  cp LICENSE assets/icon.icns "$bundle/Contents/Resources/"
  cat > "$bundle/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleName</key><string>Tock</string>
<key>CFBundleDisplayName</key><string>Tock</string>
<key>CFBundleIdentifier</key><string>local.codex.quota-widget</string>
<key>CFBundleExecutable</key><string>Tock</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$version</string>
<key>CFBundleVersion</key><string>$version</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
  (cd "$work" && CGO_ENABLED=1 GOOS="$os" GOARCH="$arch" go build -trimpath -tags production,private_mac_apis -ldflags="-s -w -X main.version=$version -extldflags=-mmacosx-version-min=13.0" -o "$bundle/Contents/MacOS/Tock")
  codesign --force --sign - "$bundle"
  payload="$bundle"
else
  payload="$work/Tock"
  mkdir -p "$payload"
  cp LICENSE "$payload/"
  (cd "$work" && CGO_ENABLED=0 GOOS="$os" GOARCH="$arch" go build -trimpath -tags production -ldflags="-H=windowsgui -s -w -X main.version=$version" -o "$payload/Tock.exe")
fi
bytes=$(find "$payload" -type f -exec wc -c {} + | awk '{n=$1} END {printf "%.0f",n}')
if [[ $bytes -ge 100000000 ]]; then
  echo "$name exceeds the installation size limit: $bytes bytes" >&2
  exit 1
fi
(cd "$work" && zip -X -9 -qr "$name.zip" "$(basename "$payload")")
mkdir -p "$release_dir"
mv "$work/$name.zip" "$release_dir/"
printf '%s built, unpacked %s bytes\n' "$name.zip" "$bytes"
