import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const FOLDER_BY_TYPE = {
    html: 'homepage',
    slide: 'slide',
    doc: 'docx',
    sheet: 'sheets',
};

const ARTIFACTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(ARTIFACTS_DIR, '..', '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'client', 'public');

export function getArtifactFolder(type) {
    return FOLDER_BY_TYPE[type] || 'generated';
}

export function ensureArtifactFolders() {
    const folders = ['homepage', 'slide', 'docx', 'sheets', 'assets'];

    for (const folder of folders) {
        const target = path.join(PUBLIC_DIR, folder);
        if (!fs.existsSync(target)) {
            fs.mkdirSync(target, { recursive: true });
        }
    }
}

export function buildArtifactPath(type, filename) {
    ensureArtifactFolders();
    const folder = getArtifactFolder(type);
    const filepath = path.join(PUBLIC_DIR, folder, filename);
    const publicPath = `/${folder}/${filename}`;
    return { filepath, publicPath, folder };
}
