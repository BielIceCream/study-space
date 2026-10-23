# Missão 8 — Revisão espaçada dos cartões

Base: [Missões 6 e 7](MISSOES-6-7-RESULTADO.md). Entrega delimitada: estado de revisão por cartão e fila local de cartões devidos, preservando a prática livre.

**Missão concluída:** [8A — motor e persistência](MISSAO-8A-RESULTADO.md) e [8B — fila e uso diário](MISSAO-8B-RESULTADO.md). Os critérios e a divisão originais permanecem abaixo como registro. Próxima entrega: [9A — caderno de erros](MISSAO-9.md).

## Divisão em duas entregas

Por solicitação do estudante, a missão foi dividida em duas metades de escopo, sem estimativa de horas:

- **8A — Base e segurança (50%)**: regras locais versionadas, estado por cartão, resposta e agenda atômicas, idempotência, migração protegida, backup v6 e paridade. [Contrato e resultado](MISSAO-8A-RESULTADO.md).
- **8B — Uso diário (50% restantes)**: fila visual por vencimento, admissão gradual e limite diário de cartões novos, distinção entre atrasados/novos, sessão por teclado e celular e entrada pelo planner. A prática livre permanece disponível.

Os itens originais abaixo continuam como critérios da missão completa. A entrega 8A não habilita a revisão espaçada na interface; não há recálculo de histórico antigo.

1. Escolher e documentar algoritmo determinístico, versão das regras e significado das quatro avaliações já existentes. Verificar a documentação primária se houver biblioteca externa; preferir dependência pequena e sem rede.
2. Persistir estado por cartão. Registro da resposta e atualização do próximo vencimento devem ser atômicos e idempotentes por sessão/cartão. Cartões importados/antigos entram gradualmente; não reconstruir domínio a partir da série escolar ou quantidade de cliques.
3. Exibir cartões devidos e limite diário, distinguir atraso de novo conteúdo e manter a prática livre existente. Usar o tempo de revisão do planner para orientar a sessão; não duplicar automaticamente compromissos nem transformar um bloco concluído em cartões avaliados.
4. Ampliar migração protegida, backup e paridade. Documentar regras de datas/fuso, recuperação e compatibilidade antes de publicar o novo formato.

Conclusão: avaliações antigas preservadas; mesma entrada produz mesmo vencimento; resposta duplicada não avança duas vezes; falha de gravação não publica metade da revisão; reinício/exportação/restauração mantêm agenda dos cartões; fluxo utilizável sem IA, por teclado e em tela pequena.

Fora desta missão: Perplexity, novos provedores, provas automáticas, catálogo nacional, sincronização ou replanejamento entre várias trilhas. Reunir orçamento de várias trilhas requer um incremento próprio de agenda unificada.

## Próxima execução: 8B

1. Construir seletor puro de cartões devidos (UTC), ordenação estável de atrasos e cota configurável de novos cartões por dia civil local. Não colocar todos os importados na agenda ao abrir a tela; mostrar contagens e estado vazio.
2. Acrescentar escolha explícita entre prática livre e revisão espaçada. Somente a segunda envia `recordReview({ ..., schedule: true })`. Após sucesso, recarregar agenda e histórico juntos; não avançar o cartão nem exibir sucesso antes da persistência. Tratar falha de atualização da tela como necessidade de recarregar, sem afirmar que uma resposta já persistida se perdeu.
3. Limitar a sessão a uma resposta por sessão/cartão, manter atalho 1–4 e espaço, foco e anúncio de vencimento. Se Errei vence em dez minutos, informar o retorno na próxima sessão; não inventar uma repetição na mesma sessão.
4. Usar bloco de revisão do planner apenas como entrada para a sessão e orientação de tempo. A conclusão do bloco não avalia cartões; a sessão não gera blocos automaticamente.
5. Validar integração real com IndexedDB, restauração v6 na interface, reload, teclado, tela de 390 px e funcionamento após carregar sem rede. Reexecutar paridade se o contrato de dados mudar.
