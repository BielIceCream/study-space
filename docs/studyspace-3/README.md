# StudySpace 3.0 — Missão 0

Preparação concluída em **18/10/2026**. Base analisada: `BielIceCream/study-space`, commit `a28aa3befac5040e3bd0a47e77c6508a4f01c983` da `main`. Branch local: `docs/studyspace-3-mission-0`.

Continuidade: [Missão 1](MISSAO-1-RESULTADO.md), [Missão 2](MISSAO-2-RESULTADO.md) e [Missão 3](MISSAO-3-RESULTADO.md) entregam backups e recuperação; [Missões 4 e 5](MISSOES-4-5-RESULTADO.md), trilhas e diagnóstico; [Missões 6 e 7](MISSOES-6-7-RESULTADO.md), planner semanal e Hoje; [Missão 8 completa](MISSAO-8B-RESULTADO.md), revisão espaçada e fila diária. [Missão 9A](MISSAO-9A-RESULTADO.md), caderno de erros e prática rastreável. [Missões 9B e 9C](MISSOES-9B-9C-RESULTADO.md) acrescentam progresso por matéria e atividades manuais na versão 2.0.0. Próxima: pesquisa Perplexity isolada (10A). O restante desta página descreve a entrega documental original da Missão 0.

O StudySpace pode evoluir com a stack atual. Biblioteca, notas, flashcards, importadores e JARVIS são a base da plataforma; nenhuma reconstrução é necessária. Esta entrega altera somente documentação. A versão continua **0.2.0**; “3.0” identifica o programa de evolução, não uma versão já entregue.

## Leitura orientada

- [Contexto e diagnóstico](CONTEXTO.md): funcionalidades reais, evidências, riscos e verificações.
- [Arquitetura incremental](ARQUITETURA.md): trilhas, diagnóstico, planner, aprendizagem, JARVIS, interfaces e plataformas.
- [Roadmap por missões](ROADMAP.md): prioridades, dependências e critérios de conclusão.
- [Perplexity: pesquisa oficial e decisões](PERPLEXITY.md): endpoints, modelos, fontes, custos e privacidade.
- [Missão 1 pronta para executar](MISSAO-1.md): corrigir o limite físico do backup sem ampliar o escopo.

## Decisões centrais

1. Proteger recuperação e compatibilidade dos dados antes de acrescentar entidades persistidas.
2. Compartilhar regras de estudo em TypeScript puro; manter SQLite e os adaptadores existentes.
3. Construir trilhas e planner determinísticos, utilizáveis sem IA, conta ou internet.
4. Tratar série escolar como sugestão de ponto de partida; diagnóstico opcional e evidências orientam adaptação.
5. Separar pesquisa Perplexity dos 15 provedores de geração, preservando todos eles.
6. Evoluir HUD e acessibilidade dentro dos fluxos existentes; preparar PWA com atualização e durabilidade seguras.

## Resultado da preparação

Checkout novo e inicialmente limpo em `work/study-space`, isolado de qualquer instalação do estudante. Não foi encontrado `AGENTS.md` na árvore versionada nem nos diretórios ancestrais consultados. Três subagentes cobriram dados, frontend/qualidade e API Perplexity; a coordenação consolidou arquitetura e prioridades.

Verificados nesta missão: **72/72 testes internos**, em 11 arquivos, e **build de produção com checagem TypeScript**. E2E, Rust, executável Windows, microfone físico e chamadas reais de IA não foram executados. O servidor de uso não foi iniciado. Nenhum banco de estudante, segredo, push ou deploy foi acessado ou modificado.
