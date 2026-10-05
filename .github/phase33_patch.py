from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"anchor not found in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"anchor not unique in {path}: {text.count(old)} matches")
    p.write_text(text.replace(old, new, 1))


replace_once(
    'server/growthDashboard.ts',
    'import { buildGrowthAutomationSnapshot } from "./growthAutomation";\n',
    'import { buildGrowthAutomationSnapshot } from "./growthAutomation";\nimport { buildSourceIntelligence } from "./sourceIntelligence";\n'
)
replace_once(
    'server/growthDashboard.ts',
    '    marketplaceIntelligenceState,\n    growthAutomationState,\n  ] = await Promise.all([',
    '    marketplaceIntelligenceState,\n    growthAutomationState,\n    sourceIntelligenceState,\n  ] = await Promise.all(['
)
replace_once(
    'server/growthDashboard.ts',
    '    buildMarketplaceHealth(),\n    buildGrowthAutomationSnapshot(),\n  ]);',
    '    buildMarketplaceHealth(),\n    buildGrowthAutomationSnapshot(),\n    buildSourceIntelligence(),\n  ]);'
)
replace_once(
    'server/growthDashboard.ts',
    '    marketplaceIntelligence: marketplaceIntelligenceState,\n    growthAutomation: growthAutomationState,\n  };',
    '    marketplaceIntelligence: marketplaceIntelligenceState,\n    growthAutomation: growthAutomationState,\n    sourceIntelligence: sourceIntelligenceState,\n  };'
)

section = '''    <div class="section" id="phase33SourceIntelligence">
      <div class="section-head"><h2>Phase 33 — Production Intelligence &amp; Source ROI</h2><span class="muted">Phase 32 source learning + live category × region × year coverage</span></div>
      <div class="grid" id="sourceIntelligenceCards"></div>
      <div class="grid" style="margin-top:12px">
        <div class="card span-6">
          <h3>Highest-yield official sources</h3>
          <div style="overflow:auto;margin-top:8px"><table><thead><tr><th>Domain</th><th>State</th><th class="num">Score</th><th class="num">Rich</th><th class="num">Accepted</th><th class="num">Rich yield</th><th class="num">No-gain</th></tr></thead><tbody id="sourceTopTable"></tbody></table></div>
        </div>
        <div class="card span-6">
          <h3>Weak / cooldown sources</h3>
          <div style="overflow:auto;margin-top:8px"><table><thead><tr><th>Domain</th><th>State</th><th class="num">No-gain</th><th class="num">Failures</th><th class="num">Score</th><th>Last failure</th></tr></thead><tbody id="sourceWeakTable"></tbody></table></div>
        </div>
        <div class="card span-12">
          <h3>Highest-priority catalogue gaps</h3>
          <div style="overflow:auto;margin-top:8px"><table><thead><tr><th>Category</th><th>Region</th><th class="num">Year</th><th class="num">Accepted</th><th class="num">Publish-ready</th><th class="num">Rich / target</th><th class="num">Priority</th></tr></thead><tbody id="sourceGapTable"></tbody></table></div>
        </div>
        <div class="card span-12">
          <h3>Next automation budget</h3>
          <div class="small">Recommended share of the next automated discovery/enrichment cycle. This is workload allocation, not monetary spend.</div>
          <div style="overflow:auto;margin-top:8px"><table><thead><tr><th class="num">#</th><th>Focus</th><th>Action</th><th class="num">Share</th><th>Why</th></tr></thead><tbody id="sourceBudgetTable"></tbody></table></div>
        </div>
        <div class="card span-12">
          <h3>Recent source-learning runs</h3>
          <div style="overflow:auto;margin-top:8px"><table><thead><tr><th>Started</th><th>Status</th><th class="num">Selected</th><th class="num">Gained</th><th class="num">No gain</th><th class="num">Δ accepted</th><th class="num">Δ ready</th><th class="num">Δ rich</th><th class="num">Δ covered cells</th></tr></thead><tbody id="sourceRunsTable"></tbody></table></div>
        </div>
      </div>
    </div>

'''
replace_once(
    'public/growth.html',
    '    <div class="section">\n      <div class="section-head"><h2>Sponsorship Marketplace</h2><span class="muted">Financial currencies remain separate</span></div>',
    section + '    <div class="section">\n      <div class="section-head"><h2>Sponsorship Marketplace</h2><span class="muted">Financial currencies remain separate</span></div>'
)

render = '''
    const si = data.sourceIntelligence || {};
    const sis = si.summary || {};
    const cov = si.coverage || {};
    const latest = si.latestRun || null;
    $('sourceIntelligenceCards').innerHTML = [
      `<div class="card span-3"><h3>Learned official sources</h3><div class="metric">${fmt(sis.learnedSources)}</div><div class="small">${fmt(sis.trusted)} trusted · ${fmt(sis.productive)} productive · ${fmt(sis.learning)} learning</div></div>`,
      `<div class="card span-3"><h3>Cooldown / no-gain</h3><div class="metric">${fmt(sis.cooldown)}</div><div class="small">${fmt(sis.sourcesWithNoGainStreak)} sources currently carry a no-gain streak</div></div>`,
      `<div class="card span-3"><h3>Rich published</h3><div class="metric">${fmt(cov.richPublished)}</div><div class="small">${fmt(cov.publishReady)} publish-ready · ${fmt(cov.accepted)} accepted</div></div>`,
      `<div class="card span-3"><h3>Coverage cells</h3><div class="metric">${pct(cov.coveragePct)}</div><div class="small">${fmt(cov.coveredCells)} of ${fmt(cov.cells)} category × region × year cells covered</div><div class="bar"><span style="width:${Math.min(100,Number(cov.coveragePct||0))}%"></span></div></div>`,
      `<div class="card span-6"><h3>Learning status</h3><div class="metric" style="font-size:18px">${esc(si.learningStatus || 'unknown').replaceAll('_',' ')}</div><div class="small">${esc(si.message || '')}</div></div>`,
      `<div class="card span-6"><h3>Latest learning run</h3><div class="metric" style="font-size:18px">${latest ? esc(latest.status).replaceAll('_',' ') : 'Waiting for first run'}</div><div class="small">${latest ? `${fmt(latest.gainedCount)} gained · ${fmt(latest.noGainCount)} no gain · Δ rich ${fmt(latest.delta?.richPublished)}` : 'Phase 33 is live; source-run evidence will populate after the next authoritative Phase 32 cycle.'}</div></div>`,
    ].join('');

    $('sourceTopTable').innerHTML = si.topSources?.length
      ? si.topSources.map((row) => `<tr><td><b>${esc(row.domain)}</b><br><span class="small">${esc((row.categories||[]).slice(0,3).join(' · ') || 'official source')}</span></td><td>${esc(row.state)}</td><td class="num">${fmt(row.score)}</td><td class="num">${fmt(row.rich)}</td><td class="num">${fmt(row.accepted)}</td><td class="num">${pct(row.richYieldPct)}</td><td class="num">${fmt(row.consecutiveNoGain)}</td></tr>`).join('')
      : emptyRow(7, 'Source performance will populate after the first Phase 32 learning cycle');
    $('sourceWeakTable').innerHTML = si.weakSources?.length
      ? si.weakSources.map((row) => `<tr><td><b>${esc(row.domain)}</b></td><td>${esc(row.state)}</td><td class="num">${fmt(row.consecutiveNoGain)}</td><td class="num">${fmt(row.failures)}</td><td class="num">${fmt(row.score)}</td><td>${esc(row.lastFailureReason || '—')}</td></tr>`).join('')
      : emptyRow(6, 'No weak or cooldown sources recorded');
    $('sourceGapTable').innerHTML = cov.topGaps?.length
      ? cov.topGaps.slice(0,15).map((row) => `<tr><td><b>${esc(row.category)}</b></td><td>${esc(row.region)}</td><td class="num">${fmt(row.year)}</td><td class="num">${fmt(row.accepted)}</td><td class="num">${fmt(row.publishReady)}</td><td class="num">${fmt(row.richPublished)} / ${fmt(row.targetRich)}</td><td class="num">${fmt(row.priority)}</td></tr>`).join('')
      : emptyRow(7, cov.available === false ? 'Coverage intelligence temporarily unavailable' : 'No uncovered cells');
    $('sourceBudgetTable').innerHTML = cov.nextAutomationBudget?.length
      ? cov.nextAutomationBudget.map((row) => `<tr><td class="num">${fmt(row.rank)}</td><td><b>${esc(row.category)}</b><br><span class="small">${esc(row.region)} · ${fmt(row.year)}</span></td><td><span class="badge ${row.action==='publish_and_deepen'?'ok':row.action==='discover_new'?'warn':'ok'}">${esc(row.label)}</span></td><td class="num"><b>${fmt(row.automationSharePct)}%</b></td><td>${esc(row.rationale)}</td></tr>`).join('')
      : emptyRow(5, 'No automation allocation recommendation available');
    $('sourceRunsTable').innerHTML = si.recentRuns?.length
      ? si.recentRuns.map((row) => `<tr><td>${row.startedAt ? esc(new Date(row.startedAt).toLocaleString()) : '—'}</td><td>${esc(row.status)}</td><td class="num">${fmt(row.selectedCount)}</td><td class="num">${fmt(row.gainedCount)}</td><td class="num">${fmt(row.noGainCount)}</td><td class="num">${fmt(row.delta?.accepted)}</td><td class="num">${fmt(row.delta?.publishReady)}</td><td class="num">${fmt(row.delta?.richPublished)}</td><td class="num">${fmt(row.delta?.coveredCells)}</td></tr>`).join('')
      : emptyRow(9, 'No completed Phase 32 source-learning run recorded yet');

'''
replace_once(
    'public/growth.html',
    '    const market = data.marketplace || {};\n',
    render + '    const market = data.marketplace || {};\n'
)

replace_once(
    'scripts/smokeGrowthDashboard.mjs',
    "  if (!pageResponse.ok || !pageHtml.includes('Growth Operations') || !pageHtml.includes('/api/admin/discovery/growth-dashboard')) {",
    "  if (!pageResponse.ok || !pageHtml.includes('Growth Operations') || !pageHtml.includes('/api/admin/discovery/growth-dashboard') || !pageHtml.includes('Phase 33 — Production Intelligence')) {"
)
replace_once(
    'scripts/smokeGrowthDashboard.mjs',
    "  if (!dashboard || dashboard.deployment?.database !== 'ready') {\n    throw new Error('Dashboard deployment readiness is missing: ' + JSON.stringify(dashboard?.deployment));\n  }",
    "  if (!dashboard || dashboard.deployment?.database !== 'ready') {\n    throw new Error('Dashboard deployment readiness is missing: ' + JSON.stringify(dashboard?.deployment));\n  }\n  if (!dashboard.sourceIntelligence || dashboard.sourceIntelligence.phase !== 33) {\n    throw new Error('Phase 33 source intelligence is missing: ' + JSON.stringify(dashboard.sourceIntelligence));\n  }\n  if (!dashboard.sourceIntelligence.coverage || !Array.isArray(dashboard.sourceIntelligence.coverage.nextAutomationBudget)) {\n    throw new Error('Phase 33 coverage/budget intelligence is missing: ' + JSON.stringify(dashboard.sourceIntelligence.coverage));\n  }\n  if (dashboard.sourceIntelligence.available !== false || dashboard.sourceIntelligence.learningStatus !== 'awaiting_first_phase32_run') {\n    throw new Error('Fresh database should expose a safe Phase 32 waiting state: ' + JSON.stringify(dashboard.sourceIntelligence));\n  }"
)
