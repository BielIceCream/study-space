# Missão 1 — Backup físico consistente

> Implementação e verificação registradas em [Missão 1 — resultado](MISSAO-1-RESULTADO.md). Este briefing é mantido como referência do escopo original.

## Objetivo

Garantir que o backup v2 baixado obedeça ao mesmo limite de bytes usado para leitura, preservando os leitores v1/v2 e os estudos existentes. Resolver uma fronteira concreta antes de ampliar o modelo; backup escalável e cópia pré-migração pertencem às missões 2 e 3.

## Ponto de partida

Na base `a28aa3b`, `src/services/storage/validation.ts:193–199` mede `JSON.stringify(value)` compacto contra 50 MiB. `src/services/backup-files.ts:4` grava `JSON.stringify(backup, null, 2)` e `:16` recusa arquivo físico acima de 50 MiB. Um objeto pode passar na primeira medida e produzir um arquivo maior que o aceito pelo leitor. É risco identificado estaticamente; a missão começa reproduzindo-o com dados sintéticos.

Não confundir este problema com o limite agregado da biblioteca: corrigir a serialização não torna exportável uma biblioteca maior que o envelope v2. A interface deve explicar isso sem afirmar que um backup incompleto foi salvo.

## Escopo autorizado para a próxima execução

1. Confirmar branch/estado do Git e instruções locais; preservar qualquer trabalho novo. Criar branch própria para implementação a partir da preparação, se seguro.
2. Reproduzir o caso em teste focado com objeto válido, conteúdo UTF-8 e tamanho perto da fronteira. Medir bytes, não comprimento de string. Usar apenas dados sintéticos.
3. Centralizar limite e serialização física em utilitário pequeno, reutilizado na gravação e leitura; manter validação estrutural estrita nos adapters. Preferir JSON compacto, sem mudar schema, IDs ou versão do backup.
4. Rejeitar antes do download um arquivo físico que ultrapasse o limite e mostrar erro recuperável. Preservar a biblioteca. Não aumentar limites cegamente nem remover validação para esconder o problema.
5. Acrescentar regressões de limite e uma ida-volta do conteúdo baixado/lido. Verificar que o comportamento comum serve o browser e a UI Tauri, com contratos Rust ainda compatíveis.
6. Documentar escopo do backup: biblioteca/tema/materiais/histórico incluídos; rascunhos pendentes, credenciais, configuração `.env` e preferências de sessão JARVIS não são backup da biblioteca. Salvar notas antes de exportar deve ser comportamento verificável ou limitação explicitada.

## Arquivos prováveis

`src/services/backup-files.ts`, `src/services/storage/validation.ts`, testes focados desses serviços e `src/features/settings/BackupModal.tsx` somente se a mensagem/fluxo exigir. Inspecionar `src-tauri/src/validation.rs` para manter a mesma semântica do limite; evitar alterações nativas sem necessidade demonstrada. README/guia de backup recebem a limitação atual e o plano da missão 2.

## Critérios de conclusão

- Um backup válido gerado pode ser relido; bytes físicos na fronteira são tratados da mesma forma pelo exportador e leitor. Testar ASCII, acentos/emoji e overhead de serialização.
- Backups v1 e v2 continuam aceitos; o novo arquivo conserva entidades, vínculos, revisões, datas, documentos, mídia e avaliações. Comparar conteúdo sem exigir igualdade de `exportedAt` quando gerado novamente.
- Backup inválido, grande ou com material ausente não altera a biblioteca. Restore continua exigindo biblioteca vazia.
- Nenhuma alteração em migrações, algoritmo de revisão, importação de conteúdo ou credenciais. Nenhum dado real é usado em testes.
- `npm test` e `npm run build` aprovados. E2E focado de exportar/ler/restaurar em perfil isolado, com mock/fixture; usar porta e diretório que não colidam com a instalação pessoal. Se a infraestrutura só aceitar 1420, confirmar porta livre e isolamento antes de iniciar, sem encerrar processo alheio.
- Registrar resultado/limite observado. Biblioteca acima de 50 MiB continua explicitamente como pendência da Missão 2, sem promessa de correção nesta entrega.

## Fora de escopo

Trilhas, planner, SRS, Perplexity, PWA, merge de bibliotecas, novo formato de backup, limpeza de dados e distribuição. Não executar push/deploy. Se uma mudança funcional adicional for indispensável à correção, justificar seu vínculo com o caso de teste e manter o diff pequeno.

## Instrução de execução pronta

> Execute a Missão 1 descrita neste documento no checkout StudySpace preparado pela Missão 0. Corrija a inconsistência entre o tamanho físico do backup v2 e o limite de leitura, preservando v1/v2, dados e funcionalidades. Reproduza primeiro com fixture sintética e faça testes proporcionais. Não implemente os demais módulos ou o formato escalável ainda. Preserve alterações existentes e mantenha tudo local, sem push ou deploy.
