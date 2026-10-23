# Missões 9B e 9C — Progresso e atividades semanais

Entrega em **23/10/2026**, integrada à versão **2.0.0**. Base: `90cbf8d`, [9A](MISSAO-9A-RESULTADO.md). Branch de preparação: `release/2.0.0`.

## 9B — Resumo por matéria

Na matéria, abra **Progresso**. O resumo conta respostas, sessões distintas, cartões revisados, registros de erros e práticas manuais. O período pode ser os últimos sete dias civis locais, incluindo hoje até a referência exibida, ou todo o histórico. **Atualizar referência** atualiza o corte temporal; datas futuras não entram na atividade observada.

O estado atual de erros e SRS aparece à parte, sem depender do filtro de período. Vencimentos usam a referência explícita. Avaliações vinculadas ao caderno são contadas somente no histórico dos flashcards; práticas manuais são outra atividade. Não se deriva nota ou domínio dessas contagens.

Competências aparecem apenas quando uma unidade da trilha foi vinculada explicitamente à matéria. O seletor reutiliza as regras e amostras do diagnóstico existente, sem associar conteúdos pelo nome da matéria ou pela série. Atalhos abrem a revisão filtrada, o caderno da matéria ou a trilha; revisão e caderno permitem voltar ao resumo. As abas suportam setas e Home/End.

`src/domain/progress/selectors.ts` cria índices por snapshot, sem consultas adicionais ao banco. `SubjectProgress` é carregado ao abrir a aba. Não há migração ou persistência de indicadores derivados.

## 9C — Atividade manual em notas

**Atividades semanais** prepara uma prova semanal ou redação com prévia antes de gravar. Escolha matéria, trilha opcional, data e duração de 1 a 240 minutos. A prova usa somente competências de disciplinas selecionadas com vínculo explícito à matéria, no catálogo demonstrativo já instalado. A seleção é reproduzível por semana, matéria e catálogo, com estimativa de cinco minutos por questão e limite de vinte, respeitando o banco disponível. Sem questões ou sem tempo para uma, oferece um roteiro manual. Não cria conteúdo curricular novo nem promete cobertura do ENEM.

A prévia identifica origem, licença e limites da amostra. O gabarito fica recolhido para autocorreção e é incluído na seção final da nota. Questões podem reaparecer em outras semanas ou no diagnóstico; a reutilização é informada. Não se registra nova tentativa de diagnóstico ao preparar a prova.

Na redação, o estudante informa o tema, com até 300 caracteres. Uma rubrica genérica orienta tema/propósito, argumentos/evidências, organização, coesão e revisão, com espaços para trechos e prioridades de reescrita. Não é correção automática, rubrica oficial ou nota do ENEM.

O botão **Preparar atividade** de um simulado pendente numa semana aceita abre o roteiro com trilha/data fixas e duração limitada aos minutos reservados. Não aceita bloco em prévia, backlog ou já concluído. A nota não conclui o bloco; a conclusão continua explícita no planner.

`src/domain/practice` gera uma nota comum e coerente entre texto e documento Tiptap. `PracticePage` usa a importação transacional existente para criar somente essa nota, sem cartões ou materiais. Ajustes pendentes protegem a saída; fontes e vínculos são conferidos novamente antes de gravar. Um roteiro idêntico existente é aberto sem sobrescrita. A confirmação durável mantém o ID para repetir a abertura sem repetir a importação se uma leitura falhar.

Esta fatia da 9C mantém respostas, resultados e revisão da redação como texto manual na nota. Tentativas estruturadas de prova e gráficos de desempenho por prova são uma evolução posterior, com contrato e backup próprios; não são inferidos desse texto. Schema 6 e portátil v7 permanecem iguais. As notas viajam nos backups já existentes e são compartilhadas entre as edições pelos mesmos adaptadores.

## Release 2.0.0

Versões npm, Cargo, Tauri e interface alinhadas em 2.0.0, sem atualização de dependências. O lançador identifica a versão antiga e pede encerramento explícito, preservando a origem do navegador e seus dados. O novo empacotador usa uma lista de arquivos públicos, Node Windows x64, licenças e manifestos SHA-256. Não inclui credenciais, skills pessoais, bancos, caches ou configuração privada.

Detalhes de instalação e limites públicos estão no [changelog](../../CHANGELOG.md). A evolução seguinte é a pesquisa Perplexity isolada (10A), com nova conferência da API e custos antes de construir o transporte.

## Registro de encerramento

Validados: 218 testes TypeScript, 76 nativos e as 22 jornadas pertinentes no navegador; três verificações do empacotador e build de produção. As novas telas foram conferidas em desktop e 390 px, incluindo teclado, Axe, gravação sem rede após carregar e backup/restauração. As condições de voz física e a ponte dedicada de paridade permanecem separadas; não houve mudança de formato persistente nesta entrega.

A pasta `C:\Users\luisg\Documents\StudySpace-Local` recebeu 48 arquivos públicos verificados por SHA-256, com os dois atalhos personalizados e treze arquivos protegidos preservados. Configuração pessoal, runtime Node, dados do perfil e skills locais não foram publicados no pacote. Para usar a atualização, salve a edição aberta, encerre pelo atalho e abra novamente.
