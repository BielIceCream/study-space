# Missão 4 — Trilha mínima configurável

Concluída junto ao diagnóstico: [resultado das Missões 4 e 5](MISSOES-4-5-RESULTADO.md), 20/10/2026. Abaixo, o brief preservado.

Base: [proteção pré-migração da Missão 3](MISSAO-3-RESULTADO.md). Entrega: uma trilha **ENEM — Do zero** pequena, configurável e persistida, usando a biblioteca atual. Funciona sem IA.

## Fatia executável

1. Fechar os tipos de unidade, competência, pré-requisito e configuração pessoal. Um manifesto pequeno e demonstrativo, rotulado como tal, com IDs estáveis, versão e origem/licença. Validar referências e grafo acíclico antes de persistir.
2. Usar componentes existentes para selecionar objetivo, ano escolar de partida, matérias, dificuldades, prazo, disponibilidade semanal, intensidade, ritmo e preferências de revisões/simulados. Permitir editar e retomar a configuração. Série informa o ponto de partida; não marca domínio.
3. Relacionar unidades a matérias/materiais existentes por ID e mostrar a próxima unidade elegível com justificativa simples. Progresso sem diagnóstico continua desconhecido, sem inferir domínio por idade ou série.
4. Persistência TS/Rust e migração protegida pela Missão 3; incluir as novas entidades na cópia portátil e nas fixtures de ida e volta, com decisão explícita sobre versão/compatibilidade do formato. Nenhum estado pessoal dentro do manifesto compartilhável.

## Conclusão

- Configuração sobrevive a reinício e exportação/restauração, sem duplicar matérias, notas ou cartões.
- Catálogo inválido é recusado; dependências preservadas; materiais continuam acessíveis pela biblioteca.
- Migração interrompida preserva banco anterior e cópia recuperável, inclusive no caminho nativo.
- Formulário utilizável por teclado e em tela pequena, com rótulos e erros claros.
- Conteúdo demonstrativo não é anunciado como currículo completo ou garantia de preparação para o ENEM.

Diagnóstico fica na Missão 5; cronograma e reagendamento, nas Missões 6–7. As preferências ficam guardadas nesta missão, com essa distinção clara na interface. Esta etapa não depende de pesquisa online, provedor de IA ou reconstrução do HUD.
