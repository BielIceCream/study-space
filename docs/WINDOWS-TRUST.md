# Build e confiança Windows — missões 2.3 e 2.3.1

O projeto continua com React/TypeScript, Vite e Tauri 2/NSIS. Nenhum arquivo de `src/`, `public/`, schema SQL ou backend Rust foi alterado nesta missão. Não foram feitas otimizações de desempenho do aplicativo: o escopo de 2.3.1 concentra-se no build, e não houve medições comparáveis de RAM/inicialização nativa que justificassem alterar o funcionamento. O editor pesado já utiliza carregamento sob demanda.

## Diagnóstico confirmado

`npm run build` executa `tsc --noEmit` e Vite; não instala nem inicia Rust. `desktop:build` valida configurações, chama Tauri, executa o build do frontend, compila Rust e gera NSIS. A compilação nativa executa build scripts e carrega proc macros produzidos pelo Cargo.

O log `Microsoft-Windows-CodeIntegrity/Operational` contém os eventos abaixo. São bloqueios de binários gerados durante o build, não evidência de bloqueio de Node/npm nem de detecção de malware.

| UTC em 13/10/2026 | Evento/registro | Arquivo sob `src-tauri/target/` |
| --- | --- | --- |
| 20:48:30 | 3077 / 46756 | `debug/build/thiserror-055c66f88d5fa319/build-script-build.exe` |
| 20:51:47 | 3077 / 46761 | `debug/build/quote-b7efb0a057310708/build-script-build.exe` |
| 20:52:27 | 3077 / 46766 | `release/build/selectors-615f355a471a0acd/build-script-build.exe` |

Processo solicitante: `cargo.exe`. Política: `VerifiedAndReputableDesktop`, status `0xc0e90002`. O último arquivo está `NotSigned`; SHA-256 integral `50962ddf4960589dfe1c1499013c3f88763bb7ace0759a87d4498df36406621b` coincide com o evento. O hash do arquivo `thiserror` mudou após recompilação, portanto não foi usado para confirmar identidade atual. `cargo tree --locked --offline -i selectors` confirmou que a dependência é utilizada por `dom_query → tauri-utils → Tauri`, e não deve ser removida.

Segundo a [documentação Microsoft de testes SAC](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/test-your-app-with-smart-app-control), 3077 corresponde à aplicação da política e 3076 à auditoria. A causa provável é código recém-gerado sem assinatura/reputação suficiente, compatível com o [modelo de confiança do SAC](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview). Não foi possível determinar a decisão interna do serviço de reputação.

A nova tentativa **compilou o aplicativo e gerou NSIS** com o estado SAC ainda em `1` (ativo). Foi usado `CARGO_NET_OFFLINE=true` apenas nessa tentativa para aproveitar dependências oficiais já no cache e separar a falha Schannel de HTTPS do diagnóstico de execução. O NSIS e seu plugin foram obtidos pelo bundler Tauri com validação de hash. Nenhuma proteção, política, exclusão, nome de executável ou dependencia Rust foi alterada para permitir execução. Não há garantia de que um binário sem assinatura será aceito em novas builds ou em outro computador.

Logs por etapa e diagnóstico sanitizado: `.cache/windows-diagnostics/`; comando `npm.cmd run desktop:diagnose`. Sem Git inicializado, o checkpoint prévio de 113 arquivos foi salvo em `.cache/checkpoints/mission-2.3-before/`, com cópias e SHA-256. Não contém bancos de AppData nem estudos do navegador.

## Distribuição produzida e verificações

Os arquivos atuais estão em `release/windows/`: instalador `StudySpace_0.1.0_x64-setup.exe`, aplicativo `StudySpace_0.1.0_x64.exe`, ZIP sem instalação, `SHA256SUMS.txt` e `verification.json`. **São artefatos sem assinatura, para avaliação.** O ZIP acompanha o programa; os estudos continuam no perfil Windows. A assinatura pública ainda depende de certificado/serviço legítimo.

O build verifica nome, versão, identificador, ícones, recursos locais e inventário da distribuição. A auditoria recusa hashes divergentes, arquivos/pastas não inventariados e um executável dentro do ZIP diferente do aplicativo. A assinatura, quando exigida, é verificada com Authenticode, EKU de assinatura de código, cadeia via SignTool `/pa /all /v /tw`, editor esperado e timestamp. A varredura Defender usa o scanner Microsoft assinado e confirma que os hashes não mudaram por remoção/remediação; nenhum parâmetro de proteção é alterado.

| Verificação atual | Resultado |
| --- | --- |
| TypeScript + Vite | Aprovado antes e durante o build desktop; mesmos hashes de recursos. |
| Testes Rust | 15 aprovados; 1 reprovado: gravação no cofre Windows retornou erro 1312 nesta sessão. Nenhum teste foi removido/ignorado. |
| Build Tauri/NSIS | Aprovado; aplicativo e instalador gerados. |
| SHA-256, metadados e conteúdo do ZIP | Aprovado. |
| Defender nos artefatos finais | Aprovado: saída informou nenhuma ameaça, exit 0 e hashes preservados. |
| Authenticode do StudySpace | Executado: `NotSigned`, requisito de confiança pendente. |
| Verificador SignTool | Aprovado em binário Microsoft do SDK; não equivale à aprovação do StudySpace. |
| DLL Microsoft Artifact Signing | Assinatura Microsoft válida; serviço de assinatura não utilizado. |
| Testes de configuração de assinatura | 3 aprovados. YAML/estrutura do workflow e sintaxe dos scripts validados. |
| Instalação/desinstalação, SAC/SmartScreen do aplicativo e VM | Não executados; exigem teste do artefato no ambiente de destino. |
| RAM/inicialização antes/depois | Não medidos; não foram inventadas métricas de otimização. |

`npm.cmd run desktop:verify:release` verifica a distribuição existente. `npm.cmd run desktop:scan:release` registra a varredura no relatório. O status do serviço Defender via WMI estava inacessível nesta sessão; a varredura por `MpCmdRun.exe` foi executada com sucesso. São verificações diferentes.

`dumpbin /DEPENDENTS` encontrou somente DLLs do sistema Windows/UCRT no aplicativo, sem DLL SQLite ou redistribuível VC externo a copiar. O ZIP não contém sidecars, banco, documentos ou credenciais. O teste de credenciais falhou em `set_password`; o [erro oficial 1312](https://learn.microsoft.com/pt-br/windows/win32/debug/system-error-codes--1300-1699-) indica ausência de uma sessão de logon utilizável. Repetir `desktop:test` em uma sessão Windows com acesso ao Gerenciador de Credenciais; não foi implementado fallback inseguro.

## Assinatura preparada, ainda pendente

A [Microsoft recomenda assinatura confiável para SAC](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/code-signing-for-smart-app-control). A implementação usa o [callback de assinatura do Tauri](https://tauri.app/distribute/sign/windows/) para assinar o aplicativo, plugins PE, desinstalador interno e instalador antes de finalizar o empacotamento. O callback verifica imediatamente cada assinatura e registra hashes públicos. A auditoria exige evidência do desinstalador em builds assinados. Arquivos PE não são alterados depois dessa assinatura pelo processo de distribuição.

O modo `certificate` usa SignTool e um certificado de assinatura de código com chave disponível em `Cert:\CurrentUser\My` (incluindo provedor compatível de token/HSM). Configure apenas variáveis de ambiente: `STUDYSPACE_SIGNING_MODE=certificate`, `STUDYSPACE_PUBLISHER` (nome exato do signatário público), `STUDYSPACE_CERTIFICATE_THUMBPRINT` e `STUDYSPACE_TIMESTAMP_URL` (RFC3161 recomendado pela CA). Então execute `npm.cmd run desktop:build:signed`. Não importe certificados autoassinados nem publique chaves/senhas. Certificados modernos podem exigir hardware/serviço remoto; não presuma que permitem exportação PFX.

O modo `artifact` usa [Microsoft Artifact Signing com SignTool](https://learn.microsoft.com/en-us/azure/artifact-signing/how-to-signing-integrations). Exige conta elegível, identidade validada, perfil **Public Trust**, permissões de assinatura e custos do serviço. Configure `STUDYSPACE_SIGNING_MODE=artifact`, editor, `STUDYSPACE_SIGNING_DLIB` apontando à DLL Microsoft x64 e `STUDYSPACE_SIGNING_METADATA` apontando ao JSON de endpoint/conta/perfil. A autenticação usa mecanismos Azure apropriados, fora dos arquivos do projeto. O timestamp padrão desse modo é o endpoint RFC3161 oficial `http://timestamp.acs.microsoft.com`.

Nenhuma credencial foi encontrada ou criada, nenhuma conta foi contratada e nenhum arquivo StudySpace foi assinado. O comando de build assinado recusa configuração incompleta. Assinar os artefatos finais não resolve automaticamente o bloqueio de auxiliares gerados durante a compilação local.

## Pipeline Windows e próxima validação

O workflow manual `.github/workflows/windows-desktop.yml` usa runner Microsoft `windows-2022`, ações fixadas por commit, Node/Rust fixados e locks. Ele executa testes, frontend, backend, regressão visual, NSIS, auditoria de integridade e Defender quando disponível. `require_defender=true` torna a disponibilidade do scanner obrigatória. O resultado é um artefato, sem publicar release ou fazer deploy.

`signing_mode=none` identifica o artefato como `unsigned`. `certificate` exige secrets `WINDOWS_CERTIFICATE`/`WINDOWS_CERTIFICATE_PASSWORD` para um certificado exportável legitimamente disponível; o PFX temporário é removido imediatamente e os certificados importados são limpos no final. `artifact` exige secrets `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, variáveis públicas de endpoint/conta/perfil e editor. O cliente Microsoft NuGet 1.0.146 é fixado e sua assinatura é verificada. Esses valores pertencem a credenciais de assinatura; não use API Key pessoal do JARVIS. Metadados, logs e artefatos não contêm chaves privadas ou senhas. O workflow ainda não foi executado remotamente: falta disponibilizar o código em um repositório GitHub e configurar o serviço/certificado escolhido.

Antes de distribuir publicamente, testar instalação, todos os binários/plugins temporários, desinstalação, dados após reabrir e Biblioteca em Windows/VM com proteção legitimamente ativa. Não aplique ao PC do usuário os procedimentos de alteração de políticas da documentação de laboratório. PDF e JARVIS com áudio não estão implementados neste checkout; sua ponte de credenciais existente foi preservada, sem mudança de provedor, voz ou funcionalidades.

SAC controla execução, SmartScreen avalia reputação/origem e Defender analisa ameaças: uma varredura limpa ou um build CI bem-sucedido não garante aprovação pelos demais. Assinatura também não garante ausência imediata de aviso SmartScreen. Para suspeita de falso positivo, registre produto, horário, evento, hash e assinatura do arquivo exato; solicite análise no [portal oficial Microsoft](https://www.microsoft.com/en-us/wdsi/filesubmission), escolhendo o produto afetado. Nenhum arquivo foi enviado automaticamente.
