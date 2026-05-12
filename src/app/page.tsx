import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] gap-8 px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-slate-900 mb-3">FMEA 자동화 시스템</h1>
        <p className="text-slate-500 text-lg">SW FMEA 항목 관리 및 AI 기반 위험도 자동 분석</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
        <Link href="/projects" className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow text-center">
          <div className="font-semibold text-slate-800">프로젝트 관리</div>
          <div className="text-sm text-slate-500 mt-1">FMEA 프로젝트 생성 및 관리</div>
        </Link>
        <Link href="/projects/import" className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow text-center">
          <div className="font-semibold text-slate-800">AI 자동 분석</div>
          <div className="text-sm text-slate-500 mt-1">ARXML 업로드 → S/O/D 자동 생성</div>
        </Link>
        <Link href="/dashboard" className="bg-white rounded-xl border border-slate-200 p-6 hover:shadow-md transition-shadow text-center">
          <div className="font-semibold text-slate-800">RPN 대시보드</div>
          <div className="text-sm text-slate-500 mt-1">위험도 현황 및 통계 분석</div>
        </Link>
      </div>
      <Link href="/projects" className="bg-slate-900 text-white px-8 py-3 rounded-lg hover:bg-slate-700 transition-colors font-medium">
        시작하기 →
      </Link>
    </div>
  );
}
