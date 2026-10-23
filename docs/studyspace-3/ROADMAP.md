# Roadmap por missões

Ordem orientada a recuperação dos dados e valor de estudo. As missões são entregas independentes e revisáveis; não representam autorização para implementação nesta Missão 0. Impacto/custo/risco são estimativas relativas de escopo, não prazos prometidos. P = pequeno, M = médio; dividir novamente qualquer missão que extrapole uma revisão focada.

## Fila e critérios

Andamento: [Missão 1 concluída](MISSAO-1-RESULTADO.md); [Missão 2 concluída](MISSAO-2-RESULTADO.md); [Missão 3 concluída](MISSAO-3-RESULTADO.md); [Missões 4 e 5 concluídas](MISSOES-4-5-RESULTADO.md); [Missões 6 e 7 concluídas](MISSOES-6-7-RESULTADO.md); [Missão 8 concluída](MISSAO-8B-RESULTADO.md). [Missão 9A concluída](MISSAO-9A-RESULTADO.md). [9B e fatia manual da 9C concluídas](MISSOES-9B-9C-RESULTADO.md), no release 2.0.0. Próxima: 10A — pesquisa Perplexity isolada. Resultados estruturados de provas ficam para incremento posterior. A tabela preserva a ordem e os critérios originais do programa.

| Missão | Entrega delimitada | Depende de | Impacto / custo / risco | Conclusão verificável |
|---|---|---|---|---|
| **1 — Backup físico consistente** | Uma serialização para medir/gravar/ler v2, matriz do que é salvo e mensagem de limite honesta | 0 | Alto / P / baixo | Arquivo produzido é relido no mesmo limite; fronteira UTF-8 testada; v1/v2 continuam válidos; nenhuma mudança de schema. [Brief pronto](MISSAO-1.md). |
| **2 — Backup escalável** | Formato novo com materiais separados, limites de expansão e leitor legado | 1 | Alto / M / médio | Biblioteca sintética acumulada acima de 50 MiB exporta/restaura sem perda; hashes/IDs/logs iguais; corrupção e falhas deixam destino intacto; pico de memória medido. |
| **3 — Recuperação pré-migração** | Cópia consistente versionada nos dois adapters e fixture de paridade | 2 | Alto / M / médio | Falha/queda/quota não substituem banco anterior; WAL tratado; restore em destino isolado; fixture browser→Rust→browser preserva entidades/IDs e hashes dos materiais, sem exigir SQLite binariamente idêntico. Gate para novas migrações. |
| **4 — Trilha mínima configurável** | Manifesto pequeno de unidades/pré-requisitos e uma trilha ENEM Do zero com configuração persistida | 3 | Alto / M / médio | Escolher objetivo, série inicial, matérias, dificuldades, prazo, disponibilidade e ritmo; grafo validado; relacionar material existente; backup cobre entidades; funciona sem IA. Conteúdo demonstrativo rotulado. |
| **5 — Diagnóstico opcional** | Tentativas, competências e indicação de lacunas para o catálogo mínimo | 4 | Alto / P / médio | Pular/retomar; domínio desconhecido sem evidência; lacunas sugeridas pelos resultados; série não decide domínio; regra determinística com amostra/recência visíveis. |
| **6 — Planner semanal local** | Prévia e aceite de blocos de aprendizagem/prática/revisão manual | 5 | Alto / M / médio | Orçamento respeitado, margem e dias livres; pré-requisitos; simulado ocupa tempo; agenda impossível informa déficit; mesma entrada gera mesmo plano. |
| **7 — Replanejamento e HUD Hoje** | Pendências reagendadas, blocos fixos e resumo na biblioteca | 6 | Alto / P / médio | Concluídos intactos, sem duplicação ou avalanche amanhã; motivo e desfazer última proposta; mudança de disponibilidade recalcula prévia. |
| **8 — Revisão espaçada** | Estado SRS por cartão e fila devidos usando Review existente | 3 | Alto / M / médio | Algoritmo/rating/migração documentados; registro+agenda atômicos; sem duplicatas; limite diário; cartões antigos entram gradualmente; prática livre preservada. Integrar slots do planner após 7. |
| **9 — Erros, provas e progresso** | Caderno vinculado a tentativas, prova semanal e relatório por competência | 5, 7, 8 | Alto / M / médio | Erro→correção→nova prática rastreável; prova cabe na semana; relatório separa atividade/desempenho/domínio. Redação com rubrica manual reutiliza notas. |
| **10A — Pesquisa Perplexity isolada** | Contrato de pesquisa, rota Node restrita, configuração guiada, limites/cache e fontes no painel | 1 | Alto / M / médio | Simulações sucesso/vazio/401/402/429/timeout/datas ausentes; orçamento reservado antes da chamada; chave ausente de cliente/log/backup; lista de fontes sem gerador; 15 provedores intactos. |
| **10B — JARVIS fundamentado** | Gerador existente recebe evidências autorizadas; modos explicar/guiar/praticar | 10A | Alto / P / médio | Citações ligadas a IDs reais; fonte local preservada; falha da pesquisa identificada; explicação sem pesquisa disponível; entradas web não acionam ferramentas. |
| **10C — Pesquisa no Tauri** | Adaptador nativo e segredo separado no cofre, mesma UI/contrato | 10A, 10B | Médio / P / médio | Fixtures equivalentes Node/Tauri; Gemini e chave antiga preservados; erros sem segredos; verificação nativa real em ambiente apropriado. Paridade dos outros geradores é incremento posterior separado. |
| **11 — Catálogos e pacotes** | Exportar/instalar pacote de conteúdo; depois ampliar predefinições | 4, 5, 9 | Alto / M / médio | Prévia, licença, hashes, DAG e limites; sem dados pessoais; atualização não apaga progresso. Entregas pequenas: ENEM Intensivo → médio 1º/2º/3º → edital → personalizado. Cada catálogo revisado separadamente. |
| **12A — PWA offline do núcleo** | Manifesto, assets offline e fluxo de atualização | 3, 7, 8 | Alto / M / médio | Após preparo, cold start/reload offline com editor/leitor; atualização entre abas sem perder rascunho/dados; quota/persistência orientadas; nenhum segredo em cache. |
| **12B — Transporte web opcional** | Decidir e, se autorizado, construir intermediário para pesquisa/IA da PWA | 10B, 12A | Médio / M / médio | Autenticação, limitação por conta, minimização e remoção de dados verificadas; sem chave no JS; núcleo continua independente; custos e operação definidos antes de publicar. |
| **13 — Paridade e distribuição** | Fechar lacunas desktop e validar instalação/recuperação/atualização | 9, 10C, 11, 12A | Alto / M / médio | Matriz de capacidades real, migração/backup cruzados, smoke WebView2 e navegador, teclado/leitor de tela e evidência de desempenho. Publicação/deploy requer autorização própria. |

## Execução enxuta e paralelismo

Trilha principal: `1 → 2 → 3 → 4 → 5 → 6 → 7 → 9`. SRS (8) pode seguir em paralelo após 3, com contrato de slots definido antes de integrar ao planner. Perplexity (10A/10B) é prioridade independente após 1; não deve atrasar o núcleo pedagógico nem exigir que ele use IA. Sua primeira persistência deve aproveitar a proteção de 3 ou usar cache volátil até ela existir.

Frontend pode preparar wizard e estados acessíveis com fixtures enquanto dados implementa o contrato acordado. Não permitir dois agentes editando o mesmo schema/backup ao mesmo tempo. Curadoria dos catálogos e fixtures de API são tarefas independentes. Uma pessoa/agente integra e decide critérios; revisar apenas as áreas alteradas e fronteiras de risco.

Melhorias de acessibilidade acompanham cada missão: foco, labels, leitura, teclado, toque, estados de erro e carga. Não adiar tudo para 13. CI leve para tipagem, unitários e smoke E2E entra com 1–3; empacotamento nativo continua separado. Desempenho é acompanhado por cenários sintéticos, com otimização quando houver evidência.

## Critérios comuns de encerramento

- Uma entrega tem comportamento demonstrável, limitações documentadas e diff focado; não atualizar a stack junto.
- Mudanças persistidas incluem serialização, migração, recuperação e validação TS/Rust coordenadas. Preservar IDs, originais, histórico e credenciais existentes.
- Executar testes pertinentes ao risco. Para domínio: invariantes/fixtures; para UI: jornadas alteradas e acessibilidade; para persistência: falhas e ida-volta; para API: mocks e chamada real apenas com credencial fornecida e consentimento de custo.
- Manter biblioteca, editor, flashcards, importadores e estudo com rede/IA desligadas. Voz indisponível não bloqueia texto.
- Nenhuma publicação, push, exclusão de dados ou alteração de segurança do sistema integra automaticamente uma missão.

## Decisões abertas no momento certo

Antes de 2: fechar envelope do backup e limites de memória com protótipo sintético. Antes de 4: revisar uma fatia curricular real, sem tentar preencher todo o ENEM. Antes de 8: congelar a política SRS e migração conservadora. Antes de 10A: reconferir documentação oficial, preço e transporte; antes de 12B: definir quem opera/paga o serviço opcional. Professores/turmas, cloud sync, marketplace e geração Perplexity Agent ficam fora do primeiro ciclo.
