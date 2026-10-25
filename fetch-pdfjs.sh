#!/usr/bin/env sh
# Downloads pdf.js into the app's assets so the APK works without internet.
# Run once from the project root before building in Android Studio.
set -e
mkdir -p app/src/main/assets/pdfjs
curl -fsSL -o app/src/main/assets/pdfjs/pdf.min.js        https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
curl -fsSL -o app/src/main/assets/pdfjs/pdf.worker.min.js https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js
mkdir -p app/src/main/assets/mammoth
curl -fsSL -o app/src/main/assets/mammoth/mammoth.browser.min.js https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js
echo "pdf.js bundled into app/src/main/assets/pdfjs/, mammoth.js (Word files) into app/src/main/assets/mammoth/"
