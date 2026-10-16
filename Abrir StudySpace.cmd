@echo off
setlocal
title StudySpace Local
cd /d "%~dp0"
echo.
echo StudySpace Local
echo Pasta do aplicativo: "%~dp0"
echo Endereco no navegador: http://127.0.0.1:1420/
echo.
echo Iniciando o aplicativo...
if exist "%~dp0runtime\node.exe" (
  set "STUDYSPACE_NODE=%~dp0runtime\node.exe"
) else (
  set "STUDYSPACE_NODE=node"
)
"%STUDYSPACE_NODE%" "%~dp0runtime\launcher.mjs" --no-browser
if errorlevel 1 goto falha
echo.
echo Abrindo a pagina no navegador padrao...
start "" "http://127.0.0.1:1420/"
echo.
echo Se a pagina nao abrir, copie este endereco para o navegador:
echo http://127.0.0.1:1420/
echo.
echo Pode fechar esta janela. O aplicativo continuara funcionando.
echo Para encerrar o aplicativo, use "Encerrar StudySpace.cmd".
if /I "%~1"=="--no-pause" exit /b 0
echo.
echo Pressione qualquer tecla para fechar esta janela.
pause >nul
exit /b 0

:falha
echo.
echo Nao foi possivel iniciar o aplicativo. Veja o erro acima.
if /I "%~1"=="--no-pause" exit /b 1
pause
exit /b 1
