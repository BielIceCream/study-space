# Estrutura do StudySpace

O frontend aprovado permanece em `src/` e `public/`. A organização agrupa ferramentas de desktop, verificação e documentos sem mover componentes, alterar o schema ou tocar nos estudos salvos.

```text
ProjetoEstudar/
├── src/
│   ├── features/                 matérias, notas, flashcards, busca e backup
│   ├── services/                 armazenamento, estado, rascunhos e ponte JARVIS
│   └── shared/                   contratos e componentes comuns
├── public/                       recursos estáticos
├── src-tauri/
│   ├── src/                      comandos Rust, SQLite e credenciais Windows
│   ├── capabilities/             permissões da janela
│   ├── icons/                    identidade visual do aplicativo/instalador
│   └── tauri*.conf.json          produção, offline e QA isolado
├── db/migrations/                SQL compartilhado pelos dois armazenamentos
├── scripts/
│   ├── desktop/
│   │   ├── install-build-tools.ps1  instalação aditiva de MSVC/Windows SDK
│   │   ├── portable-rust.py       toolchain Rust local e verificada
│   │   ├── windows-build.mjs      desenvolvimento, testes e build Tauri
│   │   ├── package-windows.ps1    instalador, aplicativo, ZIP e checksums
│   │   └── resolve-native-lock.mjs  resolução Cargo com HTTPS verificado
│   │       demais scripts         diagnóstico, assinatura e auditoria Windows
│   └── quality/
│       ├── frontend-preservation.mjs  conferência da interface por SHA256
│       └── playwright.mjs        runner de testes com Chromium local
├── tests/e2e/                    jornadas e referências visuais
├── docs/
│   ├── WINDOWS.md                instalação, build, dados e limitações reais
│   ├── ESTRUTURA.md              este mapa
│   ├── originals/                ZIP original das skills, preservado
│   ├── previews/                 capturas da aplicação
│   └── windows/reference/        hashes e medidas anteriores às alterações
├── .agents/skills/               skills originais, preservadas
├── .github/workflows/            build manual em runner Windows
├── PROMPT_INICIAL.md             instruções originais no caminho informado
├── PROGRESSO.md                  checkpoint único
├── README.md                     entrada da documentação
└── arquivos de configuração     package/locks, TypeScript, Vite e testes
```

Pastas geradas e ignoradas pelo Git: `node_modules/` (dependências), `.cache/` (Rust, npm, Chromium, checkpoint e diagnósticos), `dist/` (frontend compilado), `src-tauri/target/` (compilação nativa), `test-results/`/`playwright-report/` (evidências) e `release/windows/` (aplicativo, instalador, ZIP, checksums e relatório de verificação). O build atual gerou essa distribuição, ainda sem assinatura digital. Esses diretórios não foram apagados nem tratados como código-fonte.

Os testes unitários continuam ao lado do código que verificam. Os bancos reais ficam nos diretórios de dados do aplicativo ou no perfil do navegador, separados desta árvore. O arquivo `docs/originals/StudySpace_Agent_Skills_Codex_Claude.zip` foi movido sem alterar seu conteúdo; o prompt inicial permanece na raiz.

Missão 2.4: `src/services/jarvis/` separa contexto, ferramentas, cliente e voz; `src/services/import/` contém parsers e fixtures. Os controles ficam em `src/features/jarvis/`, `import/` e `documents/`, ligados às páginas existentes. Rust `jarvis_ai.rs`, `jarvis_voice.rs` e `materials.rs` fornecem HTTPS, síntese local e importação SQLite. As duas novas skills ficam em `docs/skills/`, pois `.agents` é protegido neste ambiente.

Missão 2.4: `src/services/jarvis/` separa contexto, ferramentas, cliente e voz; `src/services/import/` contém parsers e fixtures. Os controles ficam em `src/features/jarvis/`, `import/` e `documents/`, ligados às páginas existentes. Rust `jarvis_ai.rs`, `jarvis_voice.rs` e `materials.rs` fornecem HTTPS, síntese local e importação SQLite. As duas novas skills ficam em `docs/skills/`, pois `.agents` é protegido neste ambiente.
