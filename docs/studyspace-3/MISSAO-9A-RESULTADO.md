# Missão 9A — Caderno de erros

Base: `c1d7603`, [Missão 8 completa](MISSAO-8B-RESULTADO.md). Branch: `feat/missao-9a-caderno-erros`. Entrega em **23/10/2026**; escopo delimitado na [Missão 9](MISSAO-9.md).

## Uso

Na navegação, abra **Caderno de erros → Novo erro**. Escolha matéria e fonte: registro manual, cartão, nota ou questão já respondida de um diagnóstico. Registre o que aconteceu, a origem/atividade, a correção e a próxima ação. A origem do diagnóstico pode ser classificada em uma matéria existente sem presumir vínculo entre matéria e competência.

Após responder **Errei** na revisão, **Anotar no caderno de erros** abre um rascunho com cartão e revisão vinculados. Nada é criado até **Salvar registro**. A avaliação de memória continua distinta de um erro pedagógico.

Cada registro conserva a fonte capturada ao criar: frente/verso do cartão, até 1000 unidades UTF-16 do texto da nota (sem cortar um caractere ao meio) ou questão, alternativas e resposta do diagnóstico. A captura é texto simples e permanece após editar o material original. Não copia anexos ou notas inteiras. Matéria e vínculo ficam fixos; descrição, correção e próxima ação continuam editáveis.

Filtre por matéria e situação aberta/resolvida. Registre uma prática manual com descrição; em erros de cartão, **Praticar este cartão** inicia prática livre somente daquele cartão e permite voltar ao registro. A tela mostra avaliações posteriores do cartão, excluindo a resposta que originou o erro, sem transformá-las em comprovação de domínio. Notas vinculadas podem ser abertas no editor existente.

**Resolver erro** exige correção e próxima ação salvas. Resolução é explícita e pode ser revertida por **Reabrir erro**. Nem a resolução nem a prática manual alteram SRS, diagnóstico ou conclusão do planner. O registro não é enviado ao JARVIS automaticamente e funciona sem IA.

## Dados e falhas

`error_entries` usa o SQLite existente (schema **6**), chave da matéria e agregado JSON validado. A atualização segue a proteção pré-migração já existente; não há banco paralelo. Bancos antigos mantêm todos os dados e começam com caderno vazio.

TypeScript e Rust validam as mesmas fontes, vínculos, campos, limites e datas. Limites: 5000 registros, 200 práticas por registro; interface lista 50 por página. Revisão otimista impede sobrescrever mudanças de outra janela. Recarregar dados mantém a edição para conferência ou descarte explícito. A navegação e o fechamento sinalizam edição pendente, inclusive o texto de prática ainda não enviado.

Gravação, captura e histórico são transacionais. Falha de persistência não publica registro parcial. Cada prática tem ID estável durante a tentativa; repetir o mesmo ID/descrição devolve o registro salvo antes de conferir revisão, evitando duplicação quando a confirmação se perde. Outros campos enviados nesse retry não são reaplicados; a interface só registra prática depois de salvar a edição principal. A resposta da gravação atualiza o workspace sem depender de uma segunda leitura para confirmar criação.

Backups com registros usam portátil **v7**, incluindo captura, práticas, revisões e datas. Os leitores continuam aceitando v1–v6; formatos anteriores recusam registros de erro em vez de omiti-los. Biblioteca sem erros continua exportando a menor versão compatível (v3–v6). Restauração exige destino vazio e preserva materiais, IDs e histórico. Limites físicos/expansão permanecem os já documentados em [Recuperação](RECUPERACAO.md).

## Verificação e instalação

- `npm test -- --maxWorkers=1`: **201 aprovados** em 25 arquivos; dois condicionais de paridade ignorados na suíte geral.
- Cargo offline Windows MSVC: **76 aprovados**, dois ignorados (voz física e ponte de paridade). A ponte foi executada à parte com `npm run test:recovery:parity`: navegador → checkpoint SQLite real → Rust → manifesto v7/materiais → navegador, comparando o snapshot completo, incluindo erros de cartão e diagnóstico, captura e prática.
- Edge em perfis isolados, porta 1431: **19 cenários E2E aprovados**, sendo três novos do caderno e 16 regressões de backup, recuperação, trilhas, planner e revisão espaçada. Cobrem criação explícita após Errei, prática/retorno, resolução/reabertura, reload, restauração v7, teclado, 390 px, Axe WCAG A/AA e gravação sem rede após carregar. Capturas desktop/mobile inspecionadas.
- Casos de armazenamento incluem fonte preservada após editar material, fronteira UTF-16, vínculos inválidos, conflitos, retry sem duplicação, falha de gravação, limites e migração real 5 → 6 com cópia protegida. Um teste nativo revelou que a variante unitária de Serde aceitava campos extras na fonte manual; foi substituída por variante de struct vazia e a suíte completa passou.
- `npm run build`, `npm run local:prepare` e `git diff --check`: aprovados. Chunk principal **538,29 kB minificado / 159,29 kB gzip**; aviso de tamanho acima de 500 kB permanece visível. Sem novas dependências.

**Instalação local atualizada em `C:\Users\luisg\Documents\StudySpace-Local`:** 22 arquivos de build e `MISSAO-9A.txt` conferidos por SHA-256. Treze arquivos protegidos mantiveram hashes, incluindo configuração, runtime e atalhos. Assets publicados antes do HTML, sem apagar hashes antigos. Testes usaram somente bibliotecas/perfis sintéticos; a atualização não abriu o banco pessoal.

Para ver a mudança: abrir pelo atalho existente, **Ctrl+F5 → Caderno de erros**. A versão continua 0.2.0. Código nativo compilado/testado; nenhum novo instalador Tauri produzido. Sem push ou deploy.

## Limites e continuidade

Não inclui exclusão/merge de registros, catálogo novo, provas, rubrica de redação ou indicadores de domínio derivados do caderno. A aplicação portátil funciona sem rede após carregar; abertura totalmente offline da futura PWA continua separada. Os 15 provedores e importadores permanecem inalterados. Próxima entrega: [Missão 9B — resumo por matéria](MISSAO-9B.md).
