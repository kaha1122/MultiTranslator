import { useState } from 'react';
import { X, Mic, Headphones, Lock, ArrowRight } from 'lucide-react';
import { getT } from '../utils/i18n';
import {
  W_TARGET,
  P_TARGET,
  TOPIC_INDEX,
  topicCode,
  isWordPhaseComplete,
  isTopicMastered,
} from '../config/learningPath.js';

// ── TopicHub (Layer 2) ─────────────────────────────────────────────────────
// 토픽 1개 = 단어 발음(VocabTab) + 지문 섀도잉(ListeningTab) 두 페이즈.
// 단어 단계(wordMastered >= W_TARGET) 완료 전까지 지문 CTA 잠금(순차 학습).
export default function TopicHub({
  topicId,
  sourceLang,
  activeLang,
  defaultLevel = 'basic',
  getTopicProgress,
  isPro = false,            // Pro/Premium: 단어 학습 건너뛰고 지문(Listening) 직접 진입 허용
  onClose,
  onStartWord,
  onStartPassage,
}) {
  const t = (k) => getT(sourceLang, k);
  const meta = TOPIC_INDEX[topicId];
  const [level, setLevel] = useState(defaultLevel);

  if (!meta) return null;
  const { catId, subId, icon } = meta;
  const p = getTopicProgress(topicId, activeLang);
  const wm = Math.min(p.wordMastered || 0, W_TARGET);
  const pm = Math.min(p.passageMastered || 0, P_TARGET);
  const wordDone = isWordPhaseComplete(p);
  // Pro/Premium 은 단어 단계 완료 없이도 지문 직접 진입 가능(잠금 해제). 양방향 정합은 활성 unit 포인터가 담당.
  const passageUnlocked = wordDone || isPro;
  const mastered = isTopicMastered(p);

  const preset = { catId, subId, topicId, level, lang: activeLang };

  return (
    <div className="hub-overlay" onClick={onClose}>
      <div className="hub-sheet" onClick={(e) => e.stopPropagation()}>
        <button className="hub-close" onClick={onClose} aria-label="close"><X size={20} /></button>

        <div className="hub-head">
          <span className="hub-icon">{icon}</span>
          <div className="hub-titlewrap">
            <h2 className="hub-title">{t(`vocabTopic.${topicId}`)}</h2>
            <span className="hub-code">{topicCode(topicId)}</span>
          </div>
          <span className={`hub-badge ${mastered ? 'done' : ''}`}>
            {t('learningPath.word')} {wm}/{W_TARGET} · {t('learningPath.passage')} {pm}/{P_TARGET}
          </span>
        </div>

        {/* 난이도 토글 */}
        <div className="hub-level-row">
          {[
            { value: 'basic', key: 'diffBasic' },
            { value: 'intermediate', key: 'diffIntermediate' },
            { value: 'advanced', key: 'diffAdvanced' },
          ].map((lv) => (
            <button
              key={lv.value}
              className={`hub-level-btn ${level === lv.value ? 'active' : ''}`}
              onClick={() => setLevel(lv.value)}
            >
              {t(`scene.${lv.key}`)}
            </button>
          ))}
        </div>

        {/* 단계 1 — 단어 발음 */}
        <button className="hub-phase" onClick={() => onStartWord?.(preset)}>
          <div className="hub-phase-icon word"><Mic size={20} /></div>
          <div className="hub-phase-body">
            <span className="hub-phase-title">{t('learningPath.wordPhaseTitle')}</span>
            <span className="hub-phase-desc">{t('learningPath.wordPhaseDesc')}</span>
            <div className="hub-gauge"><span className="hub-gauge-fill word" style={{ width: `${(wm / W_TARGET) * 100}%` }} /></div>
            <span className="hub-gauge-text">{wm} / {W_TARGET} {t('learningPath.passed')}</span>
          </div>
          <ArrowRight size={18} className="hub-phase-arrow" />
        </button>

        {/* 단계 2 — 지문 섀도잉 (단어 완료 전 잠금 / Pro·Premium 은 직접 진입) */}
        <button
          className={`hub-phase ${passageUnlocked ? '' : 'locked'}`}
          onClick={() => passageUnlocked && onStartPassage?.(preset)}
          disabled={!passageUnlocked}
        >
          <div className="hub-phase-icon passage">
            {passageUnlocked ? <Headphones size={20} /> : <Lock size={18} />}
          </div>
          <div className="hub-phase-body">
            <span className="hub-phase-title">{t('learningPath.passagePhaseTitle')}</span>
            <span className="hub-phase-desc">
              {passageUnlocked ? t('learningPath.passagePhaseDesc') : t('learningPath.passageLocked')}
            </span>
            <div className="hub-gauge"><span className="hub-gauge-fill passage" style={{ width: `${(pm / P_TARGET) * 100}%` }} /></div>
            <span className="hub-gauge-text">{pm} / {P_TARGET} {t('learningPath.sentences')}</span>
          </div>
          {passageUnlocked && <ArrowRight size={18} className="hub-phase-arrow" />}
        </button>
      </div>
    </div>
  );
}
