import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';
import { readBackupArchive } from '../../src/services/backup-archive';

const monday = new Date('2026-10-19T10:00:00-03:00');
async function openPlanner(page: Page) { await page.getByRole('button',{name:'Planner',exact:true}).click(); await expect(page.getByRole('heading',{name:'Planner semanal.'})).toBeVisible(); }
async function prepare(page: Page) {
  await page.clock.install({time:monday});await page.goto('/');
  await page.getByRole('button',{name:/^Trilhas(?:\s*\d+)?$/}).click();
  await page.getByRole('button',{name:'Configurar minha trilha'}).click();
  await page.getByLabel('Nome da trilha',{exact:true}).fill('Semana possível');
  await page.getByRole('button',{name:'Salvar trilha',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);await openPlanner(page);
}

test('prévia, aceite, replanejamento com histórico, desfazer, Hoje e restauração v5',async({page,browser,baseURL},info)=>{
  test.setTimeout(90_000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await prepare(page);
  await page.getByRole('button',{name:'Gerar prévia semanal',exact:true}).click();
  await expect(page.getByRole('region',{name:'Prévia da semana'})).toBeVisible();
  await page.getByRole('button',{name:'Cancelar prévia',exact:true}).click();
  await page.reload();await openPlanner(page);
  await expect(page.getByRole('region',{name:'Semana aceita',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Gerar prévia semanal',exact:true}).click();
  await page.getByRole('button',{name:'Aceitar semana',exact:true}).click();
  const agenda=page.getByRole('region',{name:'Semana aceita',exact:true});
  await expect(agenda.locator('.planner-block')).not.toHaveCount(0);
  const originalCount=await agenda.locator('.planner-block').count();
  await agenda.getByRole('button',{name:/^Concluir /}).first().click();
  await agenda.getByRole('button',{name:/^Fixar bloco/}).first().click();
  const pinned=agenda.locator('.planner-block').filter({has:page.getByRole('button',{name:/^Desfixar bloco/})});
  const pinnedText=(await pinned.textContent()) ?? '';
  await expect(page.getByRole('button',{name:'Desfazer última proposta',exact:true})).toHaveCount(0);
  const settings=page.getByRole('button',{name:'Disponibilidade e durações',exact:true});
  if(await settings.getAttribute('aria-expanded')==='false')await settings.click();
  await page.getByLabel('Minutos disponíveis em Segunda',{exact:true}).fill('30');
  await page.getByRole('button',{name:'Replanejar pendências',exact:true}).click();
  await expect(page.getByRole('button',{name:'Aceitar semana',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Cancelar prévia',exact:true}).click();
  await page.getByLabel('Minutos disponíveis em Segunda',{exact:true}).fill('90');
  await page.clock.setSystemTime(new Date('2026-10-26T10:00:00-03:00'));await page.reload();await openPlanner(page);
  await page.getByRole('button',{name:'Gerar prévia semanal',exact:true}).click();
  await expect(page.getByRole('region',{name:'Prévia da semana'}).locator('p').first()).toContainText(/^[1-9]\d* pendências? realocad/);
  await page.getByRole('button',{name:'Aceitar semana',exact:true}).click();
  await page.getByLabel('Semana iniciada em').fill('2026-10-19');
  await expect(agenda.locator('.planner-block.completed')).toHaveCount(1);
  await expect(agenda.locator('.planner-block').filter({has:page.getByRole('button',{name:/^Desfixar bloco/})})).toHaveText(pinnedText);
  await page.getByRole('button',{name:'Desfazer última proposta',exact:true}).click();
  await expect(agenda.locator('.planner-block')).toHaveCount(originalCount);
  await page.getByRole('button',{name:'Biblioteca',exact:true}).click();
  const today=page.getByRole('region',{name:'Hoje.'});
  await expect(today).toContainText('sem horário');
  await today.getByRole('button',{name:/^Concluir atividade/}).first().click();
  await expect(today).toContainText('1 atividade concluída');
  await openPlanner(page);await page.getByLabel('Semana iniciada em').fill('2026-10-19');
  const axe=await new AxeBuilder({page}).include('.planner-page').withTags(['wcag2a','wcag2aa']).analyze();expect(axe.violations).toEqual([]);
  await page.screenshot({path:info.outputPath('planner-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Dados e backup',exact:true}).click();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Exportar backup',exact:true}).click()]);
  const path=(await download.path())!;const bytes=await readFile(path);const archive=await readBackupArchive(new Blob([bytes]));
  expect(archive.manifest.version).toBe(5);expect(archive.manifest.data.studyPlanners).toHaveLength(1);
  expect(archive.manifest.data.studyPlanners![0].weeks.flatMap(w=>w.blocks).filter(b=>b.status==='completed')).toHaveLength(2);
  const destination=await browser.newContext();
  try{const restored=await destination.newPage();await restored.clock.install({time:monday});await restored.goto(baseURL!);
    await restored.getByRole('button',{name:'Dados e backup',exact:true}).click();await restored.getByLabel('Arquivo de backup',{exact:true}).setInputFiles(path);
    await expect(restored.getByRole('dialog')).toHaveCount(0);await openPlanner(restored);
    await expect(restored.getByRole('region',{name:'Semana aceita',exact:true}).locator('.planner-block')).toHaveCount(originalCount);
    await expect(restored.locator('.planner-backlog')).toContainText('Pendentes sem horário');
  }finally{await destination.close();}
  expect(errors).toEqual([]);
});

test('planner móvel por teclado, edição e conclusão sem rede após carregar',async({page,context},info)=>{
  await page.setViewportSize({width:390,height:844});await prepare(page);
  await page.getByLabel('Minutos disponíveis em Segunda',{exact:true}).focus();await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox',{name:'Terça',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Gerar prévia semanal',exact:true}).click();await page.getByRole('button',{name:'Aceitar semana',exact:true}).click();
  await context.setOffline(true);await page.getByRole('region',{name:'Semana aceita',exact:true}).getByRole('button',{name:/^Concluir /}).first().click();
  await expect(page.locator('.planner-block.completed')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('planner-mobile.png'),fullPage:true});
  await context.setOffline(false);await page.reload();await openPlanner(page);
  await expect(page.locator('.planner-block.completed')).toHaveCount(1);
});
