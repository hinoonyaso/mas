import fs from 'fs';
import path from 'path';
import config from '../config.js';

export default class MemoryStore {
    constructor() {
        this.shortTerm = new Map(); // 현재 세션 메모리
        this.memoryDir = config.context.memoryDir;
        this._ensureDir();
    }

    _ensureDir() {
        if (!fs.existsSync(this.memoryDir)) {
            fs.mkdirSync(this.memoryDir, { recursive: true });
        }
    }

    // 단기 메모리 (세션 내)
    setShortTerm(key, value) {
        this.shortTerm.set(key, {
            value,
            timestamp: Date.now(),
        });
    }

    getShortTerm(key) {
        const entry = this.shortTerm.get(key);
        return entry ? entry.value : null;
    }

    getAllShortTerm() {
        const result = {};
        for (const [key, entry] of this.shortTerm) {
            result[key] = entry.value;
        }
        return result;
    }

    clearShortTerm() {
        this.shortTerm.clear();
    }

    // 장기 메모리 (파일 기반)
    saveLongTerm(runId, data) {
        const filePath = path.join(this.memoryDir, `${runId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }

    loadLongTerm(runId) {
        const filePath = path.join(this.memoryDir, `${runId}.json`);
        if (!fs.existsSync(filePath)) return null;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }

    // 최근 실행 이력 조회
    getRecentRuns(limit = 10) {
        if (!fs.existsSync(this.memoryDir)) return [];

        const files = fs.readdirSync(this.memoryDir)
            .filter((f) => f.endsWith('.json') && !f.startsWith('_policy'))
            .map((f) => {
                const filePath = path.join(this.memoryDir, f);
                const stat = fs.statSync(filePath);
                return { file: f, mtime: stat.mtimeMs };
            })
            .sort((a, b) => b.mtime - a.mtime)
            .slice(0, limit);

        return files.map((f) => {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(this.memoryDir, f.file), 'utf-8'));
                return { id: f.file.replace('.json', ''), ...data };
            } catch {
                return null;
            }
        }).filter(Boolean);
    }

    // ── 적응형 정책 (Adaptive Policy) ──

    _getPolicyFilePath() {
        return path.join(this.memoryDir, '_policy_adaptive.json');
    }

    _loadPolicy() {
        const filePath = this._getPolicyFilePath();
        if (!fs.existsSync(filePath)) {
            return {
                failurePatterns: {},
                providerSuccessRate: {},
                repairHints: {},
                modePerformance: {},
            };
        }
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        } catch {
            return { failurePatterns: {}, providerSuccessRate: {}, repairHints: {}, modePerformance: {} };
        }
    }

    _savePolicy(policy) {
        const filePath = this._getPolicyFilePath();
        fs.writeFileSync(filePath, JSON.stringify(policy, null, 2));
    }

    /**
     * 실행 결과로부터 적응형 정책 업데이트
     */
    recordRunOutcome({ outputMode, steps, evaluation, providerMap }) {
        const policy = this._loadPolicy();

        // 1. 모드별 성능 기록
        if (!policy.modePerformance[outputMode]) {
            policy.modePerformance[outputMode] = { runs: 0, avgScore: 0, repairRate: 0, failRate: 0 };
        }
        const modePerf = policy.modePerformance[outputMode];
        modePerf.runs += 1;
        const score = evaluation?.quality?.score || 0;
        modePerf.avgScore = ((modePerf.avgScore * (modePerf.runs - 1)) + score) / modePerf.runs;

        // 2. 실패 패턴 집계
        const failures = steps.filter((s) => !s.success || s.agent === 'rule_gate');
        for (const step of failures) {
            const key = `${outputMode}:${step.agent}`;
            if (!policy.failurePatterns[key]) {
                policy.failurePatterns[key] = { count: 0, lastViolations: [] };
            }
            policy.failurePatterns[key].count += 1;
            if (step.violations) {
                policy.failurePatterns[key].lastViolations = step.violations.map((v) => v.code).slice(0, 5);
            }
        }

        // 3. Repair 효과 기록
        const repairAudits = steps.filter((s) => s.agent === 'repair_audit');
        for (const audit of repairAudits) {
            const key = `${outputMode}:${audit.metrics?.phase || 'unknown'}`;
            if (!policy.repairHints[key]) {
                policy.repairHints[key] = { attempts: 0, avgPreservedRatio: 0 };
            }
            const hint = policy.repairHints[key];
            hint.attempts += 1;
            const preserved = audit.metrics?.preservedLineRatio || 0;
            hint.avgPreservedRatio = ((hint.avgPreservedRatio * (hint.attempts - 1)) + preserved) / hint.attempts;
        }

        // 4. Provider 성공률 기록
        if (providerMap) {
            for (const [agent, provider] of Object.entries(providerMap)) {
                const key = `${outputMode}:${agent}:${provider}`;
                if (!policy.providerSuccessRate[key]) {
                    policy.providerSuccessRate[key] = { successes: 0, total: 0 };
                }
                const step = steps.find((s) => s.agent === agent);
                policy.providerSuccessRate[key].total += 1;
                if (step?.success) policy.providerSuccessRate[key].successes += 1;
            }
        }

        this._savePolicy(policy);
    }

    /**
     * 적응형 정책 힌트 조회 (에이전트에게 전달용)
     */
    getAdaptivePolicyHints(outputMode) {
        const policy = this._loadPolicy();
        const hints = [];
        const MAX_HINTS = 3;

        // 모드별 성능 힌트 (최소 5회 이상 실행 시에만)
        const modePerf = policy.modePerformance[outputMode];
        if (modePerf && modePerf.runs >= 5) {
            if (modePerf.avgScore < 7.0) {
                hints.push(`Warning: ${outputMode} mode has low avg score (${modePerf.avgScore.toFixed(1)}/10 over ${modePerf.runs} runs). Extra care needed.`);
            }
        }

        // 자주 실패하는 패턴 힌트 (3회 이상만)
        for (const [key, data] of Object.entries(policy.failurePatterns)) {
            if (hints.length >= MAX_HINTS) break;
            if (key.startsWith(`${outputMode}:`) && data.count >= 3) {
                const agent = key.split(':')[1];
                hints.push(`Frequent failure: ${agent} has failed ${data.count} times in ${outputMode} mode. Last violations: ${data.lastViolations.join(', ') || 'N/A'}.`);
            }
        }

        // Repair 힌트 (3회 이상 + preserved < 50%)
        for (const [key, data] of Object.entries(policy.repairHints)) {
            if (hints.length >= MAX_HINTS) break;
            if (key.startsWith(`${outputMode}:`) && data.attempts >= 3 && data.avgPreservedRatio < 0.5) {
                hints.push(`Repair hint: ${key} repairs tend to change >50% of the artifact. Consider more targeted patches.`);
            }
        }

        return hints.length > 0 ? hints : null;
    }
}
