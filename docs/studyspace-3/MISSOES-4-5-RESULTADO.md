# Missões 4 e 5 — Trilhas e diagnóstico local

Entrega em **20/10/2026**, sobre `b4acece`, branch `feat/missoes-4-5-trilhas-diagnostico`. Schema SQLite **3**. Versão do aplicativo mantida em **0.2.0**.

## O que aparece no aplicativo

**Trilhas** na navegação e na biblioteca abre a predefinição **ENEM — Do zero**, identificada como demonstrativa: Matemática e Língua Portuguesa, seis unidades, seis competências e doze questões originais sob CC0-1.0. Não representa o currículo completo do ENEM nem certifica domínio.

O estudante configura nome, objetivo, ano escolar inicial, matérias, dificuldades percebidas, data opcional da prova, minutos disponíveis por semana, intensidade, ritmo e frequências desejadas de revisão/simulado. Pode editar e manter mais de uma trilha. Esses parâmetros ficam salvos; agenda, provas semanais e reagendamento pertencem às próximas missões.

Cada unidade pode apontar para uma matéria e notas existentes por ID. Notas, documentos, cartões e matérias não são duplicados. Retirar uma matéria da configuração desfaz somente os vínculos dela na trilha; materiais da biblioteca e evidências históricas permanecem.

O diagnóstico é opcional: pode ser pulado, encerrado e retomado após reiniciar. Cada resposta é salva antes do feedback; “Não sei ainda” registra um pulo sem contar como erro ou evidência. Há explicações autorais e indicação de amostra, acertos e data da última resposta por competência, agrupadas por matéria.

## Regras e persistência

- `src/domain/study/`: tipos, validação, catálogo e regras puras. Sem rede, React ou IA. O mesmo motor atende navegador e Tauri; o Rust valida o contrato recebido e os dados persistidos.
- Catálogo com IDs estáveis, versão, origem, licença e grafo acíclico. Referências ausentes, ciclos, IDs duplicados, alternativas inválidas e vínculos inconsistentes são recusados.
- `study_tracks(id,data_json)` guarda um agregado por trilha: cópia imutável do catálogo, configuração e tentativas. Uma gravação atômica com revisão otimista impede perda de alterações entre janelas. Atualizar catálogo requer outra trilha.
- Histórico salvo não pode ser apagado ou reescrito por uma edição. Tentativa concluída é imutável; a adiada pode ser retomada preservando questões, respostas e início. Limites atuais: 100 trilhas, 200 tentativas por trilha.
- Sem duas questões distintas respondidas numa competência, o estado é **desconhecido**. Usa-se a última resposta não pulada por questão; repetições não aumentam a amostra. Acerto abaixo de 75% sugere reforço. Evidência positiva requer ao menos duas respostas nos últimos 30 dias; depois, pede reavaliação. É sinal inicial, nunca declaração de domínio. Datas e limites ficam explícitos na interface.
- Próximo conteúdo considera os pré-requisitos e essas evidências. Ano escolar e dificuldade declarada não concedem domínio nem dispensam fundamentos. A sugestão não bloqueia a abertura dos outros conteúdos.

A migração 2→3 usa a proteção da Missão 3. Falha de SQL, quota ou publicação preserva o banco anterior e sua cópia verificável. Armazenamento IndexedDB, origem local e identificador Tauri foram preservados.

## Backup e compatibilidade

Bibliotecas com trilhas exportam `.studyspace` **v4**, com magic `STUDYSPACE-BACKUP/4\n` e manifesto versão 4. A estrutura física, SHA-256 e limites permanecem os do v3: 256 MiB totais, manifesto 50 MiB, documento 32 MiB e imagem 8 MiB. Cabeçalho e manifesto precisam concordar.

O leitor atual aceita v1/v2 JSON e v3/v4 binários. Sem trilhas, continua exportando v3. Exportação JSON v2 com trilhas é recusada com orientação para usar o arquivo portátil, evitando perda silenciosa. Versões antigas do aplicativo não leem v4/schema 3; atualizar o aplicativo é necessário. Uma biblioteca contendo apenas trilha também é considerada ocupada para restauração.

O catálogo contém conteúdo; configurações e respostas pertencem ao estudante. O backup completo inclui esses dados privados. Não há exportador público de pacotes nesta etapa, nem envio desses dados para o JARVIS ou provedores.

## Validação e instalação

- `npm test`: 121 aprovados, duas fases de paridade reservadas para o script próprio.
- `npm run build`: TypeScript e build de produção aprovados.
- Cargo offline: 52 aprovados; duas verificações reservadas (voz Windows real e paridade). A paridade foi executada separadamente.
- `npm run test:recovery:parity`: SQLite real do navegador com trilha, vínculos e diagnóstico parcial → cópia verificada → Rust → manifesto v4 e materiais → restauração no navegador. Entidades, IDs, respostas, páginas e hashes conferidos.
- E2E com Edge na porta isolada 1431: **8 aprovados em 34,3 s**. Cobre backup legado/atual, recuperação, configuração, materiais, diagnóstico, restauração em outro perfil, teclado, tela de 390 px e operações locais sem conexão após carregar o aplicativo. Axe não encontrou violações WCAG A/AA na página de trilhas do fluxo testado. Capturas em `test-results/backup/`. Não equivale a uma PWA instalável ou reload offline.

A instalação portátil em `C:\Users\luisg\Documents\StudySpace-Local` recebeu os 22 arquivos do build, conferidos por SHA-256, e o guia `MISSOES-4-5.txt`. Arquivos novos antes do `index.html`; assets anteriores são mantidos para abas abertas. Hashes de `.env`, Node portátil, iniciadores e documentos anteriores permaneceram iguais; dados do navegador não foram manipulados. Não foi gerado instalador Tauri novo nem executado push/deploy. A implementação nativa foi compilada e testada via Cargo.

Próxima entrega delimitada: [Missão 6 — planner semanal local](MISSAO-6.md).
