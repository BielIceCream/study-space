# Missão 3 — Recuperação antes de migrações

Entrega em **19/10/2026**, sobre `dbba496`, na branch `feat/missao-3-recuperacao-segura`. O schema de produção continua **2**. O plano extra de migração usado pelos testes opera somente em bancos sintéticos.

## Entrega

Antes de migrar um banco existente, os dois adapters criam uma cópia consistente com ID, versão de origem/destino, horário UTC, motivo, tamanho e SHA-256. A leitura da cópia gravada é conferida antes de aplicar o plano. Banco novo, versão já atual e versão futura não produzem cópia artificial; a futura permanece recusada sem substituir seus bytes.

Browser: metadados e bytes são gravados na mesma transação IndexedDB, nas chaves `recovery:meta:<UUID>` e `recovery:data:<UUID>` do object store existente. Não foi preciso atualizar a versão IndexedDB nem mudar a origem. O bloqueio entre abas cobre carga, cópia, migração e publicação. A proteção por lease também verifica o proprietário nas gravações das cópias. O SQLite candidato só é publicado após a gravação durável.

Rust: SQLite Backup API captura o snapshot, inclusive páginas confirmadas no WAL. A cópia vai para um diretório privado `.pending-<UUID>`, os arquivos são sincronizados e o diretório é publicado por rename. Versão, leitura SQLite, integridade, referências e checksum são verificados. Uma única transação cobre todo o plano pendente, em vez de confirmar cada migração separadamente. A leitura que fundamenta a cópia pertence à mesma transação: outro writer WAL invalida a tentativa de promovê-la a escrita, preservando o estado mais recente em vez de migrar contra uma cópia antiga.

Retenção: três cópias válidas, poda somente após a nova cópia verificada e reutilização de estado idêntico em novas tentativas. Horários são monotônicos entre cópias para ordenar corretamente inclusive no mesmo milissegundo ou após recuo do relógio. Falha de poda deixa arquivos extras, sem impedir uma migração já protegida. Staging abandonado por queda é ignorado; a cópia anterior não é substituída.

## Recuperação utilizável

**Dados e backup → Proteção antes de migrações** mostra data, versões e tamanho. **Baixar cópia recuperada** abre a cópia em memória isolada e gera o mesmo `.studyspace` v3 da Missão 2. A tela de falha inicial do navegador oferece a recuperação mesmo quando o banco principal não abre. O arquivo pode ser importado em biblioteca vazia de outro perfil/dispositivo.

O [procedimento de recuperação](RECUPERACAO.md) explica também a pasta nativa e a recuperação manual em destino vazio quando o Tauri não inicia. A instalação portátil continua usando o perfil do navegador; não lê automaticamente a pasta privada do Tauri.

## Evidências

- TypeScript: **99 testes aprovados**, em 15 arquivos. Dois testes de fase da ponte ficam separados na suíte normal e são executados pelo comando de paridade. O runner usa até dois workers para limitar bancos WASM simultâneos; uma execução concorrente teve dois timeouts de 5 s, e a execução limitada passou.
- Produção: build Vite e checagem TypeScript aprovadas.
- Rust Windows/MSVC: **47 testes aprovados**, incluindo oito de recuperação. Voz WinRT permanece ignorada; o teste da ponte é executado separadamente. Execução fora do sandbox confirmou rename e credencial sintética isolada, que o sandbox havia bloqueado. Nenhuma credencial real foi utilizada.
- Ponte real: `npm run test:recovery:parity` produz SQLite pelo adapter browser após falha de migração, verifica o checksum no Rust, recupera em banco nativo vazio, exporta JSON e importa/reabre no browser. Entidades, IDs, notas, revisões, tema, páginas, imagens e originais comparados com a fixture versionada, sem exigir igualdade binária entre bancos.
- **6/6 cenários E2E** aprovados na build final, em 38,8 s, com Edge e preview isolado **1431**: os três backups anteriores; migração v1 com cópia exata; banco principal futuro com download e importação em outro perfil; quota simulada entre metadados/bytes com rollback IndexedDB, preservação da cópia anterior e nova tentativa bem-sucedida. Capturas em 1440×1000 e 390×844 revisadas; rodapé de ações mantido visível durante a rolagem.
- Falhas cobertas: SQL após alterar candidato, persistência final, quota, readback corrompido, IO/publicação nativa em quatro pontos, staging abandonado, concorrência entre clientes, writer WAL, cópia adulterada, versão futura e retenção.

## Limites e instalação

As cópias permanecem locais; limpar os dados do perfil elimina biblioteca e recuperação browser. Não substituem backup externo. Requerem espaço adicional para três bancos e staging; interrupções ou falhas de limpeza podem deixar arquivos extras. As imagens SQLite completas e a conversão para v3 ainda usam memória; esta missão não altera a arquitetura de armazenamento nem aumenta os limites do formato v3. A janela e o instalador Tauri não foram validados.

A instalação `C:\Users\luisg\Documents\StudySpace-Local` foi atualizada após validação: **22 arquivos compilados conferidos por SHA-256**. `.env` e Node portátil foram comparados antes/depois e preservados; o runtime não foi substituído. Foram acrescentados `MISSAO-3.txt` e `RECUPERACAO-MISSAO-3.md`, preservando documentos existentes. O servidor de uso estava indisponível e não foi iniciado; origem e estudos do perfil permaneceram intactos. Fontes e commit ficam no checkout Git existente; nenhum push ou deploy integrou esta entrega.

Próxima entrega: [Missão 4 — Trilha mínima configurável](MISSAO-4.md).
