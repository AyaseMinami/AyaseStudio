export class BackupRecoveryError extends Error {
  constructor() { super("恢复失败，回滚尚未完成。请返回设置以重新加载并重试整理；完成前不能继续编辑数据。"); }
}
