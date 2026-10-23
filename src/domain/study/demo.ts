import type { StudyCatalog, TrackConfig } from './types';
import { catalogSchema } from './validation';

/** Original educational examples. This is a small slice, not a complete ENEM curriculum. */
export const DEMO_CATALOG: StudyCatalog = catalogSchema.parse({
  id: 'studyspace-enem-zero-demo', version: 1, title: 'ENEM — Do zero',
  description: 'Amostra demonstrativa com fundamentos de Matemática e Linguagens. As seis unidades e as doze questões não cobrem o currículo do ENEM nem certificam domínio.',
  origin: 'Conteúdo original do StudySpace, Missões 4 e 5.', license: 'CC0-1.0', demonstrative: true,
  subjects: [{ id: 'matematica', name: 'Matemática' }, { id: 'linguagens', name: 'Linguagens' }],
  competencies: [
    { id: 'operacoes', subjectId: 'matematica', title: 'Operações e ordem de cálculo' },
    { id: 'proporcoes', subjectId: 'matematica', title: 'Razões e proporcionalidade' },
    { id: 'porcentagens', subjectId: 'matematica', title: 'Porcentagens no cotidiano' },
    { id: 'informacao', subjectId: 'linguagens', title: 'Localização de informação explícita' },
    { id: 'inferencia', subjectId: 'linguagens', title: 'Inferências apoiadas no texto' },
    { id: 'argumentacao', subjectId: 'linguagens', title: 'Tese e argumento' },
  ],
  units: [
    { id: 'mat-operacoes', competencyId: 'operacoes', title: 'Comece pelas operações', summary: 'Revise multiplicação, divisão e a ordem das operações. Registre seus próprios exemplos na biblioteca.', prerequisites: [] },
    { id: 'mat-proporcoes', competencyId: 'proporcoes', title: 'Compare razões e proporções', summary: 'Compare quantidades e reconheça quando a relação é diretamente proporcional.', prerequisites: ['mat-operacoes'] },
    { id: 'mat-porcentagens', competencyId: 'porcentagens', title: 'Calcule e interprete porcentagens', summary: 'Relacione porcentagens a frações e avalie descontos e aumentos simples.', prerequisites: ['mat-proporcoes'] },
    { id: 'lin-informacao', competencyId: 'informacao', title: 'Encontre o que o texto afirma', summary: 'Localize informações explícitas sem acrescentar suposições ao enunciado.', prerequisites: [] },
    { id: 'lin-inferencia', competencyId: 'inferencia', title: 'Faça inferências com pistas', summary: 'Distinga uma inferência sustentada por pistas de uma opinião ou extrapolação.', prerequisites: ['lin-informacao'] },
    { id: 'lin-argumentacao', competencyId: 'argumentacao', title: 'Relacione tese e argumento', summary: 'Identifique a ideia defendida e a justificativa usada para apoiá-la.', prerequisites: ['lin-inferencia'] },
  ],
  questions: [
    { id: 'operacoes-1', competencyId: 'operacoes', prompt: 'Quanto vale 8 + 3 × 4?', choices: ['44', '20', '32'], correctIndex: 1, explanation: 'A multiplicação vem antes da adição: 3 × 4 = 12; 8 + 12 = 20.' },
    { id: 'operacoes-2', competencyId: 'operacoes', prompt: 'Uma turma divide igualmente 36 cadernos entre 6 estudantes. Quantos cada um recebe?', choices: ['6', '30', '42'], correctIndex: 0, explanation: 'Dividir igualmente significa calcular 36 ÷ 6 = 6 cadernos por estudante.' },
    { id: 'proporcoes-1', competencyId: 'proporcoes', prompt: 'Uma receita usa 2 xícaras de arroz para 4 pessoas. Mantida a proporção, quantas xícaras atendem 10 pessoas?', choices: ['4', '5', '8'], correctIndex: 1, explanation: 'São 2 ÷ 4 = 0,5 xícara por pessoa. Para 10 pessoas, 0,5 × 10 = 5.' },
    { id: 'proporcoes-2', competencyId: 'proporcoes', prompt: 'Em uma caminhada a ritmo constante, alguém percorre 3 km em 30 minutos. Quantos quilômetros percorre em 50 minutos?', choices: ['4', '6', '5'], correctIndex: 2, explanation: 'O ritmo é 3 ÷ 30 = 0,1 km por minuto. Em 50 minutos, são 5 km.' },
    { id: 'porcentagens-1', competencyId: 'porcentagens', prompt: 'Um livro custa R$ 80 e recebe desconto de 25%. Qual é o preço final?', choices: ['R$ 55', 'R$ 60', 'R$ 75'], correctIndex: 1, explanation: '25% de 80 são 20. O preço final é 80 − 20 = R$ 60.' },
    { id: 'porcentagens-2', competencyId: 'porcentagens', prompt: 'Uma turma tem 40 estudantes e 10 utilizam bicicleta. Qual porcentagem utiliza bicicleta?', choices: ['10%', '20%', '25%'], correctIndex: 2, explanation: '10 ÷ 40 = 0,25; multiplicando por 100, obtemos 25%.' },
    { id: 'informacao-1', competencyId: 'informacao', prompt: 'Leia: “A biblioteca abre às 8h de segunda a sexta e às 9h aos sábados.” A que horas ela abre no sábado?', choices: ['8h', '9h', 'Não abre'], correctIndex: 1, explanation: 'O horário de sábado aparece explicitamente no texto: 9h.' },
    { id: 'informacao-2', competencyId: 'informacao', prompt: 'Leia: “As inscrições terminam na sexta-feira. A atividade acontecerá no domingo.” Em que dia terminam as inscrições?', choices: ['Sexta-feira', 'Sábado', 'Domingo'], correctIndex: 0, explanation: 'O texto informa sexta-feira para o fim das inscrições. Domingo é o dia da atividade.' },
    { id: 'inferencia-1', competencyId: 'inferencia', prompt: 'Leia: “Ao sair, Lia viu poças na calçada e guardou os óculos de sol.” Qual inferência é mais apoiada pelas pistas?', choices: ['Lia perdeu seus óculos', 'Pode ter chovido recentemente', 'Toda a cidade está alagada'], correctIndex: 1, explanation: 'As poças apoiam a possibilidade de chuva recente; o texto não sustenta perda dos óculos ou alagamento de toda a cidade.' },
    { id: 'inferencia-2', competencyId: 'inferencia', prompt: 'Leia: “Pedro releu o enunciado, apagou o cálculo e tentou outro caminho.” O que se pode inferir com mais apoio?', choices: ['Pedro desistiu da atividade', 'Pedro já havia acertado tudo', 'Pedro reconsiderou sua estratégia'], correctIndex: 2, explanation: 'Reler, apagar e tentar outro caminho são pistas de revisão da estratégia, sem indicar desistência ou acerto prévio.' },
    { id: 'argumentacao-1', competencyId: 'argumentacao', prompt: 'Leia: “A escola deveria ampliar a biblioteca, pois muitos estudantes precisam de um lugar silencioso para estudar.” Qual é a tese defendida?', choices: ['A escola deveria ampliar a biblioteca', 'Todos estudam apenas em casa', 'A biblioteca já atende a todos'], correctIndex: 0, explanation: 'A ampliação da biblioteca é a proposta defendida; a necessidade de um lugar silencioso é a justificativa.' },
    { id: 'argumentacao-2', competencyId: 'argumentacao', prompt: 'Leia: “Devemos economizar água: o reservatório está com nível baixo.” Qual trecho funciona como argumento?', choices: ['Devemos economizar água', 'O reservatório está com nível baixo', 'Não há argumento no texto'], correctIndex: 1, explanation: 'O nível baixo do reservatório é a razão apresentada para defender a economia de água.' },
  ],
});

export function defaultConfig(catalog: StudyCatalog = DEMO_CATALOG): TrackConfig {
  return {
    name: catalog.title, objective: 'Construir fundamentos para o ENEM', startingYear: 'medio-1',
    subjectIds: catalog.subjects.map((subject) => subject.id), difficulties: catalog.subjects.map((subject) => ({ subjectId: subject.id, level: 'unknown' })),
    examDate: null, weeklyMinutes: 300, intensity: 'balanced', pace: 'gradual', reviewEveryDays: 7, mockEveryWeeks: 4, bindings: [],
  };
}
