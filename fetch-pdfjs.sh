#!/usr/bin/env sh
# Downloads pdf.js into the app's assets so the APK works without internet.
# Run once from the project root before building in Android Studio.
set -e
mkdir -p app/src/main/assets/pdfjs
curl -fsSL -o app/src/main/assets/pdfjs/pdf.min.js        https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
curl -fsSL -o app/src/main/assets/pdfjs/pdf.worker.min.js https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js
echo "pdf.js bundled into app/src/main/assets/pdfjs/"
