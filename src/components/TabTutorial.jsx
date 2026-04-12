import { useT } from '../utils/i18n';
import './TabTutorial.css';

// 탭별 아이콘만 정의 (텍스트는 i18n)
const TAB_ICONS = {
  home: ['📖', '⭐'],
  scene: ['📍', '🎙️'],
  vocab: ['📖', '🔊'],
  translation: ['🔤', '🎯'],
  library: ['🗂️', '🎯'],
  video: ['🎬', '📝'],
  settings: ['🌍', '🎯'],
};

// 탭별 팁 개수 (TAB_TUTORIALS 대체용)
export const TAB_TUTORIALS = {
  home: [1, 2],
  scene: [1],
  vocab: [1],
  translation: [1],
  library: [1],
  video: [1],
  settings: [1],
};

export default function TabTutorial({ tab, step, total, onNext, onSkip, sourceLang }) {
  const t = useT(sourceLang || 'ko');
  const icons = TAB_ICONS[tab];
  if (!icons || step >= total) return null;

  const isLast = step === total - 1;
  const tipNum = step + 1;

  return (
    <>
    <div className="tutorial-backdrop" onClick={onSkip} />
    <div className="tutorial-overlay" onClick={(e) => e.stopPropagation()}>
      <div className="tutorial-card">
        {/* 상단: 아이콘 + 닫기 */}
        <div className="tutorial-card-top">
          <span className="tutorial-card-icon">{icons[step]}</span>
          <button className="tutorial-skip-btn" onClick={onSkip}>{t('tutorial.skip')}</button>
        </div>

        {/* 제목 & 설명 */}
        <div className="tutorial-card-title">{t(`tutorial.${tab}${tipNum}Title`)}</div>
        <div className="tutorial-card-desc">{t(`tutorial.${tab}${tipNum}Desc`)}</div>

        {/* 하단: 도트 스텝 + 버튼 */}
        <div className="tutorial-card-bottom">
          <div className="tutorial-step-dots">
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={`tutorial-step-dot ${i === step ? 'active' : ''}`}
              />
            ))}
          </div>
          <button className="tutorial-next-btn" onClick={onNext}>
            {isLast ? t('tutorial.confirm') : t('tutorial.next')}
          </button>
        </div>
      </div>
    </div>
    </>
  );
}
