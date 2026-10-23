# Missão 9B — Resumo por matéria

Concluída na versão **2.0.0**: [entrega das 9B/9C](MISSOES-9B-9C-RESULTADO.md). O escopo abaixo registra os critérios usados.

Base: [9A — Caderno de erros](MISSAO-9A-RESULTADO.md). Entrega pequena: tornar visível o que foi estudado e o que merece retomada usando dados já existentes, sem criar nova migração.

## Escopo pronto para execução

1. Criar seletores puros para um resumo por matéria: cartões/revisões, erros abertos/resolvidos e práticas registradas. Contar sessões distintas separadamente de respostas; mostrar período e tamanho da amostra. Evitar dupla contagem entre a avaliação vinculada ao erro e a mesma avaliação no histórico.
2. Mostrar vencimentos atuais do SRS como estado presente, separados da atividade no período. Erros resolvidos e autoavaliações de memória não são porcentagem de domínio ou nota de prova.
3. Reutilizar a biblioteca/espaço da matéria e os atalhos para revisão e caderno. Incluir estados sem dados, teclado, tela pequena e leitura clara sem gráficos obrigatórios. Para diagnóstico, reutilizar a evidência por competência da trilha e seus vínculos explícitos; não atribuir resultado a uma matéria por nome ou série.
4. Se mostrar atividade do planner, rotular duração planejada/concluída como estimativa de blocos, sem chamar isso de tempo cronometrado. Não somar automaticamente capacidade de trilhas independentes.

Começar com um período simples (últimos sete dias e todo o histórico), limites de dia local e datas claramente indicadas. Calcular sobre o snapshot existente com índices; não reler o banco em cada cartão de indicador nem adicionar dependências de gráficos.

## Conclusão verificável

- Fixtures com duas matérias, dados vazios, múltiplas respostas na mesma sessão, dias na fronteira de fuso e erros reabertos comprovam contagens e separação de conceitos.
- O mesmo histórico produz o mesmo resumo para uma data de referência explícita; números após reload/backup permanecem equivalentes.
- Atalhos preservam filtros/origem e não gravam progresso ao abrir a tela. Teclado, mobile e Axe cobrem a jornada nova.
- Build e regressões pertinentes passam; instalação local e commit em português encerram a entrega. Sem alterar schema, backup, JARVIS ou regras SRS.

Provas semanais e rubrica manual de redação ficam na 9C, com conteúdo/licença e orçamento do planner definidos antes da implementação.
