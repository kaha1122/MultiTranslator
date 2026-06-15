// 지문(passage) 텍스트 처리 공용 헬퍼 — ListeningTab + ListeningPassageView 공유.
// (기존 ListeningTab 인라인 정의를 그대로 이전 — 동작 동일)

// 대화형 지문에서 A:/B: 레이블 제거 + 줄바꿈 유지 (단일 voice 폴백 TTS용)
export const cleanDialogueForTTS = (text) => {
    if (!text) return text;
    return text.replace(/^[A-Z]:\s*/gm, '\n').replace(/\n{2,}/g, '\n\n');
};

// 대화 텍스트를 A:/B: 턴 배열로 파싱
export const parseDialogueTurns = (text) => {
    if (!text) return [];
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const turns = [];
    for (const line of lines) {
        const m = line.match(/^([A-Z]):\s*(.+)$/);
        if (m) {
            turns.push({ speaker: m[1], text: m[2].trim() });
        } else if (turns.length > 0) {
            turns[turns.length - 1].text += ' ' + line;
        }
    }
    return turns;
};

// 간단한 deterministic 해시 (서버와 동일 규칙) — dialogueSeed 생성용
export const simpleHashString = (str) => {
    let h = 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return String(Math.abs(h));
};

// 지문을 문장 단위로 분리 (대화: 줄 단위 / 에세이: 문장부호 기준)
export const splitIntoSentences = (text, isDialogue) => {
    if (!text) return [];
    if (isDialogue) {
        return text.split('\n').filter(s => s.trim());
    }
    const parts = text.split(/(?<=[。．.！!？?\n])\s*/);
    return parts.filter(s => s.trim());
};

export const getServerUrl = () => {
    try {
        if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) {
            return import.meta.env.VITE_API_URL;
        }
    } catch (e) { /* noop */ }
    if (typeof window !== 'undefined') return `http://${window.location.hostname}:5000`;
    return 'http://localhost:5000';
};
