/**
 * artifactContract.js — 출력 모드별 기본 artifact contract 및 spec과 병합
 * 새 출력 모드 계약 추가 시 이 파일만 수정.
 */

import { extractPlanJson } from './intentRouter.js';

export function getDefaultArtifactContract(outputMode, userInput) {
    if (outputMode === 'website') {
        const isLogin = /login|signin|signup|auth|로그인|인증|회원가입/i.test(String(userInput || ''));
        return {
            type: 'single self-contained HTML document',
            requiredElements: isLogin ? ['<form', 'button', 'input'] : ['<main', '<style'],
            forbiddenPatterns: ['external css link', 'external script src'],
            renderRequirements: ['renderable in a single iframe', 'body must not be empty'],
            assetPolicy: 'reuse existing asset first, generated asset second, deterministic fallback last',
            reusePolicy: 'reuse existing implementation when present',
            repairStrategy: 'patch existing artifact before full regeneration',
        };
    }

    if (outputMode === 'docx' || outputMode === 'deep_research') {
        return {
            type: 'self-contained document HTML',
            requiredElements: ['<h1', '<p'],
            forbiddenPatterns: [],
            renderRequirements: ['renderable in a single iframe', 'body must not be empty'],
            assetPolicy: 'mode default',
            reusePolicy: 'reuse existing implementation when present',
            repairStrategy: 'patch existing artifact before full regeneration',
        };
    }

    if (outputMode === 'sheet') {
        return {
            type: 'self-contained spreadsheet HTML',
            requiredElements: ['<table', '<th'],
            forbiddenPatterns: [],
            renderRequirements: ['renderable in a single iframe', 'body must not be empty'],
            assetPolicy: 'mode default',
            reusePolicy: 'reuse existing implementation when present',
            repairStrategy: 'patch existing artifact before full regeneration',
        };
    }

    if (outputMode === 'slide') {
        return {
            type: 'self-contained slide deck HTML',
            requiredElements: ['class="slide"', '<h1'],
            forbiddenPatterns: [],
            renderRequirements: ['renderable in a single iframe', 'body must not be empty'],
            assetPolicy: 'reuse existing asset first, generated asset second, deterministic fallback last',
            reusePolicy: 'reuse existing implementation when present',
            repairStrategy: 'patch existing artifact before full regeneration',
        };
    }

    return {
        type: 'self-contained artifact',
        requiredElements: [],
        forbiddenPatterns: [],
        renderRequirements: [],
        assetPolicy: 'mode default',
        reusePolicy: 'reuse existing implementation when present',
        repairStrategy: 'patch existing artifact before full regeneration',
    };
}

export function resolveArtifactContract(planOutput, outputMode, userInput) {
    const defaults = getDefaultArtifactContract(outputMode, userInput);
    const parsed = extractPlanJson(planOutput);
    const contract = parsed?.finalArtifactContract || {};
    return {
        ...defaults,
        ...contract,
        requiredElements: contract.requiredElements || defaults.requiredElements,
        forbiddenPatterns: contract.forbiddenPatterns || defaults.forbiddenPatterns,
        renderRequirements: contract.renderRequirements || defaults.renderRequirements,
    };
}
