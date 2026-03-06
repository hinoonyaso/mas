import { useMemo, useState } from 'react';

const MODE_TITLES = {
    website: '홈페이지 미리보기',
    docx: '문서 미리보기',
    sheet: '시트 미리보기',
    slide: '슬라이드 미리보기',
    deep_research: '리서치 리포트 미리보기',
};

const MODE_EMPTY_MESSAGES = {
    website: '홈페이지 HTML 미리보기가 아직 생성되지 않았습니다. 현재 보이는 항목은 보조 자산입니다.',
    docx: '문서 본문 미리보기가 아직 생성되지 않았습니다.',
    sheet: '시트 본문 미리보기가 아직 생성되지 않았습니다.',
    slide: '슬라이드 덱 미리보기가 아직 생성되지 않았습니다.',
    deep_research: '리서치 리포트 미리보기가 아직 생성되지 않았습니다.',
};

function ImageArtifact({ artifact }) {
    const [failed, setFailed] = useState(false);

    if (failed) {
        return (
            <div style={{ padding: '20px' }}>
                <div style={{ color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    이미지 파일을 불러오지 못했습니다. 생성 단계에서 잘못된 응답이 저장됐을 가능성이 큽니다.
                </div>
                <a
                    href={artifact.path}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent-cyan)', textDecoration: 'none' }}
                >
                    파일 확인: {artifact.path}
                </a>
            </div>
        );
    }

    return (
        <div style={{ background: '#0b1220', textAlign: 'center' }}>
            <img
                src={artifact.path}
                alt={artifact.label}
                onError={() => setFailed(true)}
                style={{ maxWidth: '100%', maxHeight: '640px', display: 'block', margin: '0 auto' }}
            />
        </div>
    );
}

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
            return <ImageArtifact artifact={artifact} />;
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

function ArtifactCard({ artifact, title }) {
    return (
        <div className="glass-card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '12px', fontSize: '12px' }}>
                <div style={{ color: 'var(--text-secondary)' }}>
                    <strong>{title || artifact.label}</strong> · {artifact.sourceAgent}
                </div>
                <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{artifact.type}</div>
            </div>
            <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', overflow: 'hidden' }}>
                {renderArtifact(artifact)}
            </div>
        </div>
    );
}

function EmptyPrimaryPreview({ outputMode }) {
    return (
        <div className="glass-card" style={{ padding: '20px' }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                {MODE_TITLES[outputMode] || '대표 미리보기'}
            </div>
            <div style={{ marginTop: '8px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                {MODE_EMPTY_MESSAGES[outputMode] || '대표 미리보기를 아직 생성하지 못했습니다.'}
            </div>
        </div>
    );
}

function pickPrimaryArtifact(artifacts, outputMode) {
    const htmlArtifacts = artifacts.filter((artifact) => artifact.type === 'html');
    const previewArtifact = htmlArtifacts.find((artifact) => /preview/i.test(artifact.label));
    if (previewArtifact) return previewArtifact;

    if (outputMode === 'website') {
        return htmlArtifacts.find((artifact) => artifact.sourceAgent === 'coder') || null;
    }

    if (['docx', 'sheet', 'slide', 'deep_research'].includes(outputMode)) {
        return htmlArtifacts[0] || null;
    }

    return htmlArtifacts[0] || artifacts[0] || null;
}

export default function ArtifactPanel({ artifacts = [], outputMode = 'website' }) {
    const { primaryArtifact, supportArtifacts } = useMemo(() => {
        const primary = pickPrimaryArtifact(artifacts, outputMode);
        const support = artifacts.filter((artifact) => artifact !== primary && artifact.sourceAgent === 'asset');
        return { primaryArtifact: primary, supportArtifacts: support };
    }, [artifacts, outputMode]);

    if (!artifacts.length) return null;

    return (
        <div style={{ display: 'grid', gap: '16px' }}>
            <div>
                <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)' }}>
                    {MODE_TITLES[outputMode] || '생성 결과물'}
                </h3>
                {primaryArtifact
                    ? <ArtifactCard artifact={primaryArtifact} title={MODE_TITLES[outputMode] || primaryArtifact.label} />
                    : <EmptyPrimaryPreview outputMode={outputMode} />}
            </div>

            {supportArtifacts.length > 0 && (
                <div>
                    <h3 style={{ fontSize: '14px', fontWeight: 600, marginBottom: '12px', color: 'var(--text-secondary)' }}>
                        보조 자산
                    </h3>
                    <div style={{ display: 'grid', gap: '16px' }}>
                        {supportArtifacts.map((artifact, index) => (
                            <ArtifactCard key={`${artifact.path}-${index}`} artifact={artifact} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
