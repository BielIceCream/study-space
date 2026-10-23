# Missão 8A — Primeiros 50% da revisão espaçada

Data: 21/10/2026. Base: `2539669`. Branch: `feat/missao-8a-base-revisao`.

## Escopo da metade

Esta entrega fecha motor e persistência da [Missão 8](MISSAO-8.md), com a segurança necessária para guardar o novo estado. Os 50% descrevem a divisão de escopo em 8A/8B. A fila visual, admissão diária de cartões novos e ligação com o planner ficam para 8B. A tela existente continua em prática livre, sem agendamento automático. O núcleo não usa IA, rede ou dependências novas.

## Regras v1

Algoritmo próprio, simples e determinístico; não é uma implementação de SM-2/FSRS nem uma estimativa científica de domínio. O estágio orienta espaçamento, sem declarar conteúdo aprendido. Os intervalos dos estágios 1–6 são **1, 3, 7, 14, 30 e 60 dias**. Cada dia representa exatamente 24 horas.

| Avaliação existente | Atualização | Próximo vencimento |
|---|---|---|
| 1 — Errei | Volta ao estágio 0; incrementa retomadas | 10 minutos |
| 2 — Difícil | Conserva estágio (0 se novo) | 60 minutos no estágio 0; metade inteira do intervalo do estágio, mínimo 1 dia, nos demais |
| 3 — Bom | Avança um estágio, máximo 6 | Intervalo do novo estágio |
| 4 — Fácil | Avança dois estágios, máximo 6 | Intervalo do novo estágio |

Novo cartão começa sem agenda. A primeira avaliação espaçada inicia os contadores; avaliações anteriores não são reprocessadas. Um estágio alto não é evidência de domínio. Atraso não concede avanço extra: o intervalo começa no instante da resposta efetivamente registrada.

Uma nova avaliação espaçada antes do vencimento é recusada sem gravar log ou estado. A prática livre continua permitida e não altera a agenda. Relógio atrasado não pode antecipar o vencimento; adiantar manualmente o relógio não é detectável pelo aplicativo local. Datas canônicas UTC com milissegundos são persistidas e comparadas; a futura interface converte para o fuso local. Não se somam dias civis ao calcular intervalos, inclusive em mudança de horário de verão. Datas que ultrapassam o ano 9999 são recusadas.

## Contrato e durabilidade

- `src/domain/spaced-repetition`: motor TypeScript puro, validação e vetores comuns. Rust executa as mesmas regras com os mesmos vetores em `src-tauri/src/review_schedule.rs`.
- `ReviewInput.schedule?: boolean`: ausente ou `false` preserva prática livre; `true` ativa atualização da agenda. `ReviewLog` permanece igual. A interface 8B usará essa opção explicitamente.
- `Snapshot.reviewSchedules?`: um estado por cartão com versão, estágio, repetições, retomadas, primeira/última revisão e próximo vencimento. `firstReviewId` e `introducedAt` conservam a entrada inicial mesmo após retomar no mesmo dia, preparando a cota de novos cartões da 8B. Ambos os vínculos com logs são validados. Campo omitido quando vazio.
- Schema **5**, tabela `review_schedules(flashcard_id,last_review_id,data_json)`, com FKs para cartão/log e validação dos vínculos, limites e vencimento. Migração 005 usa cópia verificada antes de alterar o banco populado, tanto no navegador como no desktop.
- Log e estado são publicados juntos na transação existente. No navegador, o banco candidato só é publicado após o save durável; no nativo, a transação é `IMMEDIATE`.
- A primeira resposta de `(sessionId, flashcardId)` prevalece. Repetir a chamada, inclusive após reinício ou revisão posterior, devolve o log original e não altera novamente a agenda. Reusar uma resposta livre com `schedule:true` não a converte: deve ser uma sessão nova.

Não há um segundo banco, serviço em segundo plano, replay de histórico ou agenda para todos os cartões importados. A validação de vínculos usa índices em memória e percurso linear. A arquitetura de snapshot completo continua existente; paginação ou consultas menores devem ser feitas mediante carga real, sem trocar o armazenamento nesta etapa.

## Backup e compatibilidade

O portátil usa **v6** quando há agenda de cartões. Sem esse estado, continua escolhendo v3/v4/v5 conforme as entidades existentes. Leitura v1/v2 JSON e v3–v6 portátil preservada; versões antigas com entidades novas são recusadas, evitando perda silenciosa. JSON v1/v2 não exporta agenda; usar `.studyspace`.

Cabeçalho e manifesto devem concordar. Limites físicos, hash SHA-256, materiais separados e restauração apenas em biblioteca vazia continuam iguais. Estados são restaurados depois dos cartões e logs, na mesma transação. A ponte de paridade inclui dois registros espaçados, trilha, diagnóstico, planner, pendências, desfazer, documentos e imagens.

## Verificação e entrega

- `npm test -- --maxWorkers=1`: **168 aprovados**, dois condicionais de paridade ignorados na suíte geral; **21 arquivos**. Esses condicionais foram executados pelo comando dedicado abaixo.
- Cargo offline, alvo `x86_64-pc-windows-msvc`: **63 aprovados**, dois ignorados (voz física e paridade explícita). O teste de paridade foi aprovado separadamente; voz física não faz parte desta entrega.
- `npm run test:recovery:parity`: navegador → checkpoint SQLite → Rust → portátil v6 com materiais → navegador, comparando snapshot completo e arquivos originais.
- Edge isolado na porta 1431: **sete cenários E2E** de backup/recuperação aprovados, incluindo v6 após reload e prática livre sem alterar a agenda. Os cenários existentes de teclado/voz/planner não foram todos reexecutados nesta etapa de dados.
- `npm run build`: TypeScript e Vite aprovados. O chunk principal tem 500,85 kB minificado / 149,18 kB gzip e ultrapassa ligeiramente o aviso padrão de 500 kB; não se alterou o limite para ocultar o aviso. Sem dependências novas. `npm run local:prepare` e `git diff --check` aprovados.

Instalação Node atualizada em **`C:\Users\luisg\Documents\StudySpace-Local`**: **22 arquivos do build e `MISSAO-8A.txt` conferidos por SHA-256**. Assets primeiro, HTML por último; hashes antigos mantidos para abas abertas. Onze arquivos protegidos conservaram seus hashes, incluindo arquivos da raiz, `config/.env` e `runtime/node.exe`. Nenhum banco ou perfil pessoal foi aberto, migrado manualmente ou usado nos testes. Ao carregar o novo frontend, o armazenamento existente aplica a migração protegida quando necessária.

Não foi executado push ou deploy. O executável Tauri foi compilado para testes; não foi produzido um novo instalador. A instalação Node usa o frontend e os adaptadores web compartilhados. A versão do aplicativo permanece 0.2.0, como nas missões anteriores.

## Próximos 50%

Executar a [8B](MISSAO-8.md#próxima-execução-8b): fila, cota diária, sessão e planner. Não habilitar o opt-in implicitamente na prática livre. Não converter conclusão do planner em avaliações de cartões, nem alterar os 15 provedores do JARVIS ou os importadores.
