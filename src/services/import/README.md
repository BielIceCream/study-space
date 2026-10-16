# Importações StudySpace

`parseImportFile(file, options?)` lê um arquivo local e retorna uma prévia. A UI escolhe uma matéria, revisa quantidades/avisos e envia `preview.batch` ao armazenamento transacional. O parser não grava dados nem envia conteúdo à rede.

CSV/TSV aceitam UTF-8, BOM, células entre aspas e linhas múltiplas. O mapeamento usa índices de coluna a partir de zero; `hasHeader` controla o descarte do cabeçalho.

JSON aceita uma lista de cartões, `{ "flashcards": [...] }` ou este formato estável:

```json
{
  "format": "studyspace-import",
  "version": 1,
  "notes": [{ "title": "Aula", "text": "Texto de origem" }],
  "flashcards": [{ "front": "Pergunta", "back": "Resposta", "tags": ["biologia"], "noteIndex": 0 }]
}
```

`question`/`answer` e `pergunta`/`resposta` também são aceitos. `noteIndex` referencia uma nota do mesmo arquivo. JSON com notas preserva também os bytes originais e o SHA-256, vinculados à primeira nota; `page: 1` representa seu texto lógico, sem atribuir paginação ao JSON. JSON somente de cartões não cria documento. Backups StudySpace usam a restauração própria; não são confundidos com este formato de importação.

`createFlashcardExport(cards, metadata)` produz o mesmo formato `studyspace-import` versão 1, com cartões independentes contendo `front`, `back` e `tags`. A exportação JSON limita-se a 5.000 cartões e 32 MiB e pode ser reimportada. Imagens, fontes, links de notas e histórico são preservados pelo backup completo.

APKG lê bancos SQLite clássicos e modernos, inclusive `collection.anki21b` com Zstandard, modelos básicos/reversos, condicionais simples e cloze. Tags e imagens locais PNG/JPEG/GIF/WebP/BMP são preservadas por hash. Áudio, scripts, mídia externa, CSS e oclusões aninhadas não são executados; recursos sem conversão aparecem nos avisos. O histórico e o agendamento Anki não são importados.

PDFs usam PDF.js e worker empacotado localmente, com texto por página e até 2.000 páginas. DOCX extrai parágrafos de `word/document.xml`. PDF/DOCX/TXT/MD preservam bytes originais e SHA-256 junto à nota editável. PDF escaneado mostra aviso de OCR indisponível. Markdown permanece texto editável.

Limites: arquivo 32 MiB; 5.000 notas/cartões; lote reservado ao backup 50 MiB; ZIP expandido 64 MiB com até 10.000 entradas, caminhos delimitados, CRC verificado e limite de expansão. Cancelamento e progresso são opcionais. Duplicatas são identificadas na prévia; o armazenamento decide a deduplicação final incluindo referências de imagens.

Fixtures físicos para QA ficam em `fixtures/`. Regeneração: `node src/services/import/fixtures/generate.mjs`.
