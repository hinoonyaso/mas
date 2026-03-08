/**
 * artifactValidator.js — 모드별 HTML 구조 규칙 검증 (순수 함수)
 * website 전용 검증 규칙 추가 시 이 파일만 수정.
 */

function dedupeViolations(violations) {
    const seen = new Set();
    return violations.filter((violation) => {
        const key = `${violation.code}:${violation.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function validateArtifact(outputMode, output, artifactContract = null) {
    const text = String(output || '');
    const violations = [];
    const requiredElements = artifactContract?.requiredElements || [];
    const forbiddenPatterns = artifactContract?.forbiddenPatterns || [];
    const renderRequirements = artifactContract?.renderRequirements || [];

    if (!text.trim()) {
        violations.push({ code: 'EMPTY_OUTPUT', message: 'Artifact output is empty.' });
        return violations;
    }

    if (outputMode === 'website') {
        if (!/(?:<!doctype html>|<html\b)/i.test(text)) {
            violations.push({ code: 'NON_RENDERABLE', message: 'Website artifact must contain a full HTML document root.' });
        }
        if (!/<style\b/i.test(text)) {
            violations.push({ code: 'MISSING_STYLE_TAG', message: 'Website artifact must inline CSS in a <style> tag.' });
        }
        if (!/<script\b/i.test(text)) {
            violations.push({ code: 'MISSING_SCRIPT_TAG', message: 'Website artifact must inline JS in a <script> tag when interactive behavior is needed.' });
        }
        if (/<link\b[^>]*rel=["']stylesheet["']/i.test(text)) {
            violations.push({ code: 'EXTERNAL_REF_VIOLATION', message: 'External stylesheet links are forbidden for website preview artifacts.' });
        }
        if (/<script\b[^>]*src=/i.test(text)) {
            violations.push({ code: 'EXTERNAL_SCRIPT_VIOLATION', message: 'External script src references are forbidden for website preview artifacts.' });
        }
        if (/(로그인|login|signin|auth|인증)/i.test(text + ' ' + JSON.stringify(requiredElements)) && !/<form\b/i.test(text)) {
            violations.push({ code: 'STRUCTURE_MISSING', message: 'Login/auth pages must contain a form element.' });
        }
    } else if (outputMode === 'docx' || outputMode === 'deep_research') {
        if (!/(?:<!doctype html>|<html\b)/i.test(text)) {
            violations.push({ code: 'NON_RENDERABLE', message: 'Document artifact must contain a full HTML document root.' });
        }
        const headingCount = (text.match(/<h[1-3]\b/gi) || []).length;
        if (headingCount < 2) {
            violations.push({ code: 'STRUCTURE_MISSING', message: 'Document artifact must include at least two heading sections.' });
        }
        const paragraphCount = (text.match(/<p\b/gi) || []).length;
        if (paragraphCount < 3) {
            violations.push({ code: 'CONTENT_TOO_THIN', message: 'Document artifact must contain multiple content paragraphs.' });
        }
    } else if (outputMode === 'sheet') {
        if (!/(?:<!doctype html>|<html\b)/i.test(text)) {
            violations.push({ code: 'NON_RENDERABLE', message: 'Sheet artifact must contain a full HTML document root.' });
        }
        if (!/<table\b/i.test(text)) {
            violations.push({ code: 'STRUCTURE_MISSING', message: 'Sheet artifact must contain a table.' });
        }
        const headerCount = (text.match(/<th\b/gi) || []).length;
        if (headerCount < 2) {
            violations.push({ code: 'HEADER_MISSING', message: 'Sheet artifact must contain at least two table headers.' });
        }
        const rowCount = (text.match(/<tr\b/gi) || []).length;
        if (rowCount < 3) {
            violations.push({ code: 'DATA_REGION_EMPTY', message: 'Sheet artifact must contain header and data rows.' });
        }
    } else if (outputMode === 'slide') {
        if (!/(?:<!doctype html>|<html\b)/i.test(text)) {
            violations.push({ code: 'NON_RENDERABLE', message: 'Slide artifact must contain a full HTML document root.' });
        }
        const slideCount = (text.match(/class=["'][^"']*\bslide\b[^"']*["']/gi) || []).length;
        if (slideCount < 3) {
            violations.push({ code: 'SLIDE_COUNT_TOO_LOW', message: 'Slide artifact must contain at least three slides.' });
        }
        if (!/<h1\b/i.test(text)) {
            violations.push({ code: 'TITLE_SLIDE_MISSING', message: 'Slide artifact must contain a title slide heading.' });
        }
        const longTextBlocks = (text.match(/>[^<]{240,}</g) || []).length;
        if (longTextBlocks > 2) {
            violations.push({ code: 'TEXT_DENSITY_TOO_HIGH', message: 'Slide artifact contains overly dense text blocks.' });
        }
    }

    for (const requirement of requiredElements) {
        if (!text.toLowerCase().includes(String(requirement).toLowerCase())) {
            violations.push({ code: 'REQUIRED_ELEMENT_MISSING', message: `Required element missing from artifact: ${requirement}` });
        }
    }

    for (const forbidden of forbiddenPatterns) {
        if (/external css link/i.test(forbidden) && /<link\b[^>]*rel=["']stylesheet["']/i.test(text)) {
            violations.push({ code: 'FORBIDDEN_PATTERN', message: 'Forbidden pattern detected: external css link.' });
        }
        if (/external script src/i.test(forbidden) && /<script\b[^>]*src=/i.test(text)) {
            violations.push({ code: 'FORBIDDEN_PATTERN', message: 'Forbidden pattern detected: external script src.' });
        }
    }

    if (renderRequirements.some((r) => /body must not be empty/i.test(String(r))) && /<body[^>]*>\s*<\/body>/i.test(text)) {
        violations.push({ code: 'EMPTY_BODY', message: 'Render requirement violated: body must not be empty.' });
    }

    return dedupeViolations(violations);
}
