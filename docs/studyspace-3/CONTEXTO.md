# Contexto e diagnóstico

Continuidade em 23/10/2026: a versão 2.0.0 reúne a [9A](MISSAO-9A-RESULTADO.md) e as [9B/9C](MISSOES-9B-9C-RESULTADO.md): caderno de erros, progresso por matéria e atividades semanais manuais em notas. Schema 6 e backup v7 permanecem. Biblioteca, importadores, trilhas, planner, revisão espaçada e JARVIS preservados. Próxima: 10A — pesquisa Perplexity isolada. Os registros abaixo descrevem suas respectivas bases históricas.

Referência: commit `a28aa3b`, 18/10/2026. Caminhos e linhas abaixo apontam para essa base. Diagnóstico por leitura seletiva e verificação automatizada; riscos de casos-limite não significam perda de dados observada.

Continuidade em 20/10/2026: [Missões 4 e 5](MISSOES-4-5-RESULTADO.md) entregam trilha demonstrativa, diagnóstico e schema 3 protegido; [Missão 6](MISSAO-6.md) delimita o planner semanal. O diagnóstico abaixo permanece como registro da base inicial.

## Estado real

| Área | Situação encontrada | Reutilização ou lacuna |
|---|---|---|
| Biblioteca e editor | Matérias, notas Tiptap, rascunhos, salvamento com revisão otimista, busca e temas | Preservar editor, vínculos e recuperação. `src/features/notes/`, `services/drafts.ts`, `services/use-workspace.ts`. |
| Flashcards | Biblioteca, mídia, sessões, quatro avaliações e histórico durável | `features/flashcards/Review.tsx:31–77` é prática livre. Não há fila por vencimento nem estado SRS persistido. |
| Importação | CSV/TSV/JSON/APKG/PDF/DOCX/TXT/MD, prévia, validação, duplicatas e gravação transacional | Manter originais, imagens, tags e hashes. APKG não converte integralmente templates/scripts/áudio/OCR nem agenda/histórico Anki; manter avisos honestos (`services/import/README.md`). |
| Dados | Schema SQLite v2 e SQL comum; sql.js + IndexedDB no navegador; rusqlite no Tauri | Transações, FKs, validação estrita, bloqueio de versão futura e proteção entre abas já existem. Expandir `StorageService`, sem banco paralelo. |
| Backup | Exporta v2, lê v1/v2, inclui originais, mídia, histórico e IDs; restaura apenas em biblioteca vazia | Não há merge, sincronização ou histórico automático de cópias. Limite de 50 MiB precisa revisão antes da expansão. |
| JARVIS local | Contexto autorizado, histórico limitado, cancelamento, ferramentas validadas, prévia de cartões e 15 provedores | Catálogo em `runtime/providers.mjs`. Chaves no `.env` do processo Node, fora dos arquivos servidos; não é cofre criptografado. |
| JARVIS Tauri | Backend Rust Gemini, Windows Credential Manager e voz nativa | Não tem paridade atual com os 15 provedores Node: `services/jarvis/client.ts:43–48`, `src-tauri/src/jarvis_ai.rs:1–10`. |
| Voz | TTS Windows; gravação por botão; transcrição remota Gemini/Groq/OpenAI no runtime local | Voz e IA são opcionais. Texto permanece utilizável; áudio físico e contas reais não foram verificados nesta missão. |
| Interface | Shell, sidebar, componentes comuns, temas, lazy loading e breakpoints existentes | Reusar `App.tsx`, `shared/ui.tsx`, Library, CardLibrary e Review. Melhorias pequenas de leitura, teclado e toque. |
| Trilhas/planner | Ausentes das vistas atuais e do modelo | Criar gradualmente, usando biblioteca e revisão como atividades existentes. |
| PWA | Sem manifesto, service worker ou política de atualização encontrados em `src/`, `public/`, Vite e HTML | Offline após carregamento não prova abertura/reload offline. Tauri e runtime local são caminhos distintos da futura PWA. |

Os 15 provedores a preservar são Gemini, OpenAI, Groq, xAI, NVIDIA NIM, Anthropic, DeepSeek, Mistral, OpenRouter, Together AI, Fireworks AI, Cerebras, Ollama, LM Studio e API compatível personalizada. Perplexity entra como capacidade adicional de pesquisa, sem remover ou renomear esses IDs.

O consentimento atual do JARVIS restringe trechos/corpos de notas e cartões; `services/jarvis/context.ts:20–48` ainda inclui metadados de matérias/documentos e títulos. Portanto, “sem compartilhar conteúdo” não significa “nenhum metadado enviado ao gerador”. O JARVIS 2.0 deve tornar essa prévia clara e minimizar metadados; pesquisa web recebe contrato próprio, sem herdar automaticamente esse contexto.

## Riscos que afetam a ordem do desenvolvimento

| Prioridade | Evidência | Decisão |
|---|---|---|
| P0: backup pode exceder o limite de leitura | `backup-files.ts:4` baixa JSON indentado; `:16` limita bytes físicos a 50 MiB; `storage/validation.ts:193–199` mede JSON compacto | Reproduzir e corrigir na Missão 1, com teste do arquivo realmente serializado. |
| P0: biblioteca válida pode superar o envelope de exportação | `import/parser.ts:26–28` limita lote; `storage/materials.ts:59–60` limita contagens acumuladas; `storage/sqlite.ts:191` valida o backup completo | Missão 2 introduz backup escalável; não apagar conteúdo, truncar exportação ou bloquear crescimento como solução permanente. |
| P0: migração não tem cópia prévia automática | Migrações transacionais em `storage/sqlite.ts` e `src-tauri/src/storage.rs`; Rust usa WAL | Cópia consistente e recuperação verificável antes de qualquer nova migração de produto. Copiar só um SQLite aberto em WAL não basta. |
| P1: paridade de plataformas incompleta | Runtime Node multiprovedor; Tauri Gemini; bibliotecas por origem/diretório distintos | Matriz explícita de capacidades; JSON de backup continua ponte de transferência. Não prometer sincronização automática. |
| P1: custo de biblioteca grande | Browser relê/exporta banco inteiro em operações; snapshot reúne notas/cartões/logs; base64 amplia materiais | Medir carga representativa e introduzir consultas menores conforme necessário; não trocar SQLite sem evidência. |
| P1: durabilidade web | IndexedDB depende de perfil, origem e quota | Persistência quando suportada, informação de quota, cópias externas e estratégia de atualização PWA. |
| P1: fontes e segredos | Referências atuais são documentos/páginas; `.env` local é texto no disco | Novo contrato web separado; credenciais nunca no bundle, backup, logs, localStorage ou service worker. |

## Otimizações de baixo custo

Manter React/TypeScript, Vite, Tiptap, SQLite, Zod, Vitest e Playwright. Não adicionar Redux, monorepo, microserviços, banco vetorial ou embeddings para os requisitos iniciais. Os locks já permitem instalação reproduzível; não atualizar dependências junto com mudanças de domínio.

`scripts/local/prepare.mjs:12–17` gera `runtime/study-context.mjs` e `study-tools.mjs` a partir do TypeScript. Eles parecem duplicados, mas são derivados: corrigir a fonte e regenerar quando necessário. A lógica Node/Rust precisa de fixtures comuns, sem tentar reescrever os dois transportes simultaneamente.

Library e CardLibrary repetem buscas por matéria/nota: seletores com Map e paginação simples são candidatos após medição. O editor e o PDF já têm divisão de bundle; manter isso. O JARVIS é montado mesmo fechado: avaliar carregamento no primeiro uso antes de adicionar dependências pesadas.

Na interface, há skip-link, foco visível, dialog nativo com retorno de foco e reduced motion. Validar abas por teclado (setas/Home/End), leitura das cartas com leitor de tela, textos auxiliares pequenos e alvos de toque. Acrescentar status onde Suspense usa fallback vazio. Axe não substitui esses testes manuais.

## Evidência de qualidade e limites

- Ambiente desta missão: Node 24.19.0, npm 11.17.0; `npm ci --ignore-scripts --no-audit --no-fund` instalou o lock sem alterar dependências. Não foi feita auditoria de vulnerabilidades.
- `npm test`: 11 arquivos e 72 testes aprovados. `npm run build`: typecheck e Vite aprovados. Artefatos ignorados em `node_modules/` e `dist/`.
- Existem sete specs E2E, Axe, viewport móvel de 390 px e nove combinações desktop simuladas. Não foram reexecutados nesta missão documental. O teste offline atual reativa a rede antes do reload (`tests/e2e/studyspace.spec.ts:70–76`).
- O diff visual desktop oculta controles adicionados e mascara parte da sidebar em alturas pequenas; há capturas auxiliares. Não equivale a cobertura completa do JARVIS/importador nem do WebView2 real.
- CI Windows é manual (`workflow_dispatch`). Pipeline leve de regressão pode ser acrescentado em uma missão própria, mantendo build/assinatura/publicação sob controle explícito.
- `docs/ESTRUTURA.md` e `WINDOWS.md` contêm referências históricas a arquivos ausentes e afirmações de outra máquina/sessão. O README e o código atual prevalecem; não assumir ferramentas instaladas, binário entregue ou testes nativos aprovados com base nesses relatos.

## Limites da Missão 0

A pasta inicial estava sem código ou Git. Foi clonado o repositório público em uma subpasta isolada; a `main` estava limpa e foi criada `docs/studyspace-3-mission-0`. Não havia alterações preexistentes nesse checkout. Não se procurou nem modificou instalação pessoal, bancos reais ou chaves de API.

Foram lidos seletivamente README, configurações, contratos, áreas atribuídas aos subagentes e pontos de integração. Não foi localizado `AGENTS.md`; não foi criado um arquivo de instruções global para impor decisões ainda não implementadas. Nenhum módulo, migração, dependência ou configuração de produção foi alterado.
