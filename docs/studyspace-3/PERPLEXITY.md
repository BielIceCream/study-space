# Perplexity para o JARVIS — pesquisa da Missão 0

Verificação: **2026-10-18**. Somente documentação oficial Perplexity; nenhuma chamada paga, credencial ou implementação. Valores em USD são uma fotografia desta data e precisam de nova conferência na missão de integração.

## Fatos verificados

### Pesquisa e geração são capacidades diferentes

- **Search API**: `POST https://api.perplexity.ai/search`, autenticação `Authorization: Bearer …`. Retorna resultados classificados, sem gerar uma resposta de tutor. A resposta contém `results[]` com `title`, `url`, `snippet`, `date`, `last_updated`, além de identificador; não presumir que todos os campos estejam preenchidos. Web admite até 20 resultados, padrão 10. Há filtros por domínio, idioma, recência e intervalos de publicação/atualização; limites de conteúdo por consulta/página. [Referência HTTP](https://docs.perplexity.ai/api-reference/search-post), [guia e exemplos com datas nulas](https://docs.perplexity.ai/docs/search/quickstart).
- **Agent API**: geração atual em `POST https://api.perplexity.ai/v1/agent`; `/v1/responses` é alias compatível com OpenAI. Pode gerar respostas com ferramentas de pesquisa ou sem elas. [Quickstart](https://docs.perplexity.ai/docs/agent-api/quickstart).
- **Mudança relevante**: o suporte a Sonar Chat Completions terminou em **2026-09-27**. Chamadas síncronas e streaming antigas continuam por reformulação gradual como Agent API; Sonar assíncrono antigo deixou de ser suportado. A recomendação oficial para projetos novos é Agent API. Portanto, não iniciar integração nova dependente de `chat/completions` ou dos antigos modelos `sonar-pro`, `sonar-reasoning-pro`, `sonar-deep-research`. [Migração oficial](https://docs.perplexity.ai/docs/agent-api/migrate-from-sonar/overview).
- O catálogo atual de geração inclui **`perplexity/sonar`**, além de modelos de terceiros; a lista é dinâmica. Para o objetivo imediato do StudySpace, Search API não exige selecionar modelo gerador. [Catálogo](https://docs.perplexity.ai/docs/agent-api/models).
- Na Agent API, `search_results` fornece identificador estável, URL, título, trecho e datas. Marcadores inline dependem do prompt; os identificadores e URLs retornados são a fonte de verdade, não links escritos livremente pelo modelo. [Pesquisa na Agent API](https://docs.perplexity.ai/docs/agent-api/tools/web-search).

### Custos e limites

| Capacidade | Preço verificado |
|---|---|
| Search API padrão | US$ 5 / 1.000 requisições bem-sucedidas |
| Search API `search_type: "fast"` | US$ 1 / 1.000 requisições bem-sucedidas |
| Agent `web_search` padrão / fast | US$ 2,50 / US$ 1 por 1.000 invocações, mais tokens |
| `perplexity/sonar` Agent | US$ 0,25 entrada / US$ 2,50 saída por milhão de tokens; cache-read US$ 0,0625 |

Search não cobra tokens adicionais. Até cinco consultas em uma requisição contam como uma unidade faturável; resposta bem-sucedida vazia também é cobrada. Requisições inválidas, limitadas ou com falha upstream não são cobradas. [Preços](https://docs.perplexity.ai/docs/getting-started/pricing), [modelo Sonar atual](https://docs.perplexity.ai/docs/agent-api/models).

Search admite 50 unidades de consulta/s e burst de 50; cada consulta no array consome uma unidade, embora a cobrança seja por requisição. Agent compartilha limite por organização, de 1 QPS no tier 0 a 33 QPS nos superiores. Esses tetos do fornecedor não substituem orçamento do aplicativo. [Limites](https://docs.perplexity.ai/docs/admin/rate-limits-usage-tiers).

O portal permite criar/revogar chaves, acompanhar consumo e comprar créditos antecipados; auto recarga é opcional. Não foi verificado um teto financeiro rígido por chave. [Projetos e faturamento](https://docs.perplexity.ai/docs/getting-started/projects).

### Credenciais, retenção e privacidade

A documentação proíbe expor chaves em JavaScript cliente, apps móveis, repositórios, logs, erros e URLs. [Gestão de chaves](https://docs.perplexity.ai/docs/admin/api-key-management).

Não treinamento é o padrão segundo os termos de API, mas **zero retenção não é o padrão**: depende de elegibilidade, acordo escrito e configuração de conta; provedores/modelos podem ter condições próprias. A documentação não estabelece um prazo universal de retenção aplicável a toda chamada Search/Agent. [Privacidade e segurança](https://docs.perplexity.ai/docs/resources/privacy-security).

Na Agent API, `store: false` apenas oculta recuperação pelo usuário: **não desativa persistência**. Não prometer “sem retenção” com essa flag. [Estado de conversa](https://docs.perplexity.ai/docs/agent-api/conversation-state).

## Decisões propostas para o StudySpace

1. Adicionar `PerplexitySearchProvider` a uma pequena interface de pesquisa, separada dos 15 provedores de geração existentes. JARVIS escolhe explicitamente pesquisar; recebe evidências normalizadas e usa o gerador já configurado para explicar. Geração Perplexity via Agent é extensão posterior opcional, sem requisito para o primeiro incremento.
2. Desktop: segredo do próprio usuário em cofre do sistema, acessado por ponte restrita do processo nativo; renderer recebe somente resultados. PWA: chave em serviço intermediário seguro opcional, com autenticação, limites e minimização de consultas. Uma PWA estática não consegue manter segredo equivalente a backend; não embutir chave de projeto nem armazená-la em `localStorage`. A decisão do transporte deve reutilizar a tecnologia desktop real encontrada no repositório.
3. Assistente guiado: abrir portal oficial; explicar cobrança separada da assinatura; cadastrar/testar chave mediante ação; exibir pesquisa padrão/fast, preço datado, limite de consultas e orçamento diário/mensal; mascarar chave e oferecer remoção. Reservar orçamento antes de enviar, inclusive entre chamadas concorrentes; uma resposta perdida por timeout pode ter sido cobrada, portanto manter custo incerto até reconciliação e evitar repetição automática que duplique despesa. Limites locais são estimativas por instalação e podem ser contornados por outras instalações usando a mesma chave; teto efetivo compartilhado exige controle no intermediário/conta. Não habilitar recarga automática pelo aplicativo.
4. Enviar somente a dúvida sanitizada e termos necessários; excluir nome, idade, escola, identificadores, desempenho, histórico de conversa e arquivos por padrão. Conteúdo personalizado só após escolha clara do estudante. Resultados web são entrada não confiável: nunca podem autorizar ferramentas, alterar configuração ou sobrescrever instruções do tutor.
5. Persistir fontes com URL, título, trecho limitado, datas fornecidas e `retrievedAt` local; datas ausentes aparecem como indisponíveis. Search retorna um ID da requisição; normalizar um ID local por resultado efetivamente recebido quando não houver ID de fonte upstream. Associar citações somente a esses resultados rastreáveis. Lista de fontes consultadas não equivale automaticamente a uma afirmação comprovada. Sanitizar URLs/HTML e abrir apenas protocolos permitidos.
6. Cache local limitado por tamanho e validade, chaveado por consulta normalizada + filtros + versão do provedor, excluindo dados pessoais. Prazo inicial proposto: 24 h; menor para conteúdo temporal. Indicar horário/cache e permitir atualizar/apagar. Conferir termos/licenças antes de escolher retenção de trechos; não transformar cache em arquivo integral da web.
7. Timeout, cancelamento, backoff curto e limite de tentativas; erros de autenticação/crédito não entram em repetição automática. Offline, sem chave, sem orçamento, sem resultados ou API indisponível: informar que a pesquisa não ocorreu e permitir explicação sem pesquisa pelo provedor atual; jamais criar referências. Sem IA configurada, manter todo fluxo de estudos e permitir consultar fontes obtidas como lista.

## Pendências para a missão de integração

- CORS/suporte contratual a chamadas diretas do navegador **não foi confirmado** nas páginas oficiais consultadas; não basear arquitetura nisso. Validar transporte desktop/PWA com teste mínimo, sem credenciais de produção no frontend.
- Revalidar preços, catálogo, campos de resposta e termos/retenção antes de implementação; não há garantia universal de custo máximo por resposta Agent, pois ferramentas e tokens variam.
- Critérios de conclusão sugeridos: pesquisa isolada com respostas simuladas de sucesso/vazio/erro/datas nulas; fontes reais rastreáveis; segredo ausente de renderer/log/backups; limite e cache verificáveis; nenhuma regressão dos provedores existentes; aplicativo plenamente utilizável com rede e IA desligadas.
