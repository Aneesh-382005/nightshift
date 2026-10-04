// Mode detection checks (no DB). Run: npx tsx src/test-modes.ts
import { isMonitorAlert, modeFor, wantsFix, buildPrompt } from './harness.js';
let bad = 0;
const t = (name: string, ok: boolean) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) bad++; };
t('alert is not ask', !modeFor('MOCK ALERT from monitoring on web-1: web-1 is unhealthy, health check failing. Incident #3. Investigate and fix it.').ask);
t('question is ask + read-only', modeFor('Why is web-2 slow? How full is the disk?').readOnly);
t('fix request is ask but not read-only', modeFor('Please restart web-1').ask && !modeFor('Please restart web-1').readOnly);
t('wantsFix word boundaries', !wantsFix('what is the prefix of the log') && wantsFix('can you fix it'));
t('ask prompt has ASK MODE', buildPrompt('how is web-1?', 'linux-server', modeFor('how is web-1?')).includes('ASK MODE'));
t('alert prompt has no ASK MODE', !buildPrompt('MOCK ALERT from monitoring on web-1: x', 'linux-server', modeFor('MOCK ALERT from monitoring on web-1: x')).includes('ASK MODE'));
import { parseSkillFile, searchSkills } from './skills.js';
const sk = parseSkillFile('---\nslug: restart-web\ntitle: Restart a down web service\ncategory: service\ntags: [service, down, 503]\nrunbook: restart-web\nrisk: low\n---\n# Restart the web service\nSteps...\n');
t('skill parses', sk?.slug === 'restart-web' && sk.summary === 'Restart the web service' && sk.tags === 'service,down,503' && sk.risk === 'low');
t('bad frontmatter skipped', parseSkillFile('no frontmatter') === undefined && parseSkillFile('---\ntitle: x\n---\nbody') === undefined && parseSkillFile('---\nslug: Bad Slug\ntitle: x\n---\n') === undefined);
const rows = [
  { slug: 'restart-web', title: 'Restart a down web service', tags: 'service,down,503', summary: 'Restart the web service', risk: 'low', runbook: 'restart-web' },
  { slug: 'rotate-logs', title: 'Rotate full logs', tags: 'disk,logs,full', summary: 'Move log files aside', risk: 'low', runbook: 'rotate-logs' },
  { slug: 'restore-config', title: 'Restore config', tags: 'config,500', summary: 'Copy the known-good config', risk: 'low', runbook: 'restore-config' },
];
t('search finds disk skill', searchSkills(rows, 'disk is full, logs growing')[0]?.slug === 'rotate-logs');
t('search finds service skill', searchSkills(rows, 'web service down')[0]?.slug === 'restart-web');
t('search returns nothing for noise', searchSkills(rows, 'xyzzy').length === 0);
t('search caps at 3', searchSkills(rows, 'service disk config logs web restart').length <= 3);
process.exit(bad ? 1 : 0);
