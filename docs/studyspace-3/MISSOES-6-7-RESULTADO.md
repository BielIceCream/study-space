# Missões 6 e 7 — Planner local e Hoje

Entrega em **21/10/2026**, sobre `7b52e8e`, branch `feat/missoes-6-7-planner-local`. Schema SQLite **4**; versão do aplicativo mantida em **0.2.0**.

## Entrega visível

**Planner** aparece na navegação e **Planejar semana** na trilha. O estudante escolhe uma semana, dias disponíveis, início e duração de cada janela, tamanho dos blocos, pausas, duração do simulado manual e estimativa de aprendizagem por unidade. O total semanal da trilha continua sendo o teto, mesmo quando as janelas somam mais tempo.

Gerar a prévia não grava uma agenda. Ela mostra horários, motivos, tempo com pausas, pendências realocadas e falta de capacidade. **Aceitar semana** confirma; **Cancelar prévia** deixa a agenda anterior intacta. Alterar disponibilidade invalida a prévia e exige gerar outra antes do aceite.

**Concluir** registra atividade, sem conceder domínio ou modificar diagnósticos/cartões. **Fixar** mantém o horário em propostas posteriores; desfixar libera a tarefa para realocação. O planner nunca move conclusões nem blocos fixos. Se os fixos não couberem na disponibilidade reduzida, o aceite fica impedido com orientação de ajuste.

O replanejamento recolhe pendências móveis da semana e atrasos anteriores. O que não cabe fica na **fila sem horário**, preservando o ID e sem ocupar o dia seguinte. A fila tem exibição incremental para não montar milhares de itens de uma vez. Aceitar uma proposta mantém uma cópia anterior para **Desfazer última proposta**; concluir/fixar/desfixar encerra esse desfazer, protegendo o novo histórico. Desfazer restaura semanas e fila, mantendo as preferências atuais de disponibilidade para uma próxima prévia.

**Hoje**, na biblioteca, mostra atividades concluídas na data local, tarefas agendadas para hoje e atrasos identificados com a data de origem. Permite concluir e abrir o planner da trilha. A fila sem horário é contada separadamente. O relógio do resumo é atualizado a cada minuto enquanto a tela permanece aberta.

## Regras e limites

- Motor puro em `src/domain/planner`, independente de React, IA e rede. Recebe data civil, minuto local e instante UTC explicitamente; a mesma entrada produz a mesma prévia.
- Uma janela por dia, sem atravessar meia-noite; blocos inteiros, pausas incluídas no orçamento e ausência de sobreposição. Nada novo é agendado no passado.
- Ordem por pré-requisitos, revisão/simulado pendentes e sinais do diagnóstico. Horas concluídas representam atividade, não certificação de aprendizagem. Série escolar não dispensa fundamentos.
- Estimativa por unidade define aprendizagem; prática, revisão, simulado e pausas consomem tempo adicional. Valores iniciais são sugestões editáveis, sem pesos oficiais do ENEM. Estimativa reduzida não apaga tarefas já aceitas.
- Revisão manual usa o intervalo da trilha desde a última evidência/atividade; simulado manual respeita a frequência após uma conclusão registrada. Não é SRS de cartões nem geração de provas.
- A data da prova gera aviso quando a estimativa mínima de aprendizagem excede a capacidade disponível, inclusive semanas parciais. É um limite de viabilidade, não previsão de nota ou garantia de cobertura.
- O planner organiza cada trilha separadamente. **A capacidade e as colisões não são agregadas entre trilhas**; para um único orçamento, reúna as matérias numa trilha. Agenda unificada entre trilhas é melhoria posterior, sem alterar silenciosamente planos existentes.
- Até 520 semanas e 10.000 blocos por trilha, incluindo fila sem horário. Prévia acima desses limites é recusada. Não há descarte automático de histórico.

## Persistência e compatibilidade

`study_planners(track_id,data_json)` vincula a agenda à trilha existente. Revisão otimista e transação atômica preservam gravações concorrentes; catálogo, dados e funcionalidades anteriores são mantidos. Rust valida os mesmos vínculos, limites, janelas, conclusões e snapshots de desfazer. O algoritmo de distribuição permanece compartilhado em TypeScript.

A migração 3→4 utiliza a cópia verificada da Missão 3. Falha SQL ou de publicação mantém o banco anterior e uma cópia recuperável. Os testes também preservam trilhas ao migrar a base 2 e materiais ao migrar a base 1.

Bibliotecas com agenda exportam `.studyspace` **v5**, magic `STUDYSPACE-BACKUP/5\n`. A estrutura física e os limites anteriores continuam: 256 MiB totais, manifesto 50 MiB, documento 32 MiB e imagem 8 MiB. São incluídos configuração, semanas, IDs, conclusões, blocos fixos, fila sem horário e desfazer. Cabeçalho e manifesto precisam concordar. v1/v2 JSON e v3/v4 binários continuam legíveis; bibliotecas sem agenda mantêm a versão anterior apropriada. Exportação JSON legada com agenda é recusada, sem perda silenciosa. Versões antigas do aplicativo não abrem schema 4/v5.

## Verificação e entrega

`npm test -- --maxWorkers=1`: 136 aprovados; duas fases de paridade são executadas pelo script próprio. Execução sequencial de workers usada para limitar recursos, após timeout de um teste antigo quando rodava junto ao navegador. Cargo offline: 57 aprovados, duas verificações reservadas (voz Windows real e paridade). `npm run test:recovery:parity` aprovado com agenda real produzida pelo adapter do navegador, copiada para Rust e restaurada pelo navegador com entidades, IDs, materiais e histórico iguais. Build com TypeScript aprovado.

Os 10 cenários de navegador foram validados com Edge e a porta isolada 1431, em perfis sintéticos; o reteste final do planner passou 2/2. Cobrem prévia/cancelamento, aceite, reinício, conflitos com blocos fixos, reagendamento, desfazer, Hoje, restauração v5, teclado e tela de 390 px. Axe não encontrou violações WCAG A/AA na página do planner no fluxo testado. Operações sem rede são testadas após carregar o aplicativo; não representam cold start de uma PWA. Capturas ficam em `test-results/backup`.

A entrega portátil foi atualizada em `C:\Users\luisg\Documents\StudySpace-Local`, com guia `MISSOES-6-7.txt`. Os 22 arquivos do build e o guia foram conferidos por SHA-256; os 10 arquivos protegidos (`.env`, Node, iniciadores e documentos anteriores) mantiveram seus hashes. Assets antigos permanecem para abas abertas. Dados reais do navegador não foram manipulados. Sem push/deploy ou novo instalador Tauri; o código nativo foi compilado e testado via Cargo.

Próxima etapa: [Missão 8 — revisão espaçada](MISSAO-8.md).
