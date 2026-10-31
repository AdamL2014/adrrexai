@echo off
chcp 65001 >nul
title AdrrexAI - nasazeni na Netlify
echo.
echo  === AdrrexAI: nasazeni na Netlify (bez GitHubu) ===
echo.
where node >nul 2>nul || (echo Chybi Node.js. Stahni ho z https://nodejs.org ^(verze LTS^), nainstaluj a spust tento soubor znovu. & pause & exit /b 1)
cd /d "%~dp0"
echo [1/4] Prihlaseni do Netlify (otevre se prohlizec - prihlas se tatkovym uctem)...
call npx -y netlify-cli@latest login || goto fail
if not exist ".netlify\state.json" (
  echo [2/4] Vytvarim novy web na Netlify...
  call npx -y netlify-cli@latest sites:create || goto fail
) else (
  echo [2/4] Web uz existuje, preskakuji.
)
echo.
echo [3/4] Vloz Groq API klic (zacina gsk_). Nech prazdne, kdyz uz je nastaveny:
set /p GROQ=Groq klic: 
if not "%GROQ%"=="" call npx -y netlify-cli@latest env:set GROQ_API_KEY "%GROQ%" || goto fail
set /p GEMINI=Gemini klic (volitelne, Enter = preskocit): 
if not "%GEMINI%"=="" call npx -y netlify-cli@latest env:set GEMINI_API_KEY "%GEMINI%" || goto fail
echo.
echo [4/4] Nahravam AdrrexAI...
call npx -y netlify-cli@latest deploy --prod || goto fail
echo.
echo  Hotovo! Adresa webu je vyse u "Production URL".
pause
exit /b 0
:fail
echo.
echo  Neco se nepovedlo. Posli screenshot tohoto okna.
pause
exit /b 1
