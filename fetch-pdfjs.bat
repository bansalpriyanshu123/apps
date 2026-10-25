@echo off
REM Downloads pdf.js into the app's assets so the APK works without internet.
mkdir app\src\main\assets\pdfjs 2>nul
curl -fsSL -o app\src\main\assets\pdfjs\pdf.min.js        https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
curl -fsSL -o app\src\main\assets\pdfjs\pdf.worker.min.js https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js
mkdir app\src\main\assets\mammoth 2>nul
curl -fsSL -o app\src\main\assets\mammoth\mammoth.browser.min.js https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js
echo pdf.js and mammoth.js (Word files) bundled into app\src\main\assets\
