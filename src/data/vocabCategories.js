/**
 * Vocabulary Categories — 7 categories × 2 subs × 5 topics
 * Labels are in src/locales/*.json under vocabCat / vocabSub / vocabTopic keys.
 */
const VOCAB_CATEGORIES = [
  {
    id: 'daily', icon: '🏠',
    subs: [
      { id: 'home', topics: [{ id: 'morning' }, { id: 'cooking' }, { id: 'cleaning' }, { id: 'shopping_daily' }, { id: 'weather' }] },
      { id: 'outing', topics: [{ id: 'cafe' }, { id: 'exercise' }, { id: 'hobby' }, { id: 'pet' }, { id: 'fashion' }] },
    ],
  },
  {
    id: 'travel', icon: '✈️',
    subs: [
      { id: 'transport', topics: [{ id: 'airport' }, { id: 'train' }, { id: 'taxi' }, { id: 'directions' }, { id: 'immigration' }] },
      { id: 'stay', topics: [{ id: 'hotel' }, { id: 'sightseeing' }, { id: 'restaurant_travel' }, { id: 'emergency' }, { id: 'culture' }] },
    ],
  },
  {
    id: 'business', icon: '💼',
    subs: [
      { id: 'office', topics: [{ id: 'meeting' }, { id: 'email_biz' }, { id: 'phone_biz' }, { id: 'negotiation' }, { id: 'networking' }] },
      { id: 'career', topics: [{ id: 'interview' }, { id: 'resume' }, { id: 'salary' }, { id: 'teamwork' }, { id: 'startup' }] },
    ],
  },
  {
    id: 'education', icon: '📚',
    subs: [
      { id: 'school', topics: [{ id: 'classroom' }, { id: 'exam' }, { id: 'campus' }, { id: 'library_edu' }, { id: 'language_learning' }] },
      { id: 'selfdev', topics: [{ id: 'reading' }, { id: 'online_course' }, { id: 'certificate' }, { id: 'study_abroad' }, { id: 'motivation' }] },
    ],
  },
  {
    id: 'social', icon: '💬',
    subs: [
      { id: 'conversation', topics: [{ id: 'greetings' }, { id: 'opinions' }, { id: 'compliment_social' }, { id: 'apology' }, { id: 'humor' }] },
      { id: 'events', topics: [{ id: 'party' }, { id: 'wedding' }, { id: 'dating' }, { id: 'family_event' }, { id: 'sns' }] },
    ],
  },
  {
    id: 'tech', icon: '💻',
    subs: [
      { id: 'digital', topics: [{ id: 'smartphone' }, { id: 'computer' }, { id: 'internet' }, { id: 'ai_tech' }, { id: 'gaming' }] },
      { id: 'industry', topics: [{ id: 'ecommerce' }, { id: 'fintech' }, { id: 'biotech' }, { id: 'energy' }, { id: 'space' }] },
    ],
  },
  {
    id: 'culture', icon: '🎭',
    subs: [
      { id: 'entertainment', topics: [{ id: 'movie' }, { id: 'music' }, { id: 'books' }, { id: 'kpop' }, { id: 'sports_culture' }] },
      { id: 'tradition', topics: [{ id: 'festival' }, { id: 'food_culture' }, { id: 'art' }, { id: 'religion' }, { id: 'history' }] },
    ],
  },
];

export default VOCAB_CATEGORIES;
