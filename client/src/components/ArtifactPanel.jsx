function renderArtifact(artifact) {
    switch (artifact.type) {
        case 'html':
            return (
                <iframe
                    src={artifact.path}
                    title={artifact.label}
                    style={{ width: '100%', height: '640px', border: 'none', background: '#fff' }}
                />
            );
        case 'image':
            return (
                <div style={{ background: '#0b1220', textAlign: 'center' }}>
                    <img
                        src={artifact.path}
                        alt={artifact.label}
                        style={{ maxWidth: '100%', maxHeight: '640px', display: 'block', margin: '0 auto' }}
                    />
                </div>
            );
        case 'pdf':
            return (
                <iframe
                    src={artifact.path}
                    title={artifact.label}
                    style={{ width: '100%', height: '640px', border: 'none', background: '#fff' }}
                />
            );
        default:
            return (
                <div style={{ padding: '20px' }}>
                    <div style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
                        브라우저 직접 미리보기를 지원하지 않는 형식입니다.
                    </div>
                    <a
                        href={artifact.path}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}
                    >
                        파일 열기: {artifact.path}
                    </a>
                </div>
            );
    }
}

export default function ArtifactPanel({ artifacts = [] }) {
    if (!artifacts.length) return null;

    return (
        <div>
            <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)' }}>
                생성 결과물
            </h3>
            <div style={{ display: 'grid', gap: '16px' }}>
                {artifacts.map((artifact, index) => (
                    <div key={`${artifact.path}-${index}`} className="glass-card" style={{ padding: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '12px', fontSize: '12px' }}>
                            <div style={{ color: 'var(--text-secondary)' }}>
                                <strong>{artifact.label}</strong> · {artifact.sourceAgent}
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{artifact.type}</div>
                        </div>
                        <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', overflow: 'hidden' }}>
                            {renderArtifact(artifact)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
