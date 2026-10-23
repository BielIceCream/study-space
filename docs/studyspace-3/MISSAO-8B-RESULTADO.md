# Missão 8B — Revisão espaçada no dia a dia

Base: `c3b44f1`, entrega [8A](MISSAO-8A-RESULTADO.md). Branch: `feat/missao-8b-revisao-diaria`. A 8B conclui a segunda metade da [Missão 8](MISSAO-8.md).

Entrega concluída em **22/10/2026**.

## Uso e regras

Na tela **Revisão**, escolha **Revisão espaçada** e ajuste **Novos cartões por dia** (0–50; padrão 10). A prática livre continua como entrada padrão, inclusive nos comandos existentes do JARVIS. O novo modo exige escolha explícita, exceto quando aberto por um bloco de revisão do planner.

Primeiro vêm cartões vencidos, em ordem de vencimento/ID. Atrasados venceram antes da meia-noite local; devidos hoje venceram até o instante atual. Cartões futuros aguardam seu horário. Novos são cartões sem estado espaçado, incluindo os importados e os que só têm prática livre; entram em ordem de criação/ID, depois dos devidos e até a cota restante. Abrir a tela ou selecionar uma fila não inscreve cartões: somente a primeira resposta espaçada persistida faz isso.

A cota é global entre matérias do mesmo espaço local e considera `introducedAt`, preservado após revisões posteriores. Filtrar uma matéria não libera novamente suas vagas. Cartões já inscritos podem ser revisados com limite zero. Limitar novos não elimina os devidos; cada sessão oferece até 200 cartões e permite encerrar antes. Não há promessa de apagar atrasos ou concluir tudo em uma sessão.

O dia civil usa duas meias-noites locais convertidas separadamente para UTC, cobrindo dias de 23/25 horas. O vencimento continua em UTC e os intervalos da 8A continuam sendo durações exatas. Um relógio local alterado ou uma troca de fuso pode mudar a classificação diária; não há autoridade de tempo remota ou sincronização.

## Interface e gravação

Contagens mostram atrasados, devidos hoje, novos selecionados, inscrições feitas e vagas. A fila é conferida novamente no início da sessão e pode ser atualizada explicitamente. Durante a sessão, cada cartão recebe uma resposta por sessão; Errei informa retorno em outra sessão após dez minutos. Espaço revela e 1–4 avaliam, com foco e descrição da resposta para leitor de tela.

`ReviewInput.admission` transporta `{newCardLimit,dayStart,dayEnd}`. SQLite e Rust conferem janela e cota na mesma transação que grava log e estado. Dois clientes disputando a última vaga não inscrevem dois cartões. O relógio da gravação precisa estar dentro da janela; uma janela vencida é recusada sem log parcial. Inputs antigos da 8A sem essa opção continuam válidos. Não se trata de limite antifraude: o estudante pode alterar sua preferência, e não há servidor impondo uma política.

Uma falha de persistência mantém o cartão e permite tentar novamente. Se a resposta foi salva mas a leitura posterior falhou, a interface diz **Sua resposta foi salva**, bloqueia novas avaliações espaçadas e oferece **Recarregar agenda**. A gravação não é reaplicada para tentar atualizar a tela. A flag permanece no workspace ao navegar e desaparece após uma leitura bem-sucedida.

O limite é uma preferência de interface local (`studyspace.review.newCardLimit.v1`), conservada ao recarregar e atualizada em outras abas da mesma origem. Não é segredo, progresso ou entidade de estudo. O backup transporta estados e histórico, mas não essa preferência: em outro perfil/dispositivo, o padrão é 10. Se guardar a preferência falhar, a tela avisa que ela vale somente ali.

## Planner e compatibilidade

Um bloco de revisão aceito e pendente oferece **Revisar cartões**. A entrada usa a matéria vinculada à unidade e mostra os minutos reservados como referência. Sem vínculo, a tela informa isso e permite escolher a matéria. O tempo é uma orientação, com aviso quando ultrapassado; não avalia cartões nem encerra a sessão automaticamente.

Voltar ao planner conserva o bloco. Responder cartões não conclui uma atividade; concluir uma atividade não registra respostas nem altera vencimentos. Não são gerados novos compromissos automaticamente.

Schema **5**, portátil **v6** e regras SRS **v1** permanecem iguais. Não há migração, dependência ou provedor adicional. Preferências de prática livre, importadores, materiais, JARVIS e backups legados permanecem compatíveis. O núcleo continua funcionando sem IA e após carregar sem rede; isso não implementa o cold start offline da futura PWA.

## Verificação e instalação

- `npm test -- --maxWorkers=1`: **191 testes aprovados**, em 24 arquivos; dois testes condicionais de paridade ignorados na execução geral.
- Cargo offline para Windows MSVC: **67 aprovados**, dois ignorados (voz física e paridade executada por comando próprio). O formato persistente permanece igual ao da 8A; a ponte de paridade da 8A não foi reexecutada nesta etapa.
- Edge isolado na porta 1431: **16 cenários E2E aprovados**, sendo cinco novos de revisão espaçada e 11 de regressão de backups, recuperação, trilhas e planner. Incluem teclado, tela de 390 px, Axe WCAG A/AA, gravação sem rede após carregar, resposta salva com falha posterior e preservação do bloco do planner. As capturas de desktop e celular foram inspecionadas.
- `npm run build`: TypeScript e Vite aprovados. Chunk principal de 511,44 kB minificado / 152,60 kB gzip; aviso padrão acima de 500 kB mantido visível. Não se adicionaram dependências. `npm run local:prepare` e `git diff --check` aprovados.

**`C:\Users\luisg\Documents\StudySpace-Local` atualizado:** 22 arquivos de build e `MISSAO-8B.txt` conferidos por SHA-256. Assets copiados antes do HTML; arquivos de hashes antigos mantidos. Doze arquivos protegidos conservaram seus hashes, incluindo configuração dos provedores, runtime Node e atalhos. Não foi aberto ou usado nenhum banco/perfil pessoal nos testes.

Para usar: abrir pelos atalhos existentes, **Ctrl+F5 → Revisão → Revisão espaçada**. O executável Tauri foi compilado para os testes nativos; nenhum novo instalador foi produzido. Versão do aplicativo continua 0.2.0. Nenhum push ou deploy foi realizado. O próximo incremento de produto está delimitado na [Missão 9](MISSAO-9.md).
