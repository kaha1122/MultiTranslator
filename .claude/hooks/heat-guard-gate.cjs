#!/usr/bin/env node
// heat-guard-gate.js — CLAUDE.md 절대규칙 6(iOS 발열 검토 의무) 강제 게이트.
// PreToolUse(Bash) 훅: git commit 명령을 가로채 .claude/.heat-guard-pass 플래그가
// 없으면 차단한다. 플래그는 ios-heat-guard 에이전트 "HEAT-GUARD: PASS" 판정 후
// 생성하며, commit 1회에 1번 소모된다(다음 commit은 재점검 필요).
'use strict';
const fs = require('fs');
const path = require('path');

let raw = '';
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
    let cmd = '';
    try { cmd = JSON.parse(raw)?.tool_input?.command || ''; } catch { /* stdin이 JSON이 아니면 통과 */ }

    // "git commit" 형태만 게이트 (git -C <dir> commit 포함, git log|grep commit 등 오탐 제외)
    const isCommit = /(^|&&|;|\|)\s*git\s+(-\S+\s+)*commit\b/.test(cmd);
    if (!isCommit) process.exit(0);

    const flag = path.join(__dirname, '..', '.heat-guard-pass');
    const FRESH_MS = 30 * 60 * 1000; // 30분 내 점검만 유효
    try {
        const fresh = (Date.now() - fs.statSync(flag).mtimeMs) < FRESH_MS;
        fs.unlinkSync(flag); // 1회용 소모 (오래된 플래그도 폐기)
        if (fresh) process.exit(0);
    } catch { /* 플래그 없음 → 차단 */ }

    process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
                '🔥 iOS 발열 점검 미수행 — CLAUDE.md 절대규칙 6. ' +
                'ios-heat-guard 에이전트(Agent tool, subagent_type: ios-heat-guard)로 staged diff를 점검하고, ' +
                '"HEAT-GUARD: PASS" 확인 후 .claude/.heat-guard-pass 파일을 생성(touch)한 뒤 다시 commit하세요. ' +
                '플래그는 commit 1회당 1번 소모됩니다.',
        },
    }));
    process.exit(0);
});
