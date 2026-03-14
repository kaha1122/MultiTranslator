import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, BookOpen, Languages, ChevronRight } from 'lucide-react';
import { useT } from '../utils/i18n';
import { getToday } from '../hooks/useDailyProgress';
import { useWeeklyCardStats } from '../hooks/useWeeklyCardStats';
import './HomePage.css';

const HomePage = ({ user, weeklyData, todayCount, dailyGoal, sourceLang, onNavigate }) => {
    const t = useT(sourceLang);
    const today = getToday();
    const dayLabels = t('daily.days').split(',');
    const { stats, targets, loading: statsLoading } = useWeeklyCardStats(user);
    const [openFolder, setOpenFolder] = useState(null);

    const folders = [
        {
            id: 'scene',
            icon: <MapPin size={24} />,
            emoji: '🎭',
            color: '#6366f1',
            bgColor: '#eef2ff',
            borderColor: '#c7d2fe',
            titleKey: 'home.sceneTitle',
            descKey: 'home.sceneDesc',
            subDescKey: 'home.sceneSubDesc',
        },
        {
            id: 'vocab',
            icon: <BookOpen size={24} />,
            emoji: '📖',
            color: '#059669',
            bgColor: '#f0fdf4',
            borderColor: '#a7f3d0',
            titleKey: 'home.vocabTitle',
            descKey: 'home.vocabDesc',
            subDescKey: 'home.vocabSubDesc',
        },
        {
            id: 'translation',
            icon: <Languages size={24} />,
            emoji: '🔤',
            color: '#d97706',
            bgColor: '#fffbeb',
            borderColor: '#fde68a',
            titleKey: 'home.translationTitle',
            descKey: 'home.translationDesc',
            subDescKey: 'home.translationSubDesc',
        },
    ];

    const gaugePercent = Math.min((todayCount / dailyGoal) * 100, 100);
    const isComplete = todayCount >= dailyGoal;

    return (
        <div className="home-page">
            {/* 섹션 1: 주간 목표 별 */}
            <div className="home-section home-weekly">
                <h3 className="home-section-title">{t('home.weeklyGoal')}</h3>
                <div className="home-weekly-stars">
                    {weeklyData.map((d, i) => {
                        const isToday = d.date === today;
                        const isFuture = d.date > today;
                        let icon = '○';
                        if (d.achieved) icon = '⭐';
                        else if (!isFuture && d.date < today) icon = '🌙';
                        return (
                            <div key={d.date} className={`home-star-day ${isToday ? 'today' : ''} ${isFuture ? 'future' : ''}`}>
                                <span className="home-star-label">{dayLabels[i] || ''}</span>
                                <span className="home-star-icon">{icon}</span>
                                {!isFuture && <span className="home-star-count">{d.count || 0}</span>}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 섹션 2: 카드 목표 게이지바 */}
            <div className="home-section home-gauge">
                <div className="home-gauge-header">
                    <span className="home-gauge-label">{t('home.todayProgress')}</span>
                    <span className={`home-gauge-count ${isComplete ? 'complete' : ''}`}>
                        {todayCount} / {dailyGoal} {t('daily.counterUnit')}
                    </span>
                </div>
                <div className="home-gauge-track">
                    <motion.div
                        className={`home-gauge-fill ${isComplete ? 'complete' : ''}`}
                        initial={{ width: 0 }}
                        animate={{ width: `${gaugePercent}%` }}
                        transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                </div>
                {isComplete && (
                    <motion.p
                        className="home-gauge-msg"
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                    >
                        {t('daily.goalComplete')}
                    </motion.p>
                )}
            </div>

            {/* 섹션 3: 3개 폴더 카드 */}
            <div className="home-section">
                <h3 className="home-section-title">{t('home.folders')}</h3>
                <div className="home-folders">
                    {folders.map(folder => {
                        const isOpen = openFolder === folder.id;
                        return (
                            <div key={folder.id} className="home-folder-wrapper">
                                <motion.div
                                    className={`home-folder-card ${isOpen ? 'open' : ''}`}
                                    style={{
                                        borderColor: isOpen ? folder.borderColor : '#e2e8f0',
                                        background: isOpen ? folder.bgColor : 'white',
                                    }}
                                    onClick={() => setOpenFolder(isOpen ? null : folder.id)}
                                    layout
                                >
                                    {/* 폴더 헤더 (항상 보임) */}
                                    <div className="home-folder-header">
                                        <div className="home-folder-icon" style={{ background: folder.bgColor, color: folder.color }}>
                                            {folder.icon}
                                        </div>
                                        <span className="home-folder-name" style={{ color: isOpen ? folder.color : '#1e293b' }}>
                                            {t(folder.titleKey)}
                                        </span>
                                        <motion.span
                                            className="home-folder-chevron"
                                            animate={{ rotate: isOpen ? 90 : 0 }}
                                            transition={{ duration: 0.2 }}
                                        >
                                            <ChevronRight size={18} color="#94a3b8" />
                                        </motion.span>
                                    </div>

                                    {/* 확장 영역 */}
                                    <AnimatePresence>
                                        {isOpen && (
                                            <motion.div
                                                className="home-folder-body"
                                                initial={{ opacity: 0, height: 0 }}
                                                animate={{ opacity: 1, height: 'auto' }}
                                                exit={{ opacity: 0, height: 0 }}
                                                transition={{ duration: 0.25 }}
                                            >
                                                {/* 애니메이션 이미지 */}
                                                <div className="home-folder-anim" style={{ background: folder.bgColor }}>
                                                    <motion.span
                                                        className="home-folder-emoji"
                                                        animate={{ scale: [1, 1.15, 1], y: [0, -6, 0] }}
                                                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                                                    >
                                                        {folder.emoji}
                                                    </motion.span>
                                                </div>

                                                {/* 큰 글씨 설명 */}
                                                <p className="home-folder-desc-main">{t(folder.descKey)}</p>
                                                {/* 작은 글씨 설명 */}
                                                <p className="home-folder-desc-sub">{t(folder.subDescKey)}</p>

                                                {/* 하단 이동 버튼 */}
                                                <button
                                                    className="home-folder-cta"
                                                    style={{ background: folder.color }}
                                                    onClick={(e) => { e.stopPropagation(); onNavigate(folder.id); }}
                                                >
                                                    {t('home.goBtn')} →
                                                </button>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </motion.div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 섹션 4: 이번 주 학습 통계표 */}
            <div className="home-section home-stats">
                <h3 className="home-section-title">{t('home.weeklyStats')}</h3>
                {statsLoading ? (
                    <div className="home-stats-loading">...</div>
                ) : (
                    <div className="home-stats-table-wrap">
                        <table className="home-stats-table">
                            <thead>
                                <tr>
                                    <th></th>
                                    <th>{t('scene.diffBasic')}</th>
                                    <th>{t('scene.diffIntermediate')}</th>
                                    <th>{t('scene.diffHigh')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className="home-stats-row-label">🎭 {t('home.dialogue')}</td>
                                    <td>{stats.scene.basic}/{targets.scene}</td>
                                    <td>{stats.scene.intermediate}/{targets.scene}</td>
                                    <td>{stats.scene.high}/{targets.scene}</td>
                                </tr>
                                <tr>
                                    <td className="home-stats-row-label">📖 {t('home.word')}</td>
                                    <td>{stats.vocab.basic}/{targets.vocab}</td>
                                    <td>{stats.vocab.intermediate}/{targets.vocab}</td>
                                    <td>{stats.vocab.high}/{targets.vocab}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default HomePage;
