#!/bin/bash
set -euo pipefail
destination="${1:?Supply an empty Sparkle download directory}"
mkdir -p "$destination"
archive="$destination/Sparkle-2.10.1.tar.xz"
curl --fail --location --retry 3 'https://github.com/sparkle-project/Sparkle/releases/download/2.10.1/Sparkle-2.10.1.tar.xz' -o "$archive"
echo "1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27  $archive" | shasum -a 256 -c -
tar -xJf "$archive" -C "$destination"
test -d "$destination/Sparkle.framework"
