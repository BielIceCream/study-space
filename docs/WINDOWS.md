# StudySpace Windows — missões 2.2, 2.3 e 2.3.1

## Situação da entrega

O projeto existente continua com **React + TypeScript + Tauri 2 + WebView2**. A interface aprovada foi preservada. O empacotamento NSIS, a distribuição sem instalação, os locks de dependências e o workflow Windows estão preparados.

**Código da missão 2.4 atualizado para 0.2.0; nenhum `.exe` dessa versão foi gerado.** A tentativa release foi barrada pelo Smart App Control ao carregar `cssparser_macros-14883b5103c35aa2.dll`; eventos 3077 e SHA-256 confirmado. Os arquivos 0.1.0 em `release/windows/` são da missão 2.3, sem os novos recursos, e foram preservados no checkpoint. Testes Rust: 31 aprovados, cofre Windows reprovado (1312). O probe WinRT falhou com `0x800455A0`; a síntese SAPI pt-BR falhou com `0x80045040`. Nenhum áudio físico aprovado. Resultados: `PROGRESSO.md`; confiança e assinatura: [WINDOWS-TRUST.md](WINDOWS-TRUST.md).

## Gerar os executáveis

No Windows x64, use Node **24.19.0** e Rust **1.99.0**. Os componentes C++/SDK já estão instalados neste PC. Para preparar outra máquina, abra um **PowerShell como administrador, fora da sessão restrita do Codex**, entre no projeto e execute:

```powershell
npm.cmd run desktop:setup
```

O script `scripts/desktop/install-build-tools.ps1` verifica o ambiente antes de instalar, reutiliza o Build Tools 2022 existente e adiciona C++ x64 e Windows SDK 10.0.26100. Se o Build Tools não existir, baixa seu bootstrapper oficial. A assinatura Microsoft é verificada antes da execução. A instalação é aditiva, sem desinstalar componentes ou reiniciar automaticamente o Windows. A confirmação final aguarda até 45 segundos para evitar uma checagem prematura. Os parâmetros seguem a [documentação Microsoft](https://learn.microsoft.com/en-us/visualstudio/install/use-command-line-parameters-to-install-visual-studio?view=vs-2022) e os [IDs oficiais de componentes](https://learn.microsoft.com/pt-br/visualstudio/install/workload-component-id-vs-build-tools?view=vs-2022). Reabra o terminal depois da instalação; se houver código 3010, reinicie quando puder, antes de compilar.

Rust já está preparado em `.cache/rust/toolchain` e os scripts de desktop o encontram automaticamente. Em outro checkout, instale Rust com os [pré-requisitos oficiais do Tauri](https://v2.tauri.app/start/prerequisites/) ou execute `npm.cmd run desktop:rust` com Python 3.11+; essa alternativa verifica os pacotes oficiais por SHA256 e não altera o PATH global. Com MSVC/SDK disponíveis:

```powershell
npm.cmd ci
npm.cmd run desktop:check
npm.cmd run desktop:test
npm.cmd run desktop:build
```

Se o Controle de Aplicativo impedir auxiliares gerados em uma nova compilação, use o runner Windows abaixo ou um ambiente permitido pela política; assinatura do aplicativo final não concede confiança a esses auxiliares. A instalação de SDK/C++ já foi confirmada e não precisa ser repetida. As ferramentas NSIS ficam no cache local `src-tauri/target/.tauri/`, sem depender de escrita no cache global do usuário. A tentativa bem-sucedida nesta sessão usou `$env:CARGO_NET_OFFLINE = 'true'` com todas as dependências oficiais já no cache para separar a falha HTTPS de Schannel da compilação. Em ambiente normal, a opção não é necessária.

Nesta sessão, o HTTPS do Cargo também falhou com `SEC_E_NO_CREDENTIALS`. A alternativa `node scripts/desktop/resolve-native-lock.mjs test` (ou `build`) usa um proxy temporário restrito ao loopback que consulta apenas as fontes oficiais via HTTPS verificado pelo Node e mantém os checksums do Cargo. Não desativa certificados, não altera configurações globais e não é distribuído no aplicativo. Esse download passou, mas não remove o bloqueio do Controle de Aplicativo.

`desktop:build` valida o empacotamento e a preservação do frontend, usa `Cargo.lock` com `--locked`, compila o frontend e o aplicativo, gera NSIS e monta a distribuição em `release/windows/`. O build usa CRT estático e inclui os recursos no aplicativo; o usuário final não precisa de Node, VS Code ou servidor.

Para incluir o instalador **offline** do WebView2, use `npm.cmd run desktop:build:offline`. Esse instalador é maior. O instalador compacto baixa o WebView2 apenas quando o runtime falta; o estudo não depende de internet depois da instalação. [Opções de distribuição Windows do Tauri](https://v2.tauri.app/distribute/windows-installer/).

O pipeline está preparado para **Actions → StudySpace Windows desktop → Run workflow**, em `windows-2022`, mas não foi executado remotamente. O projeto não tem repositório Git/remote conectado. O runner testa e gera o artefato `StudySpace-Windows-x64-unsigned` ou `-signed`; não publica release nem recebe chaves de IA ou estudos pessoais. O teste real do cofre é uma opção explícita, pois depende de sessão utilizável; os demais testes Rust executam normalmente. Voz física e Gemini pessoal permanecem testes manuais. Build em CI não garante aprovação de SAC/SmartScreen.

## O que cada arquivo representa

| Arquivo esperado após build 0.2.0 bem-sucedida | Uso |
| --- | --- |
| `StudySpace_0.2.0_x64-setup.exe` | Instalador NSIS para a conta atual, com ícone e atalho no menu Iniciar. |
| `StudySpace_0.2.0_x64-setup-offline.exe` | Variante opcional que inclui a instalação offline do WebView2. |
| `StudySpace_0.2.0_x64.exe` | Aplicativo de produção sem instalação; exige WebView2 já presente. |
| `StudySpace_0.2.0_x64-sem-instalacao.zip` | Aplicativo e instruções; não contém estudos ou credenciais. |
| `SHA256SUMS.txt` | Checksums dos arquivos gerados naquele build. |

**Os arquivos 0.2.0 acima ainda não existem.** Após build bem-sucedida, abra o instalador NSIS dessa versão e siga as etapas. A variante sem instalação exige WebView2 e mantém os dados no perfil Windows, sem acompanharem um pendrive. Em CI limpo os artefatos ficam em `release/windows/`; se houver entregas anteriores nessa pasta, o empacotamento usa `release/windows/0.2.0/`, preservando os arquivos antigos. Assinatura pública exige certificado/serviço legítimo, ainda indisponível. Não foi validada confiança pública nem instalação/desinstalação 0.2.0.

## Dados existentes e migração autorizada

O identificador permanece `app.studyspace.desktop`. O SQLite continua em `app_data_dir()/studyspace.sqlite3`, geralmente `%APPDATA%/app.studyspace.desktop/studyspace.sqlite3`, separado da pasta de instalação. A migração v1 permanece intacta; a v2 acrescenta documentos e mídia, mantendo matérias, notas, cartões, avaliações e tema. O build e o instalador não limpam esse diretório.

O aplicativo não acessa automaticamente o IndexedDB do navegador original. Para transferir estudos, o usuário exporta **Dados e backup → Exportar backup** na versão web e escolhe **Importar backup** no aplicativo com biblioteca vazia. Essa ação explícita preserva os IDs, os vínculos e o histórico; um banco já populado é recusado. Nenhuma migração silenciosa foi adicionada.

A missão 2.4 acrescenta importação e leitura de documentos. Os originais ficam em BLOBs SQLite, vinculados às notas existentes; o snapshot carrega somente metadados. O PDF usa leitor e worker locais. Backups v2 incluem originais e imagens; backups v1 continuam aceitos. O limite de backup permanece 50 MiB, sem truncar arquivos silenciosamente.

## Preservação visual e validação

- Referência anterior às mudanças: `docs/windows/reference/frontend.json`, medições da janela e snapshots em `tests/e2e/desktop-visual.spec.ts-snapshots/`.
- Os 30 arquivos originais de `src/` e `public/` continuam registrados. Integrações autorizadas da missão 2.4 têm hashes separados em `docs/windows/reference/mission-2.4.json`: JARVIS, importação, mídia e armazenamento. Paleta, fontes, Biblioteca e CSS original foram preservados; existe checkpoint recuperável em `.cache/checkpoints/mission-2.4-before`.
- A única exceção no CSS é uma regra acrescentada para altura abaixo de 600 px: a sidebar pode usar a rolagem existente sem o mínimo de 500 px. O caso 1366 × 768 a 150% tinha área lógica de 894 × 432 e sidebar de 500 px, cortando os controles inferiores.
- A janela mantém a barra nativa, redimensionamento, minimizar/maximizar e tamanho preferido 1280 × 820. `preventOverflow` respeita a área útil do monitor; o mínimo passa a 780 × 400 para caber em escalas maiores.
- Foram comparadas as nove combinações 1366 × 768, 1600 × 900 e 1920 × 1080 com 100%, 125% e 150%, usando fontes locais e sem erros de carregamento. Na menor altura, a sidebar corrigida é mascarada e os controles são verificados por interação. Os novos controles autorizados são ocultados apenas na comparação com a Biblioteca original; uma captura separada registra a interface completa com JARVIS e importação.

Esses testes são **simulação de viewport/DPI em Chromium**, não comparação real do executável em WebView2. O binário agora existe; a equivalência visual no Windows e o funcionamento da barra nativa ainda precisam de validação na sessão do usuário. Não foi declarada equivalência visual perfeita. Nenhum arquivo do frontend foi alterado na missão 2.3.1.

```powershell
npm.cmd run desktop:verify
npm.cmd run desktop:preserve
$env:STUDYSPACE_E2E_PREVIEW = '1'
npm.cmd run desktop:visual
```

## JARVIS

A missão 2.4 implementa Gemini por HTTPS no Rust, conversa recente limitada, cancelamento, modelos disponíveis, ferramentas validadas e geração de cartões com prévia antes de gravar. OpenJarvis foi usado apenas como referência para separar agente, ferramentas, memória e voz; nenhum código ou pacote Python foi copiado. O desktop atual desse projeto está em `frontend/src-tauri`; a licença raiz Apache 2.0 diverge dos metadados MIT do frontend.

Clique **JARVIS → Configurar JARVIS**, informe sua chave Gemini no campo protegido, salve, busque um modelo e teste a conexão. Não cole a chave em chats, scripts ou arquivos do projeto. O segredo usa Windows Credential Manager; nenhum IPC o devolve e backups, ZIP e logs não o incluem. A API pode ter custos e cotas do provedor. Não há chave embutida nem Ollama obrigatório.

Escolha uma voz local instalada, ajuste o volume e use **Falar com JARVIS**. O microfone funciona apenas por botão, encerra após silêncio e libera os dispositivos ao cancelar/fechar. A transcrição usa Gemini; a resposta usa WinRT local e reprodução automática. É possível interromper, silenciar e ouvir novamente. A ausência de voz pt-BR é informada; instale Português (Brasil) pelas configurações de Fala do Windows se necessário.

Conteúdo da nota/cartão ou trechos só acompanha a requisição após consentimento explícito. O painel mostra documento, página e tamanho; mudar de seleção ou fechar limpa essa autorização. Arquivos completos não são enviados automaticamente. Explicações gerais mantêm a conversa recente sem exigir compartilhamento dos materiais.

Há implementações reais de microfone, transcrição, Gemini e TTS. Chamadas com chave pessoal, microfone físico e reprodução audível ainda exigem validação na sessão do usuário. O teste nativo de credencial falhou com erro 1312 nesta sessão gerenciada; não foi criado fallback inseguro. Resultado do probe local e do build final: `PROGRESSO.md`.

## Importar e exportar materiais

Crie ou selecione uma matéria e clique em **Importar material** na barra superior. Escolha arquivo, confira a prévia, mapeamento, duplicatas e avisos, depois confirme. CSV/TSV/JSON/APKG importam cartões para a revisão existente; documentos criam notas editáveis com acesso ao original. A gravação é única e transacional, sem substituir cartões existentes.

APKG suporta bancos clássicos e `collection.anki21b` moderno com Zstandard, básicos/reversos, cloze textual, tags e imagens locais. Templates complexos, scripts, áudio, oclusão de imagem e agendamento/histórico Anki não têm conversão completa; os avisos indicam limitações. PDFs digitalizados não recebem OCR automático. DOCX preserva original e texto; Markdown continua texto editável. JSON com notas preserva o original. Formato JSON estável e limites estão em `src/services/import/README.md`.

No leitor, **Resumir/Explicar/Gerar flashcards/Conversar** prepara o trecho no painel. Autorize o compartilhamento e envie; cartões gerados só são gravados depois de confirmar a prévia. Exportação JSON preserva texto e tags; backup v2 preserva também mídia, originais e histórico.

## Auditoria e limpeza

Inventário em `.cache/mission-2.4/cleanup-inventory.json`. Cinco arquivos regeneráveis somam 125.328.005 bytes, com hashes e fontes de restauração. A política automática do sandbox rejeitou sua remoção: zero bytes liberados. Código, estudos, backups e ferramentas do build foram preservados; itens ambíguos não foram apagados.

## Verificação final no aplicativo gerado

Depois do build, instale NSIS e abra pelo menu Iniciar. Confirme a Biblioteca contra a referência, nas resoluções/escalas solicitadas; teste minimizar, maximizar, redimensionar e navegar. Crie matéria, nota e cartão, avalie, feche a janela enquanto uma nota está pendente e reabra. Teste a versão sem instalação com WebView2 presente.

Para QA isolado, `npm.cmd run desktop:build:qa` compila o mesmo aplicativo em `src-tauri/target/e2e/x86_64-pc-windows-msvc/release/studyspace.exe` com identificador `app.studyspace.desktop.e2e`, separado dos estudos e das credenciais da instalação principal. Use esse binário para testar restauração e erros. O JARVIS deve ser validado com credencial, microfone e alto-falantes reais antes de anunciar a validação completa de voz/API.
