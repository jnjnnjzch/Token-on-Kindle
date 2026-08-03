import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { codexQuotaLayout } from '../web/kindle-renderer.js';
import { parseVolcengineQuotaText } from '../shared/volcengine-text-parser.mjs';

test('Volcengine text fallback parses the saved Agent Plan values', () => {
  assert.deepEqual(
    parseVolcengineQuotaText(
      '近5小时用量 4小时42分钟后重置 325.222 /4,000 已使用 8.1%',
      { label: '近5小时用量', id: '5h' }
    ),
    {
      id: '5h',
      label: '近5小时',
      used: 325.222,
      total: 4000,
      usedPercent: 8.1,
      remainingPercent: 91.9,
      resetText: '4小时42分钟后重置'
    }
  );
  assert.equal(
    parseVolcengineQuotaText(
      '近一周用量 6天5小时58分钟后重置 325.222 /1.4万 已使用 2.3%',
      { label: '近一周用量', id: 'weekly' }
    )?.total,
    14000
  );
  assert.equal(
    parseVolcengineQuotaText(
      '近一月用量 11天5小时58分钟后重置 325.222 /4万 已使用 0.8%',
      { label: '近一月用量', id: 'monthly' }
    )?.total,
    40000
  );
});

test('Volcengine collector opens the usage tab and keeps retrying', () => {
  const extractor = fs.readFileSync(new URL('../web/extractor.js', import.meta.url), 'utf8');
  assert.match(extractor, /function activateVolcengineUsageTab/);
  assert.match(extractor, /compactText\(element\.textContent\) === '用量统计'/);
  assert.match(extractor, /setInterval\(\(\) => \{[\s\S]*activateVolcengineUsageTab\(\);[\s\S]*collect\(\);[\s\S]*15 \* 1000/);
  assert.doesNotMatch(extractor, /let boardSeen = false/);
});

test('Codex uses one full-width column when the 5h quota is absent', () => {
  const weeklyOnly = codexQuotaLayout({
    quotas: [{ id: 'weekly', remainingPercent: 72, resetText: '6天后' }]
  });
  assert.equal(weeklyOnly.columns, 1);
  assert.equal(weeklyOnly.entries.length, 1);
  assert.equal(weeklyOnly.entries[0][0].id, 'weekly');

  const both = codexQuotaLayout({
    quotas: [
      { id: 'weekly', remainingPercent: 72 },
      { id: '5h', remainingPercent: 88 }
    ]
  });
  assert.equal(both.columns, 2);
  assert.equal(both.entries.length, 2);
});
