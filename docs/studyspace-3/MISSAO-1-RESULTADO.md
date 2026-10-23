# Missão 1 — Resultado

Data: **18/10/2026**. Base: `76f74e0`, documentação da Missão 0. Branch de implementação: `fix/missao-1-backup-consistente`.

## Correção

Um backup sintético estruturalmente válido, com 27 notas e texto Unicode, media exatamente **52.428.800 bytes** em JSON compacto. O download anterior com indentação produzia **52.436.663 bytes**, excedendo em **7.863 bytes** o limite físico de leitura. O teste de regressão falhou antes da correção e passou depois.

`src/services/backup-json.ts` centraliza o limite inclusivo de 50 MiB, a serialização compacta e a medição em UTF-8. A validação estrutural TS continua estrita; a geração do arquivo usa a mesma serialização e rejeita excesso antes de iniciar download. O leitor verifica bytes físicos antes de ler o conteúdo. O erro informa o limite e a preservação dos dados locais.

O fluxo comum de download/leitura atende a UI de navegador e Tauri. Rust já mede JSON compacto em bytes UTF-8; nenhuma alteração nativa, de schema, migração, formato ou dependência foi necessária. Não se afirma igualdade universal entre serializadores: defaults de campos opcionais do v1 e strings Unicode inválidas são particularidades preexistentes que não foram ampliadas nesta missão.

Em **Dados e backup**, o texto agora explica o limite, o conteúdo salvo e a exclusão de credenciais/configurações JARVIS. O fluxo existente em `App.tsx` aguarda `flushRef.current()` antes de exportar, incluindo edições da nota aberta ou interrompendo a operação se o salvamento falhar.

## Verificação

- Teste de regressão real no limite de 50 MiB; um byte acima é recusado antes de download/leitura. Acentos e emoji verificam contagem UTF-8.
- Ida-volta de arquivos v1/v2, leitura de JSON legado indentado dentro do limite, preservação de notas/vínculos/avaliações/tema e recusa de JSON inválido, versão futura e imagem ausente.
- `npm test`: **77/77 testes**, em 12 arquivos, aprovados.
- `npm run build`: checagem TypeScript e Vite aprovados.

- E2E: **2/2 cenários aprovados** em Edge/Chromium. Arquivo realmente baixado compacto/UTF-8, última edição antes do export, restauração em outro perfil e igualdade de dados/materiais; JSON inválido e arquivo físico de 50 MiB + 1 byte preservam a biblioteca existente. Spec em `tests/e2e/backup-physical.spec.ts`.
- Os E2E usaram preview na porta **1431**, perfis separados e arquivos sintéticos. A inicialização no sandbox ficou bloqueada; a execução local elevada específica de teste passou. A porta de uso 1420 e instalações pessoais não foram utilizadas ou encerradas. A configuração temporária permanece ignorada em `.cache/mission-1/`.
- Revisão independente do contrato e do diff aprovada; `git diff --check` sem erros. Não foram executados testes Rust ou do executável Tauri; o código nativo foi inspecionado e permaneceu inalterado.
- `npm run local:prepare` preparou a build para o iniciador neste checkout, sem iniciar o servidor de uso nem substituir uma instalação existente. O iniciador reutiliza servidor já aberto; é preciso encerrar a versão anterior pelo seu próprio encerrador antes de abrir a nova para ver a compilação atualizada.

## Limites preservados e próxima etapa

O backup continua v2 e o leitor aceita v1/v2. Arquivo legado já acima de 50 MiB permanece recusado; a correção evita que novas exportações ultrapassem o limite apenas por indentação. Uma biblioteca acumulada maior que o envelope continua sendo a tarefa da **Missão 2 — Backup escalável**; não foram removidos dados nem aumentados limites silenciosamente.

Restauração continua exigindo biblioteca vazia. Cópia pré-migração, sincronização, trilhas, SRS, planner, pesquisa Perplexity e PWA permanecem nas missões seguintes. Não houve push, deploy, publicação, acesso a credenciais ou uso de estudos reais.
