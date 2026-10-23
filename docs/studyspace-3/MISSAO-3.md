# Missão 3 — Recuperação pré-migração

Concluída: [resultado e validação](MISSAO-3-RESULTADO.md). O texto abaixo preserva o brief de execução.

Base: [backup escalável da Missão 2](MISSAO-2-RESULTADO.md). Objetivo: preservar uma cópia consistente e versionada antes de qualquer migração futura, nos adapters browser e Rust, com recuperação testada em destino isolado. Não implementar trilhas ou alterar o schema pedagógico nesta etapa.

## Entrega pequena

1. Definir metadados da cópia: versão do schema, horário UTC, motivo, tamanho e checksum; retenção curta explícita. Não incluir segredos nem depender de IA.
2. Browser: guardar cópia recuperável e validar leitura antes de publicar a migração. Tratar quota, falha de gravação e concorrência com outra aba. Não sobrescrever a única cópia válida.
3. Rust: usar cópia consistente SQLite, incluindo tratamento correto de WAL, com publicação atômica e recuperação em outra base. Evitar cópia simples de arquivo aberto.
4. Fixture compartilhada browser → Rust → browser com notas, cartões, revisões, originais e imagens. Preservar entidades, IDs, conteúdo e hashes; não exigir SQLite binariamente idêntico.

## Critérios de conclusão

- Migração recusada, falha, quota insuficiente e interrupção simulada deixam o banco anterior utilizável.
- Banco de versão futura continua recusado sem alteração.
- Cópia identificada pode ser restaurada em destino isolado, com verificação de integridade.
- Procedimento de recuperação e retenção documentados; erros indicam a ação disponível ao estudante.
- Exportação/restauração v1/v2/v3 da Missão 2 continua aprovada.

Começar com o contrato e testes de falha do adapter browser; implementar paridade nativa após estabilizá-lo. Esta missão é o gate para a primeira persistência de trilhas. Instalação local e commits em português seguem o fluxo atual; publicação continua sendo uma decisão separada.
