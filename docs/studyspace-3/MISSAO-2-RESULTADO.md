# Missão 2 — Backup escalável

Entrega em **19/10/2026**, a partir de `9af6132`, na branch `feat/missao-2-backup-escalavel`. A instalação local de destino é `C:\Users\luisg\Documents\StudySpace-Local`; os fontes e commits permanecem no checkout Git existente.

## Comportamento

**Dados e backup → Exportar backup** passa a baixar um arquivo `.studyspace` v3. Matérias, notas salvas, cartões, avaliações, tema, metadados e páginas compõem o manifesto; originais e imagens ficam em segmentos binários separados. A edição aberta continua sendo salva antes da exportação. API keys e configurações JARVIS não integram a cópia.

O leitor detecta o conteúdo, sem depender da extensão. JSON v1/v2 permanece aceito até 50 MiB. O v3 aceita até **256 MiB físicos**, incluindo cabeçalho e manifesto; manifesto até **50 MiB UTF-8**, original até **32 MiB** e imagem até **8 MiB**. Limites são inclusivos. Os limites de registros, páginas e tamanho de cada nota continuam vigentes. Exportação legada interna é preservada para compatibilidade, mas o botão usa v3.

A restauração continua exigindo biblioteca vazia. Não mescla, substitui ou remove estudos. Verifica estrutura, referências, unicidade, tamanhos, páginas, SHA-256 do manifesto e de cada material, além da assinatura de imagens. Corrupção, truncamento, versão desconhecida, dados excedentes, material ausente e falha de persistência interrompem a operação sem publicar dados parciais.

## Formato v3

| Intervalo | Conteúdo |
|---|---|
| 0–19 | ASCII `STUDYSPACE-BACKUP/3\n` (20 bytes, incluindo LF) |
| 20–23 | Comprimento do manifesto, uint32 little-endian |
| 24–55 | SHA-256 dos bytes UTF-8 exatos do manifesto, 32 bytes crus |
| 56 em diante | Manifesto JSON; em seguida documentos e imagens, na ordem dos descritores |

Manifesto: `{format:"studyspace-backup", version:3, exportedAt, data:Snapshot, materials:{documents:[{documentId,byteLength,pages}], assets:[{sha256,fileName,mimeType,byteLength}]}}`. O hash de cada documento vem de `data.documents`; o da imagem fica no descritor. Os comprimentos definem os segmentos contíguos e devem corresponder exatamente ao tamanho físico do arquivo.

Não há compressão ou extração de caminhos: expansão por descompressão é zero, nomes permanecem metadados e um arquivo ZIP arbitrário não é tratado como backup. Essa escolha evita inflação de base64 e dependências novas. SHA-256 detecta corrupção; não prova autoria nem cifra os estudos. Guarde o arquivo como qualquer outra cópia dos seus dados pessoais.

## Armazenamento e memória

No navegador/runtime local, exportação usa a mesma imagem SQLite sob o bloqueio exclusivo entre clientes/abas. Lê um material por vez e compõe `Blob`s sem serializar todos os originais em base64. Importação usa `File.slice`; não lê o arquivo inteiro como texto ou como um único buffer. O banco candidato só é publicado após a gravação durável bem-sucedida.

No Tauri, a exportação usa cópia consistente SQLite em memória e uma sessão com token. A restauração recebe um material por chamada, valida em banco isolado e só altera o banco real na transação final. IDs usam mapa de consulta; a cópia final usa BLOBs sem repetir conversões base64. O adaptador cancela a sessão em `finally`; sessões abandonadas expiram na próxima chamada de backup após dez minutos. Não existe migração de schema nesta missão. O pico de memória nativo não foi medido: o staging ainda mantém uma imagem SQLite inteira, incluindo páginas livres; o limite do arquivo não limita esse consumo.

Medição reproduzível: `STUDYSPACE_BACKUP_MEMORY_REPORT=1` com `node node_modules/vitest/vitest.mjs run src/services/storage/backup-archive.test.ts --maxWorkers=1 --reporter=verbose`. No processo de teste isolado, a fixture com dois originais de 28 MiB produziu **58.722.745 bytes**: RSS inicial **73 MiB**, RSS após exportação **420 MiB** (pico acumulado **448 MiB**), RSS após restauração **477 MiB** (pico **654 MiB**). O cenário completo atingiu **898 MiB**, incluindo construção da fixture, várias cópias de `MemoryPersistence`, reabertura e leitura final pela API legada base64. O heap JS observado foi de 15–54 MiB. Esses números são do processo de testes com SQLite WASM, não uma promessa de consumo do navegador nem um limite de memória. O banco inteiro ainda é carregado pelo adapter sql.js existente; 256 MiB é limite de arquivo, não garantia para dispositivos com pouca RAM.

## Verificação

- `npm test`: **88/88 testes**, em 14 arquivos, aprovados na execução final.
- Produção: `npm run build`, incluindo TypeScript, aprovado.
- E2E: **3/3 cenários** em Edge com a build final, usando `STUDYSPACE_E2E_CHANNEL=msedge` e `npm run test:e2e:backup`. O config versionado `playwright.backup.config.ts` usa preview isolado na porta **1431** e recusa reutilizar servidor existente. Arquivo realmente baixado/restaurado em outro perfil, última edição salva, Unicode, materiais, revisões, rejeição de corrupção com posterior restauração válida, limite físico e JSON v2 legado aprovados. Modal inspecionado visualmente, sem recorte ou sobreposição.
- Rust Windows/MSVC: **39/39 testes executados aprovados**, incluindo **7 testes v3**, e um teste de voz WinRT preexistente ignorado. Foram compilados o backend Tauri e as dependências; não foi validado o instalador nem a janela WebView2. Cargo.lock não mudou; somente a feature `backup` do rusqlite já existente foi habilitada.
- Ida e volta acima de 50 MiB, reabertura e comparação de IDs, notas, tema, revisões, páginas, tags, imagens e hashes dos originais.
- Corrupção de manifesto/documento/imagem, truncamento, versão futura, limites individuais/agregados, conteúdo excedente, referências inválidas, falha de gravação e biblioteca preenchida.
- Dois clientes do mesmo adapter: alteração concorrente aguarda o fim da exportação e o arquivo conserva o retrato anterior completo.

Os testes E2E exigiram execução fora do sandbox por bloqueio de socket. A suíte Rust completa exigiu o mesmo para seu teste legado de credencial **sintética** no cofre Windows; os testes do novo backup já passavam no sandbox. Ferramentas Rust oficiais verificadas por SHA-256 foram preparadas apenas no cache do repositório, usando o Build Tools existente. O wrapper histórico `desktop:test` bloqueou no snapshot de frontend da antiga missão 2.4 (incluindo mudanças de backup agora autorizadas e finais de linha); essa referência não foi regravada. A validação nativa foi feita diretamente com Cargo:

```powershell
$env:CARGO_HOME = Join-Path (Get-Location) '.cache\rust\cargo'
$env:PATH = (Join-Path (Get-Location) '.cache\rust\toolchain\bin') + ';' + $env:PATH
& .\.cache\rust\toolchain\bin\cargo.exe test --locked --offline --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc
```

`npm run local:prepare` preparou os adaptadores locais. Na instalação solicitada, **22 arquivos da build** foram copiados e conferidos por SHA-256; `config/.env` e `runtime/node.exe` foram comparados antes/depois e preservados, sem leitura do conteúdo da configuração ou exclusão de arquivos antigos. Foi acrescentado `MISSAO-2.txt` com instruções. O servidor de uso não foi iniciado ou encerrado; a origem 1420 e os dados do perfil permanecem estáveis. O backend nativo compilado foi validado no checkout; a pasta solicitada continua usando seu runtime Node portátil.

Nenhuma chamada real de IA, estudo pessoal, push ou deploy integrou esta entrega.

## Continuidade

A próxima etapa é a [Missão 3 — Recuperação pré-migração](MISSAO-3.md). Trilhas, planner, pesquisa Perplexity, SRS e PWA permanecem nas missões previstas; o backup escalável prepara a proteção dos dados para essas evoluções.
