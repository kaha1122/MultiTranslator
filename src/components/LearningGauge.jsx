import { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../firebase/config';
import { collection, query, where, getDocsFromServer } from 'firebase/firestore';
import { useT } from '../utils/i18n';
import VOCAB_CATEGORIES from '../data/vocabCategories';
import './LearningGauge.css';

// ── Scene 항목 정의 (ScenePractice.jsx SCENES와 동일) ──
const SCENE_ITEMS = {
    locations: [
        'airport', 'hotel', 'restaurant', 'transport', 'shopping',
        'hospital', 'tourist', 'office', 'bank', 'gym', 'custom',
    ],
    situations: [
        'smalltalk', 'lost', 'reservation', 'disagree', 'problem',
        'directions', 'intro', 'compliment', 'decline', 'advice', 'custom',
    ],
};

// 모든 씬 항목 (21개: locations 10+custom, situations 10+custom — custom은 각 1개)
const ALL_SCENE_IDS = [
    ...SCENE_ITEMS.locations.map(id => ({ id, cat: 'locations' })),
    ...SCENE_ITEMS.situations.map(id => ({ id, cat: 'situations' })),
];

// Vocab 카테고리 (7 + custom = 8개)
const ALL_VOCAB_CATS = [
    ...VOCAB_CATEGORIES.map(c => c.id),
    'custom',
];

const DIFFICULTIES = ['basic', 'intermediate', 'advanced'];

const getMonday = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
};

const getMonthStart = () => {
    const d = new Date();
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
};

const LearningGauge = ({ user, sourceLang, isActive }) => {
    const t = useT(sourceLang);
    const [tab, setTab] = useState('dialogue'); // 'dialogue' | 'vocabulary'
    const [difficulty, setDifficulty] = useState('basic');
    const [period, setPeriod] = useState('week'); // 'week' | 'month'
    const [cards, setCards] = useState([]); // all savedCards for this user
    const [isLoading, setIsLoading] = useState(true);
    const [openCatId, setOpenCatId] = useState(null); // 펼쳐진 vocab 카테고리

    // Firestore에서 savedCards 로드 (탭 진입 시마다 서버에서 갱신)
    useEffect(() => {
        if (!user?.uid || !isActive) return;
        const load = async () => {
            try {
                const snap = await getDocsFromServer(
                    query(
                        collection(db, 'savedCards'),
                        where('userId', '==', user.uid),
                    )
                );
                const arr = [];
                snap.forEach(doc => {
                    const d = doc.data();
                    if (d.isDeleted) return;
                    arr.push({
                        sourceType: d.sourceType,
                        difficulty: d.difficulty || 'basic',
                        category: d.category || 'locations',
                        scene: d.scene || '',
                        categoryId: d.categoryId || null,
                        topicId: d.topicId || null,
                        createdAt: d.createdAt?.toDate?.() || null,
                    });
                });
                setCards(arr);
            } catch (e) {
                console.error('[LearningGauge] Load failed:', e);
            } finally {
                setIsLoading(false);
            }
        };
        load();
    }, [user?.uid, isActive]);

    // 기간 필터 날짜 계산
    const dateRange = useMemo(() => {
        const now = new Date();
        if (period === 'week') {
            return { start: getMonday(now), end: now };
        }
        return { start: getMonthStart(), end: now };
    }, [period]);

    // 필터된 카드
    const filtered = useMemo(() => {
        const sourceType = tab === 'dialogue' ? 'scene' : 'vocab';
        return cards.filter(c => {
            if (c.sourceType !== sourceType) return false;
            const d = c.difficulty === 'high' ? 'advanced' : (c.difficulty || 'basic');
            if (d !== difficulty) return false;
            if (!c.createdAt) return false;
            return c.createdAt >= dateRange.start && c.createdAt <= dateRange.end;
        });
    }, [cards, tab, difficulty, dateRange]);

    // 항목별 집계
    const gaugeData = useMemo(() => {
        if (tab === 'dialogue') {
            // Scene: 21개 항목별 카드 수
            return ALL_SCENE_IDS.map(({ id, cat }) => {
                const count = filtered.filter(c => c.scene === id && c.category === cat).length;
                const target = period === 'week' ? 5 : 20;
                return { id, cat, count, target, pct: Math.min(100, Math.round((count / target) * 100)) };
            });
        } else {
            // Vocab: 8개 카테고리별 카드 수
            return ALL_VOCAB_CATS.map(catId => {
                const count = filtered.filter(c => (c.categoryId || 'custom') === catId).length;
                const target = period === 'week' ? 10 : 40;
                return { id: catId, count, target, pct: Math.min(100, Math.round((count / target) * 100)) };
            });
        }
    }, [filtered, tab, period]);

    // 요약 통계
    const summary = useMemo(() => {
        const total = gaugeData.length;
        const covered = gaugeData.filter(g => g.count > 0).length;
        const completed = gaugeData.filter(g => g.pct >= 100).length;
        const totalCards = gaugeData.reduce((s, g) => s + g.count, 0);
        const totalTarget = gaugeData.reduce((s, g) => s + g.target, 0);
        const overallPct = totalTarget > 0 ? Math.min(100, Math.round((totalCards / totalTarget) * 100)) : 0;
        return { total, covered, completed, totalCards, totalTarget, overallPct };
    }, [gaugeData]);

    // 항목 라벨 가져오기
    const getLabel = (item) => {
        if (tab === 'dialogue') {
            if (item.id === 'custom') {
                return t('gauge.custom');
            }
            const key = item.cat === 'locations' ? `sceneLoc.${item.id}` : `sceneSit.${item.id}`;
            return t(key);
        } else {
            if (item.id === 'custom') return t('gauge.custom');
            return t(`vocabCat.${item.id}`);
        }
    };

    // 카테고리 그룹 헤더 (Dialogue만)
    const getGroupLabel = (cat) => {
        return cat === 'locations' ? t('scene.locations') : t('scene.situations');
    };

    // Vocab 카테고리 내 토픽별 카운트
    const getTopicCounts = useCallback((catId) => {
        const cat = VOCAB_CATEGORIES.find(c => c.id === catId);
        if (!cat) return [];
        const topics = [];
        cat.subs.forEach(sub => {
            sub.topics.forEach(topic => {
                const count = filtered.filter(c => (c.topicId || 'custom') === topic.id).length;
                topics.push({ id: topic.id, subId: sub.id, count });
            });
        });
        return topics;
    }, [filtered]);

    if (isLoading) return null;

    return (
        <div className="gauge-container">
            {/* Header: 타이틀 + 기간 토글 */}
            <div className="gauge-header">
                <h3 className="gauge-title">{t('gauge.title')}</h3>
                <div className="gauge-period-toggle">
                    <span className={`gauge-period-label ${period === 'week' ? 'active' : ''}`}>{t('gauge.thisWeek')}</span>
                    <button
                        className={`gauge-toggle-track ${period === 'month' ? 'on' : ''}`}
                        onClick={() => setPeriod(period === 'week' ? 'month' : 'week')}
                        aria-label="Toggle period"
                    >
                        <span className="gauge-toggle-thumb" />
                    </button>
                    <span className={`gauge-period-label ${period === 'month' ? 'active' : ''}`}>{t('gauge.thisMonth')}</span>
                </div>
            </div>

            {/* Tab: Dialogue / Vocabulary */}
            <div className="gauge-tabs">
                <button
                    className={`gauge-tab ${tab === 'dialogue' ? 'active' : ''}`}
                    onClick={() => setTab('dialogue')}
                >
                    {t('nav.scene')}
                </button>
                <button
                    className={`gauge-tab ${tab === 'vocabulary' ? 'active' : ''}`}
                    onClick={() => setTab('vocabulary')}
                >
                    {t('nav.vocab')}
                </button>
            </div>

            {/* Difficulty */}
            <div className="gauge-diff-row">
                {DIFFICULTIES.map(d => (
                    <button
                        key={d}
                        className={`gauge-diff-btn ${difficulty === d ? 'active' : ''}`}
                        onClick={() => setDifficulty(d)}
                    >
                        {t(`scene.diff${d.charAt(0).toUpperCase() + d.slice(1)}`)}
                    </button>
                ))}
            </div>

            {/* Summary */}
            <div className="gauge-summary">
                <div className="gauge-summary-bar-wrap">
                    <div className="gauge-summary-bar" style={{ width: `${summary.overallPct}%` }} />
                </div>
                <div className="gauge-summary-text">
                    <span className="gauge-summary-pct">{summary.overallPct}%</span>
                    <span className="gauge-summary-detail">
                        {summary.totalCards} / {summary.totalTarget} {t('gauge.cards')}
                        {' · '}
                        {summary.covered}/{summary.total} {t('gauge.items')}
                    </span>
                </div>
            </div>

            {/* Item List */}
            <div className="gauge-items">
                {tab === 'dialogue' ? (
                    <>
                        {/* Locations group */}
                        <div className="gauge-group-label">{getGroupLabel('locations')}</div>
                        {gaugeData.filter(g => g.cat === 'locations').map(item => (
                            <GaugeRow key={`loc-${item.id}`} item={item} label={getLabel(item)} />
                        ))}
                        {/* Situations group */}
                        <div className="gauge-group-label">{getGroupLabel('situations')}</div>
                        {gaugeData.filter(g => g.cat === 'situations').map(item => (
                            <GaugeRow key={`sit-${item.id}`} item={item} label={getLabel(item)} />
                        ))}
                    </>
                ) : (
                    gaugeData.map(item => {
                        const isOpen = openCatId === item.id;
                        const isExpandable = item.id !== 'custom';
                        return (
                            <div key={item.id}>
                                <GaugeRow
                                    item={item}
                                    label={getLabel(item)}
                                    expandable={isExpandable}
                                    isOpen={isOpen}
                                    onToggle={() => setOpenCatId(isOpen ? null : item.id)}
                                />
                                {isOpen && isExpandable && (
                                    <div className="gauge-sub-topics">
                                        {getTopicCounts(item.id).map(topic => (
                                            <div key={topic.id} className="gauge-sub-topic-row">
                                                <span className="gauge-sub-topic-label">{t(`vocabTopic.${topic.id}`)}</span>
                                                <span className={`gauge-sub-topic-count ${topic.count > 0 ? 'has' : ''}`}>{topic.count}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

const GaugeRow = ({ item, label, expandable, isOpen, onToggle }) => (
    <div className={`gauge-row ${expandable ? 'expandable' : ''}`} onClick={expandable ? onToggle : undefined}>
        <div className="gauge-row-label">
            {expandable && <span className={`gauge-row-chevron ${isOpen ? 'open' : ''}`}>▸</span>}
            {label}
        </div>
        <div className="gauge-row-bar-wrap">
            <div
                className={`gauge-row-bar ${item.pct >= 100 ? 'complete' : item.pct > 0 ? 'partial' : ''}`}
                style={{ width: `${item.pct}%` }}
            />
        </div>
        <div className="gauge-row-count">{item.count}/{item.target}</div>
    </div>
);

export default LearningGauge;
