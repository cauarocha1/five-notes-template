@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\.bin\vite.cmd" (
  echo Dependencias do projeto nao encontradas.
  echo Rode pnpm install uma vez nesta pasta.
  pause
  exit /b 1
)

echo Iniciando five. Deixe esta janela aberta enquanto usa o app.
call "node_modules\.bin\vite.cmd" --host 0.0.0.0
if errorlevel 1 pause
