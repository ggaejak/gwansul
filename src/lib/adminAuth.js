// 관리자 페이지(/survey-admin) 비밀번호 상수.
//
// 클라이언트 모듈 어느 곳에서든 동일한 값을 사용하기 위한 공유 상수.
// supabase 의 admin_check_password() 함수에 동일 평문이 하드코딩되어 있음.
// 변경 시:
//   1) supabase 마이그레이션(admin_check_password) 갱신
//   2) 배포 환경 ENV(VITE_SURVEY_ADMIN_PASSWORD) 갱신
//   3) 두 곳 동시 배포
//
// 보안 모델: 비공개 페이지 password gate 수준. 클라이언트 코드에 평문 포함.

export const ADMIN_PASSWORD =
  import.meta.env.VITE_SURVEY_ADMIN_PASSWORD || 'Gwansul8&'
