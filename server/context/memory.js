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
            .filter((f) => f.endsWith('.json'))
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
}
