# Recuperar uma cópia antes de migração

As cópias automáticas protegem a versão anterior do banco durante uma atualização. Continue guardando backups `.studyspace` fora do aplicativo. No navegador, limpar os dados deste perfil também remove suas cópias automáticas.

## Navegador e instalação portátil

1. Abra **Dados e backup → Proteção antes de migrações**. Se a abertura normal falhar, a tela inicial também procura cópias no mesmo perfil.
2. Escolha a data/versão e clique em **Baixar cópia recuperada**. O aplicativo confere checksum e leitura SQLite, abre uma imagem isolada e gera um arquivo `.studyspace`. A biblioteca atual e a cópia guardada permanecem intactas.
3. Abra o StudySpace em outro perfil de navegador ou dispositivo, com biblioteca vazia, e importe o arquivo por **Dados e backup**. Confira notas, cartões, histórico e materiais antes de decidir qualquer ação sobre o espaço original.

O download usa os limites do backup v3–v7: 256 MiB físicos, manifesto de 50 MiB, documento de 32 MiB e imagem de 8 MiB. Trilhas e diagnósticos exigem v4 ou posterior; agendas do planner, fila sem horário e desfazer exigem v5; estados de revisão espaçada de cartões exigem v6; registros do caderno de erros, fontes capturadas e práticas exigem v7. Schema 6 acrescenta a tabela de erros com cópia protegida do banco anterior, sem criar registros retroativos. Uma cópia SQLite pode ocupar mais espaço que o conteúdo ativo, por conter páginas livres; o download informa quando o conteúdo exportável excede os limites. A cópia automática original continua guardada.

Se não houver cópias, uma atualização do formato ainda pode não ter ocorrido. Banco novo ou já atualizado não gera cópias artificiais. Falta de espaço ou falha ao reler a cópia interrompe a migração; libere espaço no perfil e tente novamente. Se o banco for de uma versão futura, abra-o com uma versão compatível do aplicativo.

## Aplicativo nativo Tauri

Com o aplicativo aberto, use a mesma seção para baixar uma cópia `.studyspace`. Os arquivos ficam em `recovery/<UUID>/`, junto à pasta privada do banco, com `database.sqlite3` e `metadata.json`.

No Windows, a pasta privada usa o identificador `app.studyspace.desktop` dentro do diretório de dados do usuário resolvido pelo Tauri (`app_data_dir`; normalmente `%APPDATA%\app.studyspace.desktop`). O caminho da instalação portátil `StudySpace-Local` é independente desse banco nativo.

Se a inicialização nativa falhar, a tela de recuperação do navegador não acessa automaticamente essa pasta. Encerre o aplicativo e preserve a pasta privada inteira, incluindo os arquivos WAL/SHM que existirem, além dos diretórios `recovery`. Trabalhe em outro perfil Windows ou dispositivo, com pasta privada vazia e versão do aplicativo compatível com `schemaVersion`:

1. Confira o SHA-256 e o tamanho de `database.sqlite3` contra `metadata.json`, por exemplo com `Get-FileHash -Algorithm SHA256` no PowerShell.
2. Copie somente o `database.sqlite3` da cópia verificada para a pasta privada vazia de destino, com o nome `studyspace.sqlite3`. A cópia foi feita pela API SQLite e contém os dados confirmados no WAL; não depende do WAL do banco original.
3. Abra o aplicativo no destino isolado e confira a biblioteca. Depois exporte `.studyspace` para transferência normal. Mantenha a origem preservada até concluir a conferência.

Essa recuperação manual nativa exige acesso ao sistema de arquivos e destino realmente vazio. A automação de testes verifica o mesmo conteúdo em banco nativo isolado e a volta para o navegador; a janela e o instalador Tauri não foram exercitados nesta missão.

## Retenção e integridade

São mantidas três cópias válidas mais recentes. Cópias repetidas do mesmo estado são reutilizadas após verificação. A remoção das antigas começa somente após a nova cópia ser publicada e relida com sucesso; uma falha de limpeza pode deixar cópias extras. No nativo, diretórios `.pending-*` abandonados por interrupção são ignorados e não são oferecidos como cópias válidas. A limpeza automática não remove o banco ativo nem diretórios desconhecidos.

O checksum detecta alterações, sem cifrar os estudos nem autenticar a autoria da cópia. Copiar ou recuperar dados não exige IA, rede externa ou credenciais de provedor.
