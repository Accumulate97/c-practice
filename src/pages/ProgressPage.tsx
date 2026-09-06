import { PhasePlaceholder } from '../components/common/PhasePlaceholder'

export function ProgressPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">📈 我的进度</h1>
      <PhasePlaceholder
        phase="阶段 5"
        todo={[
          '答题记录、正确率、按章节统计（全部存 localStorage，无服务端）',
          '错题本与收藏；进度导出 / 导入 JSON',
          'schemaVersion 迁移链：结构升级时旧进度不丢',
        ]}
      />
    </div>
  )
}