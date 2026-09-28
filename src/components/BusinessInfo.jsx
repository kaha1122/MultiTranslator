// ── 사업자 정보 (2026-09-28 — 토스페이먼츠 가맹점 심사·전자상거래법 표시 요건) ──────────
// 상호·대표자·사업자등록번호·주소·연락처. K-DramaAnyLang(같은 사업자 아리젬스)과 같은 값.
// 번호·연락처는 언어 무관 고정값, 상호·대표자·주소 표기는 legal.biz*Val(ko는 한글, 그 외 영문).
// ⚠ 통신판매업 신고번호는 아직 없음 — 신고 후 BIZ.mailOrderNo를 채우면 행이 자동으로 나타난다.
import { getT } from '../utils/i18n';
import './BusinessInfo.css';

export const BIZ = {
  regNo: '746-11-03230',
  phone: '050-6754-5465',
  email: 'systemadmin@pronunfit.com',
  mailOrderNo: '',
};

export default function BusinessInfo({ sourceLang = 'ko', compact = false, className = '' }) {
  const t = (k) => getT(sourceLang, `legal.${k}`);
  const rows = [
    [t('bizName'), t('bizNameVal')],
    [t('bizCeo'), t('bizCeoVal')],
    [t('bizRegNo'), BIZ.regNo],
    ...(BIZ.mailOrderNo ? [['통신판매업 신고번호', BIZ.mailOrderNo]] : []),
    [t('bizAddress'), t('bizAddressVal')],
    [t('bizPhone'), BIZ.phone],
    [t('bizEmail'), BIZ.email],
  ];
  if (compact) {
    return (
      <p className={`biz-info-compact ${className}`}>
        {rows.map(([k, v]) => `${k} ${v}`).join(' · ')}
      </p>
    );
  }
  return (
    <dl className={`biz-info ${className}`}>
      {rows.map(([k, v]) => (
        <div key={k} className="biz-info-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
