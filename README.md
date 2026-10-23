# StudySpace 2.0

Aplicativo de estudos que roda no próprio computador. Organize matérias, escreva notas e pratique com flashcards, com um assistente de IA opcional.

![Biblioteca do Study Space](docs/previews/biblioteca-clara.png)

## Recursos

- Matérias, notas com editor de texto e flashcards vinculados ao material.
- Revisão, busca, importação de CSV, JSON, PDF, DOCX e APKG e backup da biblioteca.
- Trilhas configuráveis com amostra ENEM — Do zero, materiais vinculados e diagnóstico opcional retomável, sem IA. [Entrega e limites das Missões 4 e 5](docs/studyspace-3/MISSOES-4-5-RESULTADO.md).
- Planner semanal com prévia e aceite, replanejamento de pendências e resumo Hoje. [Entrega e limites das Missões 6 e 7](docs/studyspace-3/MISSOES-6-7-RESULTADO.md).
- Revisão espaçada com fila devidos/novos, cota diária e entrada pelo planner; prática livre preservada. [Missão 8 completa — entrega 8B](docs/studyspace-3/MISSAO-8B-RESULTADO.md). [Base e proteção dos dados da 8A](docs/studyspace-3/MISSAO-8A-RESULTADO.md).
- Caderno de erros com fontes preservadas, correção, próxima ação e histórico de prática. [Missão 9A](docs/studyspace-3/MISSAO-9A-RESULTADO.md).
- Progresso por matéria: atividade por período, sessões, revisões pendentes e evidências das trilhas com vínculos explícitos.
- Atividades semanais com prévia: roteiros de prova demonstrativa, gabarito para autocorreção e redação com rubrica manual, salvos como notas editáveis.
- Dados locais: SQLite WebAssembly e IndexedDB na versão de navegador.
- JARVIS com 15 opções de provedor: Gemini, OpenAI, Groq, xAI, NVIDIA NIM, Anthropic, DeepSeek, Mistral, OpenRouter, Together AI, Fireworks AI, Cerebras, Ollama, LM Studio e API compatível personalizada.
- Listas de modelos carregadas automaticamente para os provedores configurados.
- Leitura com voz instalada no Windows e botão para gravação do microfone.

O estudo funciona sem uma conta de IA. Chamadas de IA e transcrição do microfone usam o provedor configurado; a leitura em voz usa o Windows. Ollama e LM Studio dependem de um servidor e de um modelo instalados separadamente.

## Usar no Windows

Na versão portátil, baixe o [release 2.0.0](https://github.com/BielIceCream/study-space/releases/tag/v2.0.0), extraia **todo** o arquivo `StudySpace_2.0.0_windows-x64-local.zip` e execute **Abrir StudySpace.cmd**. O pacote inclui o runtime Node.js necessário e abre o navegador em:

**http://127.0.0.1:1420/**

O servidor escuta apenas no próprio computador. Use **Encerrar StudySpace.cmd** para encerrá-lo.

## Executar a partir do código

Requer Windows, Node.js 24.12 ou superior e npm. Na pasta do projeto:

```powershell
npm.cmd ci
npm.cmd run local:build
npm.cmd start
```

`local:build` compila a interface, prepara a pasta `app/`, atualiza os adaptadores locais e cria `config/.env` a partir do exemplo, preservando uma configuração existente. O iniciador também usa o Node.js do sistema quando não há um runtime portátil.

Para encerrar:

```powershell
npm.cmd stop
```

Se outra cópia do StudySpace já estiver aberta, encerre-a antes de testar uma nova compilação: a porta 1420 e a origem dos dados são compartilhadas.

Para editar apenas a interface com recarregamento automático, use `npm.cmd run dev`. Para exercitar também as APIs locais do JARVIS, use o fluxo `local:build` e `start`.

## Configurar IA e voz

Edite `config/.env` ou abra **config/Editar configuracao.cmd**. Preencha apenas as chaves que quiser utilizar:

```dotenv
AI_PROVIDER=groq
GROQ_API_KEY=
NVIDIA_API_KEY=
OPENAI_API_KEY=
LOCAL_VOICE_ENABLED=true
```

Abra o JARVIS, entre nas configurações e escolha o provedor e o modelo nas listas. A configuração de voz deve indicar uma voz instalada no seu Windows.

Veja [o guia completo](config/COMO-CONFIGURAR.txt) e [as referências dos provedores](config/PROVEDORES.md).

O `.env` fica no computador, é ignorado pelo Git e não é servido ao navegador. O repositório contém somente `.env.example`, com chaves vazias. Nunca use o prefixo `VITE_` para guardar chaves de API.

## Dados e backup

Na versão local de navegador, os dados pertencem ao perfil e à origem `http://127.0.0.1:1420`. Limpar os dados do navegador remove essa biblioteca. Exporte um backup no aplicativo para guardar ou transferir seus estudos.

Em **Dados e backup**, o arquivo `.studyspace` v3 inclui matérias, notas salvas, cartões, avaliações, tema e materiais originais/imagens em segmentos separados. Aceita até 256 MiB por arquivo, manifesto de até 50 MiB, originais de até 32 MiB e imagens de até 8 MiB. O leitor continua aceitando JSON v1/v2 até 50 MiB. A exportação aguarda o salvamento da nota aberta; se ele falhar, a operação exibe o erro e não inicia o download. Rascunhos ainda não salvos, chaves de API, `config/.env` e preferências do JARVIS não integram a cópia da biblioteca.

A restauração exige biblioteca vazia e valida referências, tamanhos e hashes antes de publicar os dados. Pacotes corrompidos, incompletos ou acima dos limites são recusados. O formato v3 não usa compressão; o limite físico inclui manifesto e materiais. Consulte o [contrato e os resultados da Missão 2](docs/studyspace-3/MISSAO-2-RESULTADO.md), incluindo a medição de memória.

Antes de migrar um banco existente, o aplicativo guarda e relê uma cópia local com checksum. **Dados e backup → Proteção antes de migrações** permite baixar até três cópias recentes como `.studyspace`; a tela de erro inicial do navegador também oferece esse acesso. Banco novo ou já atualizado não gera cópias artificiais. Veja o [guia de recuperação](docs/studyspace-3/RECUPERACAO.md), incluindo o procedimento nativo em destino isolado. Continue guardando backups externos: limpar o perfil do navegador remove também suas cópias locais.

## Verificação

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e:install
npm.cmd run test:e2e
```

Os navegadores de teste são opcionais para o desenvolvimento e ficam em `.cache/playwright`. Não são necessários para usar o aplicativo.

Para verificar somente backups na build de produção, use `npm.cmd run test:e2e:backup` depois de `npm.cmd run build`. Esse teste abre preview isolado na porta 1431, sem reutilizar o servidor de uso. Para usar Edge já instalado, defina `$env:STUDYSPACE_E2E_CHANNEL='msedge'` antes do comando.

`npm.cmd run test:recovery:parity` verifica a passagem real navegador → cópia SQLite → Rust → navegador com fixture sintética. Requer Cargo/Rust e ferramentas nativas já preparados; usa o cache local de Rust quando disponível e recusa baixar dependências durante esse teste.

A versão 2.0.0 reúne trilhas, planner, revisão espaçada, caderno de erros, progresso e atividades manuais. Veja as [novidades e orientações de atualização](CHANGELOG.md). A edição local 0.2.0 está documentada no [registro histórico](docs/VERIFICACAO-LOCAL-0.2.0.txt).

## Estrutura

```text
src/             Interface React e TypeScript
db/              Migrações SQL compartilhadas
runtime/         Servidor local, provedores e voz Windows
config/          Configuração de exemplo e guias
scripts/local/   Preparação da versão local a partir do build
tests/           Cenários de interface e arquivos de teste
src-tauri/       Backend nativo Tauri preservado
docs/            Referências, capturas e guias
```

O backend Tauri e seu fluxo de build continuam no código para desenvolvimento nativo. A distribuição local descrita acima usa o servidor Node.js e o navegador. Dependências de terceiros têm suas licenças em [COMPONENTES-LICENSES.txt](runtime/COMPONENTES-LICENSES.txt) e [NODE-LICENSE.txt](runtime/NODE-LICENSE.txt).

## Evolução StudySpace 3.0

A [Missão 0](docs/studyspace-3/README.md) documenta o diagnóstico da base 0.2.0, arquitetura incremental e roadmap para trilhas, planner local, aprendizagem, pesquisa Perplexity no JARVIS e PWA. A [Missão 1](docs/studyspace-3/MISSAO-1-RESULTADO.md) corrige a consistência do arquivo de backup, a [Missão 2](docs/studyspace-3/MISSAO-2-RESULTADO.md) entrega o backup escalável e a [Missão 3](docs/studyspace-3/MISSAO-3-RESULTADO.md) protege migrações e recuperação. A [Missão 4](docs/studyspace-3/MISSAO-4.md) inicia a trilha mínima configurável.
